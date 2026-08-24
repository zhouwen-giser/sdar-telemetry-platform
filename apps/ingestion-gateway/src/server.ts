import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type {
  EvidenceV1BatchAcknowledgement,
  EvidenceV1BatchRequest,
  EvidenceV1Record,
  EvidenceV1WalPayload,
} from "../../../packages/telemetry-types/src/index.js";
import {
  DurableSegmentWal,
  evidenceWalPartition,
} from "../../../packages/telemetry-wal/src/index.js";
import {
  DOMAIN_SOURCE_V1_CONTRACT,
  DOMAIN_SOURCE_V1_HEADER,
  createDomainSourceRecordIdentityHash,
  createDomainSourceSealIdentityHash,
  hashCanonicalDomainSourceJson,
  type DomainSourceBatchAcknowledgement,
  type DomainSourceBatchRequest,
  type DomainSourceEpisodeSealRequest,
  type DomainSourceSealAcknowledgement,
  type DomainSourceV1Validator,
  type DomainSourceWalPayload,
} from "../../../packages/telemetry-contracts/src/index.js";
import type {
  TelemetryHttpAuthorizationPolicy,
} from "../../../packages/telemetry-config/src/index.js";

export const EVIDENCE_CONTRACT_HEADER = "x-sdar-evidence-contract";
export const EVIDENCE_CONTRACT_VERSION = "sdar.evidence/v1";
export const LEGACY_CONTRACT_HEADER = "x-sdar-telemetry-contract";

export interface EvidenceV1BatchValidator {
  assertBatch(value: unknown): EvidenceV1BatchRequest;
}

export interface EvidenceGatewayDependencies {
  readonly validator: EvidenceV1BatchValidator;
  readonly wal: DurableSegmentWal<EvidenceV1WalPayload>;
  readonly authorization: TelemetryHttpAuthorizationPolicy;
  readonly maximumRequestBytes?: number;
  readonly clock?: Readonly<{ now(): string }>;
  readonly domainSource?: Readonly<{
    validator: DomainSourceV1Validator;
    wal: DurableSegmentWal<DomainSourceWalPayload>;
    authorization: TelemetryHttpAuthorizationPolicy;
  }>;
}

type ResolvedAuthorizationPolicy =
  | Readonly<{ profile: "bearer"; expectedCredentialDigest: Buffer }>
  | Readonly<{ profile: "development-anonymous" }>;

export class EvidenceReceiverError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "EvidenceReceiverError";
  }
}

/**
 * The durable receiver is deliberately independent from HTTP so duplicate/restart behavior can be
 * exercised without treating a 2xx response as end-to-end proof.
 */
export class EvidenceV1Receiver {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly clock: Readonly<{ now(): string }>;

  constructor(
    private readonly wal: DurableSegmentWal<EvidenceV1WalPayload>,
    clock: Readonly<{ now(): string }> = { now: () => new Date().toISOString() },
  ) {
    this.clock = clock;
  }

  async accept(batch: EvidenceV1BatchRequest): Promise<EvidenceV1BatchAcknowledgement> {
    const partition = evidenceWalPartition({
      exportId: batch.exportId,
      sourceId: batch.sourceId,
      nodeId: batch.nodeId,
      revision: batch.revision,
    });
    return this.withPartitionLock(partition, async () => {
      const frames = await this.wal.recover(partition);
      const state = recoveredState(frames.map((frame) => frame.payload));
      const sameBatch = state.batchHashes.get(batch.batchHash);
      if (sameBatch !== undefined) {
        if (
          sameBatch.firstSequence !== batch.firstSequence ||
          sameBatch.lastSequence !== batch.lastSequence
        ) {
          throw new EvidenceReceiverError("EVIDENCE_BATCH_IDENTITY_CONFLICT", 409);
        }
        return Object.freeze({ lastAcknowledgedSequence: batch.lastSequence });
      }

      let allRecordsAreDurable = true;
      for (const record of batch.records) {
        const byRecordId = state.records.get(record.recordId);
        if (byRecordId !== undefined && byRecordId.payloadHash !== record.payloadHash) {
          throw new EvidenceReceiverError("EVIDENCE_RECORD_HASH_CONFLICT", 409);
        }
        const bySequence = state.sequences.get(record.evidenceSequence);
        if (
          bySequence !== undefined &&
          (bySequence.recordId !== record.recordId || bySequence.payloadHash !== record.payloadHash)
        ) {
          throw new EvidenceReceiverError("EVIDENCE_SEQUENCE_CONFLICT", 409);
        }
        if (byRecordId === undefined || bySequence === undefined) allRecordsAreDurable = false;
      }

      if (!allRecordsAreDurable) {
        await this.wal.append(partition, {
          kind: "sdar-evidence-v1",
          receivedAt: this.clock.now(),
          batch,
        });
      }

      // A segment commit is atomic for this receiver, so the durable prefix is the complete batch.
      // Numeric sequence gaps are legal because the producer allocates a global BIGSERIAL across
      // internal source partitions.
      return Object.freeze({ lastAcknowledgedSequence: batch.lastSequence });
    });
  }

