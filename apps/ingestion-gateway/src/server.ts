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

export const EVIDENCE_CONTRACT_HEADER = "x-sdar-evidence-contract";
export const EVIDENCE_CONTRACT_VERSION = "sdar.evidence/v1";
export const LEGACY_CONTRACT_HEADER = "x-sdar-telemetry-contract";

export interface EvidenceV1BatchValidator {
  assertBatch(value: unknown): EvidenceV1BatchRequest;
}

export interface EvidenceGatewayDependencies {
  readonly validator: EvidenceV1BatchValidator;
  readonly wal: DurableSegmentWal<EvidenceV1WalPayload>;
  readonly bearerCredential: string;
  readonly maximumRequestBytes?: number;
  readonly clock?: Readonly<{ now(): string }>;
}

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

export function createIngestionGateway(dependencies: EvidenceGatewayDependencies): Server {
  const receiver = new EvidenceV1Receiver(dependencies.wal, dependencies.clock);
  const maximumRequestBytes = dependencies.maximumRequestBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumRequestBytes) || maximumRequestBytes < 1) {
    throw new EvidenceReceiverError("EVIDENCE_REQUEST_LIMIT_INVALID", 500);
  }
  const expectedCredentialDigest = credentialDigest(dependencies.bearerCredential);

  return http.createServer((request: IncomingMessage, response: ServerResponse) => {
    void handleRequest({
      request,
      response,
      receiver,
      validator: dependencies.validator,
      wal: dependencies.wal,
      expectedCredentialDigest,
      maximumRequestBytes,
    }).catch((error: unknown) => sendError(response, error));
  });
}

export async function loadEvidenceBearerCredential(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const inline = environment["EVIDENCE_INGEST_BEARER_TOKEN"];
  const file = environment["EVIDENCE_INGEST_BEARER_TOKEN_FILE"];
  if ((inline === undefined) === (file === undefined)) {
    throw new EvidenceReceiverError("EVIDENCE_CREDENTIAL_CONFIGURATION_INVALID", 500);
  }
  const credential = inline ?? (await readFile(file as string, "utf8")).trim();
  if (credential.length < 16 || credential.length > 4096) {
    throw new EvidenceReceiverError("EVIDENCE_CREDENTIAL_CONFIGURATION_INVALID", 500);
  }
  return credential;
}

interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  receiver: EvidenceV1Receiver;
  validator: EvidenceV1BatchValidator;
  wal: DurableSegmentWal<EvidenceV1WalPayload>;
  expectedCredentialDigest: Buffer;
  maximumRequestBytes: number;
}

async function handleRequest(context: RequestContext): Promise<void> {
  const { request, response } = context;
  const url = new URL(request.url ?? "/", "http://gateway.local");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", walBytes: await context.wal.size() });
    return;
  }
  if (url.pathname !== "/v1/evidence/batches") {
    throw new EvidenceReceiverError("EVIDENCE_ROUTE_NOT_FOUND", 404);
  }
  assertHeaders(request, context.expectedCredentialDigest);
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

function assertHeaders(request: IncomingMessage, expectedCredentialDigest: Buffer): void {
  if (request.headers[LEGACY_CONTRACT_HEADER] !== undefined) {
    throw new EvidenceReceiverError("EVIDENCE_LEGACY_HEADER_FORBIDDEN", 400);
  }
  if (request.headers[EVIDENCE_CONTRACT_HEADER] !== EVIDENCE_CONTRACT_VERSION) {
    throw new EvidenceReceiverError("EVIDENCE_CONTRACT_HEADER_INVALID", 400);
  }
  const authorization = request.headers.authorization;
  const matched = typeof authorization === "string" ? /^Bearer ([^\s]+)$/u.exec(authorization) : null;
  const actualDigest = credentialDigest(matched?.[1] ?? "");
  if (!timingSafeEqual(actualDigest, expectedCredentialDigest)) {
    throw new EvidenceReceiverError("EVIDENCE_CREDENTIAL_INVALID", 401);
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

function credentialDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
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