  private async withPartitionLock<R>(partition: string, operation: () => Promise<R>): Promise<R> {
    const previous = this.locks.get(partition) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(partition, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.locks.get(partition) === queued) this.locks.delete(partition);
    }
  }
}

export class DomainSourceV1Receiver {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly wal: DurableSegmentWal<DomainSourceWalPayload>,
    private readonly clock: Readonly<{ now(): string }> = {
      now: () => new Date().toISOString(),
    },
  ) {}

  async acceptBatch(batch: DomainSourceBatchRequest): Promise<DomainSourceBatchAcknowledgement> {
    const first = batch.records[0]!;
    const partition = domainSourceWalPartition({
      application: batch.application,
      tenantId: first.tenantId,
      projectId: first.projectId,
    });
    return this.withPartitionLock(partition, async () => {
      const state = domainSourceRecoveredState(await this.wal.recover(partition));
      if (state.batchHashes.has(batch.batchHash)) {
        return Object.freeze({ lastAcknowledgedSequence: batch.lastSequence });
      }
      let allRecordsAreDurable = true;
      for (const record of batch.records) {
        const identity = createDomainSourceRecordIdentityHash(record);
        const existingIdentity = state.recordIdentities.get(identity);
        if (
          existingIdentity !== undefined &&
          existingIdentity.payloadHash !== record.payloadHash
        ) {
          throw new EvidenceReceiverError("DOMAIN_SOURCE_RECORD_HASH_CONFLICT", 409);
        }
        if (existingIdentity !== undefined && existingIdentity.sequence !== record.sequence) {
          throw new EvidenceReceiverError("DOMAIN_SOURCE_IDENTITY_SEQUENCE_CONFLICT", 409);
        }
        const existingSequence = state.sequences.get(record.sequence);
        if (
          existingSequence !== undefined &&
          (existingSequence.identity !== identity || existingSequence.payloadHash !== record.payloadHash)
        ) {
          throw new EvidenceReceiverError("DOMAIN_SOURCE_SEQUENCE_CONFLICT", 409);
        }
        if (existingIdentity === undefined || existingSequence === undefined) {
          allRecordsAreDurable = false;
        }
      }
      if (!allRecordsAreDurable) {
        await this.wal.append(partition, {
          kind: "sdar-domain-source-v1-batch",
          receivedAt: this.clock.now(),
          batch,
        });
      }
      return Object.freeze({ lastAcknowledgedSequence: batch.lastSequence });
    });
  }

  async acceptSeal(seal: DomainSourceEpisodeSealRequest): Promise<DomainSourceSealAcknowledgement> {
    const partition = domainSourceWalPartition({
      application: seal.application,
      tenantId: seal.tenantId,
      projectId: seal.projectId,
    });
    return this.withPartitionLock(partition, async () => {
      const state = domainSourceRecoveredState(await this.wal.recover(partition));
      const identity = createDomainSourceSealIdentityHash(seal);
      const contentHash = hashCanonicalDomainSourceJson(seal);
      const existing = state.seals.get(identity);
      if (existing !== undefined) {
        if (existing !== contentHash) {
          throw new EvidenceReceiverError("DOMAIN_SOURCE_SEAL_CONFLICT", 409);
        }
        return Object.freeze({ sealId: seal.sealId, sealRevision: seal.sealRevision });
      }
      await this.wal.append(partition, {
        kind: "sdar-domain-source-v1-seal",
        receivedAt: this.clock.now(),
        seal,
      });
      return Object.freeze({ sealId: seal.sealId, sealRevision: seal.sealRevision });
    });
  }

  private async withPartitionLock<R>(partition: string, operation: () => Promise<R>): Promise<R> {
    const previous = this.locks.get(partition) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(partition, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.locks.get(partition) === queued) this.locks.delete(partition);
    }
  }
}

export function createIngestionGateway(dependencies: EvidenceGatewayDependencies): Server {
  const receiver = new EvidenceV1Receiver(dependencies.wal, dependencies.clock);
  const domainSourceReceiver =
    dependencies.domainSource === undefined
      ? undefined
      : new DomainSourceV1Receiver(dependencies.domainSource.wal, dependencies.clock);
  const maximumRequestBytes = dependencies.maximumRequestBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumRequestBytes) || maximumRequestBytes < 1) {
    throw new EvidenceReceiverError("EVIDENCE_REQUEST_LIMIT_INVALID", 500);
  }
  const authorization = resolveAuthorizationPolicy(
    dependencies.authorization,
    "EVIDENCE_CREDENTIAL_CONFIGURATION_INVALID",
  );
  const domainSourceAuthorization =
    dependencies.domainSource === undefined
      ? undefined
      : resolveAuthorizationPolicy(
          dependencies.domainSource.authorization,
          "DOMAIN_SOURCE_CREDENTIAL_CONFIGURATION_INVALID",
        );

  return http.createServer((request: IncomingMessage, response: ServerResponse) => {
    void handleRequest({
      request,
      response,
      receiver,
      validator: dependencies.validator,
      wal: dependencies.wal,
      authorization,
      domainSourceReceiver,
      domainSourceValidator: dependencies.domainSource?.validator,
      domainSourceWal: dependencies.domainSource?.wal,
      domainSourceAuthorization,
      maximumRequestBytes,
    }).catch((error: unknown) => sendError(response, error));
  });
}

export async function loadEvidenceBearerCredential(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return loadBearerCredential(
    environment,
    "EVIDENCE_INGEST_BEARER_TOKEN",
    "EVIDENCE_INGEST_BEARER_TOKEN_FILE",
    "EVIDENCE_CREDENTIAL_CONFIGURATION_INVALID",
  );
}

async function loadBearerCredential(
  environment: NodeJS.ProcessEnv,
  inlineName: string,
  fileName: string,
  errorCode: string,
): Promise<string> {
  const inline = environment[inlineName];
  const file = environment[fileName];
  if ((inline === undefined) === (file === undefined)) {
    throw new EvidenceReceiverError(errorCode, 500);
  }
  const credential = inline ?? (await readFile(file as string, "utf8")).trim();
  if (credential.length < 16 || credential.length > 4096) {
    throw new EvidenceReceiverError(errorCode, 500);
  }
  return credential;
}

export async function loadDomainSourceBearerCredential(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return loadBearerCredential(
    environment,
    "DOMAIN_SOURCE_INGEST_BEARER_TOKEN",
    "DOMAIN_SOURCE_INGEST_BEARER_TOKEN_FILE",
    "DOMAIN_SOURCE_CREDENTIAL_CONFIGURATION_INVALID",
  );
}

interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  receiver: EvidenceV1Receiver;
  validator: EvidenceV1BatchValidator;
  wal: DurableSegmentWal<EvidenceV1WalPayload>;
  authorization: ResolvedAuthorizationPolicy;
  maximumRequestBytes: number;
  domainSourceReceiver?: DomainSourceV1Receiver;
  domainSourceValidator?: DomainSourceV1Validator;
  domainSourceWal?: DurableSegmentWal<DomainSourceWalPayload>;
  domainSourceAuthorization?: ResolvedAuthorizationPolicy;
}

async function handleRequest(context: RequestContext): Promise<void> {
  const { request, response } = context;
  const url = new URL(request.url ?? "/", "http://gateway.local");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      walBytes: await context.wal.size(),
      ...(context.domainSourceWal === undefined
        ? {}
        : { domainSourceWalBytes: await context.domainSourceWal.size() }),
    });
    return;
  }
  if (
    url.pathname === "/v1/domain-source/batches" ||
    url.pathname === "/v1/domain-source/episode-seals"
  ) {
    await handleDomainSourceRequest(context, url.pathname);
    return;
  }
  if (url.pathname !== "/v1/evidence/batches") {
    throw new EvidenceReceiverError("EVIDENCE_ROUTE_NOT_FOUND", 404);
  }
  assertHeaders(request, context.authorization);
  if (request.method === "HEAD") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== "POST") throw new EvidenceReceiverError("EVIDENCE_METHOD_INVALID", 405);
  const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new EvidenceReceiverError("EVIDENCE_CONTENT_TYPE_INVALID", 415);
  }
  const bytes = await readRequestBody(request, context.maximumRequestBytes);
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw new EvidenceReceiverError("EVIDENCE_JSON_INVALID", 400);
  }
  const batch = context.validator.assertBatch(value);
  const acknowledgement = await context.receiver.accept(batch);
  // The Runtime transport rejects every extra response property.
  sendJson(response, 202, {
    lastAcknowledgedSequence: acknowledgement.lastAcknowledgedSequence,
  });
}

async function handleDomainSourceRequest(context: RequestContext, pathname: string): Promise<void> {
  const { request, response } = context;
  if (
    context.domainSourceReceiver === undefined ||
    context.domainSourceValidator === undefined ||
    context.domainSourceWal === undefined
  ) {
    throw new EvidenceReceiverError("DOMAIN_SOURCE_ROUTE_NOT_CONFIGURED", 404);
  }
  if (context.domainSourceAuthorization === undefined) {
    throw new EvidenceReceiverError("DOMAIN_SOURCE_AUTHORIZATION_POLICY_INVALID", 500);
  }
  assertContractHeaders(
    request,
    context.domainSourceAuthorization,
    DOMAIN_SOURCE_V1_HEADER,
    DOMAIN_SOURCE_V1_CONTRACT,
    "DOMAIN_SOURCE",
  );
  if (request.method === "HEAD") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== "POST") {
    throw new EvidenceReceiverError("DOMAIN_SOURCE_METHOD_INVALID", 405);
  }
  const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new EvidenceReceiverError("DOMAIN_SOURCE_CONTENT_TYPE_INVALID", 415);
  }
  const bytes = await readRequestBody(request, context.maximumRequestBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new EvidenceReceiverError("DOMAIN_SOURCE_JSON_INVALID", 400);
  }
  if (pathname === "/v1/domain-source/batches") {
    const batch = context.domainSourceValidator.assertBatch(value);
    sendJson(response, 202, await context.domainSourceReceiver.acceptBatch(batch));
    return;
  }
  const seal = context.domainSourceValidator.assertEpisodeSeal(value);
  sendJson(response, 202, await context.domainSourceReceiver.acceptSeal(seal));
}

function assertHeaders(
  request: IncomingMessage,
  authorization: ResolvedAuthorizationPolicy,
): void {
  if (request.headers[LEGACY_CONTRACT_HEADER] !== undefined) {
    throw new EvidenceReceiverError("EVIDENCE_LEGACY_HEADER_FORBIDDEN", 400);
  }
  if (request.headers[EVIDENCE_CONTRACT_HEADER] !== EVIDENCE_CONTRACT_VERSION) {
    throw new EvidenceReceiverError("EVIDENCE_CONTRACT_HEADER_INVALID", 400);
  }
  assertBearerAuthorization(request, authorization, "EVIDENCE_CREDENTIAL_INVALID");
}

function assertContractHeaders(
  request: IncomingMessage,
  authorization: ResolvedAuthorizationPolicy,
  contractHeader: string,
  contractVersion: string,
  prefix: string,
): void {
  if (
    request.headers[LEGACY_CONTRACT_HEADER] !== undefined ||
    (contractHeader !== EVIDENCE_CONTRACT_HEADER &&
      request.headers[EVIDENCE_CONTRACT_HEADER] !== undefined)
  ) {
    throw new EvidenceReceiverError(`${prefix}_FOREIGN_HEADER_FORBIDDEN`, 400);
  }
  if (request.headers[contractHeader] !== contractVersion) {
    throw new EvidenceReceiverError(`${prefix}_CONTRACT_HEADER_INVALID`, 400);
  }
  assertBearerAuthorization(request, authorization, `${prefix}_CREDENTIAL_INVALID`);
}

function assertBearerAuthorization(
  request: IncomingMessage,
  authorization: ResolvedAuthorizationPolicy,
  errorCode: string,
): void {
  if (authorization.profile === "development-anonymous") return;
  const header = request.headers.authorization;
  const matched = typeof header === "string" ? /^Bearer ([^\s]+)$/u.exec(header) : null;
  if (
    !timingSafeEqual(
      credentialDigest(matched?.[1] ?? ""),
      authorization.expectedCredentialDigest,
    )
  ) {
    throw new EvidenceReceiverError(errorCode, 401);
  }
}

async function readRequestBody(request: IncomingMessage, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined && Number(declaredLength) > maximumBytes) {
    throw new EvidenceReceiverError("EVIDENCE_REQUEST_TOO_LARGE", 413);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const candidate of request) {
    const chunk = Buffer.isBuffer(candidate) ? candidate : Buffer.from(candidate as Uint8Array);
    total += chunk.byteLength;
    if (total > maximumBytes) throw new EvidenceReceiverError("EVIDENCE_REQUEST_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  if (total === 0) throw new EvidenceReceiverError("EVIDENCE_JSON_INVALID", 400);
  return Buffer.concat(chunks, total);
}

function recoveredState(payloads: readonly EvidenceV1WalPayload[]): {
  batchHashes: Map<string, Pick<EvidenceV1BatchRequest, "firstSequence" | "lastSequence">>;
  records: Map<string, Pick<EvidenceV1Record, "payloadHash" | "evidenceSequence">>;
  sequences: Map<string, Pick<EvidenceV1Record, "recordId" | "payloadHash">>;
} {
  const batchHashes = new Map<
    string,
    Pick<EvidenceV1BatchRequest, "firstSequence" | "lastSequence">
  >();
  const records = new Map<
    string,
    Pick<EvidenceV1Record, "payloadHash" | "evidenceSequence">
  >();
  const sequences = new Map<
    string,
    Pick<EvidenceV1Record, "recordId" | "payloadHash">
  >();
  for (const payload of payloads) {
    if (payload.kind !== "sdar-evidence-v1") {
      throw new EvidenceReceiverError("EVIDENCE_WAL_PAYLOAD_INVALID", 503);
    }
    const { batch } = payload;
    batchHashes.set(batch.batchHash, {
      firstSequence: batch.firstSequence,
      lastSequence: batch.lastSequence,
    });
    for (const record of batch.records) {
      const existingRecord = records.get(record.recordId);
      if (existingRecord !== undefined && existingRecord.payloadHash !== record.payloadHash) {
        throw new EvidenceReceiverError("EVIDENCE_WAL_RECORD_CONFLICT", 503);
      }
      const existingSequence = sequences.get(record.evidenceSequence);
      if (
        existingSequence !== undefined &&
        (existingSequence.recordId !== record.recordId ||
          existingSequence.payloadHash !== record.payloadHash)
      ) {
        throw new EvidenceReceiverError("EVIDENCE_WAL_SEQUENCE_CONFLICT", 503);
      }
      records.set(record.recordId, {
        payloadHash: record.payloadHash,
        evidenceSequence: record.evidenceSequence,
      });
      sequences.set(record.evidenceSequence, {
        recordId: record.recordId,
        payloadHash: record.payloadHash,
      });
    }
  }
  return { batchHashes, records, sequences };
}

export function domainSourceWalPartition(
  identity: Readonly<{
    application: string;
    tenantId: string;
    projectId: string;
  }>,
): string {
  return evidenceWalPartition({
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    application: identity.application,
    tenantId: identity.tenantId,
    projectId: identity.projectId,
  });
}

function domainSourceRecoveredState(frames: readonly Readonly<{ payload: DomainSourceWalPayload }>[]): {
  batchHashes: Set<string>;
  recordIdentities: Map<string, Readonly<{ payloadHash: string; sequence: string }>>;
  sequences: Map<string, Readonly<{ identity: string; payloadHash: string }>>;
  seals: Map<string, string>;
} {
  const batchHashes = new Set<string>();
  const recordIdentities = new Map<
    string,
    Readonly<{ payloadHash: string; sequence: string }>
  >();
  const sequences = new Map<string, Readonly<{ identity: string; payloadHash: string }>>();
  const seals = new Map<string, string>();
  for (const frame of frames) {
    const payload = frame.payload;
    if (payload.kind === "sdar-domain-source-v1-batch") {
      batchHashes.add(payload.batch.batchHash);
      for (const record of payload.batch.records) {
        const identity = createDomainSourceRecordIdentityHash(record);
        const existing = recordIdentities.get(identity);
        if (existing !== undefined && existing.payloadHash !== record.payloadHash) {
          throw new EvidenceReceiverError("DOMAIN_SOURCE_WAL_RECORD_CONFLICT", 503);
        }
        if (existing !== undefined && existing.sequence !== record.sequence) {
          throw new EvidenceReceiverError("DOMAIN_SOURCE_WAL_IDENTITY_SEQUENCE_CONFLICT", 503);
        }
        const existingSequence = sequences.get(record.sequence);
        if (
          existingSequence !== undefined &&
          (existingSequence.identity !== identity ||
            existingSequence.payloadHash !== record.payloadHash)
        ) {
          throw new EvidenceReceiverError("DOMAIN_SOURCE_WAL_SEQUENCE_CONFLICT", 503);
        }
        recordIdentities.set(identity, {
          payloadHash: record.payloadHash,
          sequence: record.sequence,
        });
        sequences.set(record.sequence, { identity, payloadHash: record.payloadHash });
      }
      continue;
    }
    if (payload.kind === "sdar-domain-source-v1-seal") {
      const identity = createDomainSourceSealIdentityHash(payload.seal);
      const contentHash = hashCanonicalDomainSourceJson(payload.seal);
      const existing = seals.get(identity);
      if (existing !== undefined && existing !== contentHash) {
        throw new EvidenceReceiverError("DOMAIN_SOURCE_WAL_SEAL_CONFLICT", 503);
      }
      seals.set(identity, contentHash);
      continue;
    }
    throw new EvidenceReceiverError("DOMAIN_SOURCE_WAL_PAYLOAD_INVALID", 503);
  }
  return { batchHashes, recordIdentities, sequences, seals };
}

function credentialDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function resolveAuthorizationPolicy(
  authorization: TelemetryHttpAuthorizationPolicy,
  errorCode: string,
): ResolvedAuthorizationPolicy {
  if (authorization.profile === "development-anonymous") {
    return Object.freeze({ profile: "development-anonymous" });
  }
  if (
    authorization.bearerCredential.length < 16 ||
    authorization.bearerCredential.length > 4_096
  ) {
    throw new EvidenceReceiverError(errorCode, 500);
  }
  return Object.freeze({
    profile: "bearer",
    expectedCredentialDigest: credentialDigest(authorization.bearerCredential),
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: unknown): void {
  const receiverError = asReceiverError(error);
  sendJson(response, receiverError.statusCode, { errorCode: receiverError.code });
}

function asReceiverError(error: unknown): EvidenceReceiverError {
  if (error instanceof EvidenceReceiverError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_-]{2,127}$/u.test(code)) {
      if (code === "WAL_HIGH_WATER") return new EvidenceReceiverError(code, 503);
      if (code.startsWith("WAL_")) return new EvidenceReceiverError(code, 503);
      return new EvidenceReceiverError(code, 400);
    }
  }
  return new EvidenceReceiverError("EVIDENCE_INGESTION_FAILED", 500);
}
