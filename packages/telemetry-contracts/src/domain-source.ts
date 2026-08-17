import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import {
  DomainProjectionContractError,
  canonicalizeDomainProjectionJson,
} from "./domain-projection.js";

export const DOMAIN_SOURCE_V1_CONTRACT = "sdar.domain-source/v1" as const;
export const DOMAIN_SOURCE_V1_HEADER = "x-sdar-domain-source-contract" as const;
export const DOMAIN_SOURCE_V1_SOURCE_CONTRACT_VERSION = "1" as const;
export const DOMAIN_SOURCE_V1_MAX_BATCH_RECORDS = 1_000;

export const DOMAIN_SOURCE_V1_CONTRACT_IDS = Object.freeze([
  "sdar.domain-source/commander/mcp-action",
  "sdar.domain-source/commander/mcp-receipt",
  "sdar.domain-source/commander/capability-track-sample",
  "sdar.domain-source/commander/error-recovery",
  "sdar.domain-source/commander/ugv-state-snapshot",
  "sdar.domain-source/npc/mission-tool-call",
  "sdar.domain-source/npc/mcp-receipt",
  "sdar.domain-source/npc/hmi-approval",
  "sdar.domain-source/npc/preemption-record",
  "sdar.domain-source/npc/blackboard-snapshot",
] as const);

export type DomainSourceApplication = "commander" | "npc";
export type DomainSourceContractId = (typeof DOMAIN_SOURCE_V1_CONTRACT_IDS)[number];
export type DomainSourceSha256 = `sha256:${string}`;

export type DomainSourceRecord = Readonly<{
  sourceContractId: DomainSourceContractId;
  sourceContractVersion: typeof DOMAIN_SOURCE_V1_SOURCE_CONTRACT_VERSION;
  tenantId: string;
  projectId: string;
  environment: "dev" | "test" | "staging" | "prod";
  recordId: string;
  episodeId: string;
  taskId?: string;
  contextId?: string;
  agentId: string;
  agentVersion?: string;
  scenarioId?: string;
  correlationId?: string;
  sequence: string;
  sourceRevision: string;
  producerId: string;
  producerVersion: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
  payloadHash: DomainSourceSha256;
}>;

export type DomainSourceBatchRequest = Readonly<{
  contractVersion: typeof DOMAIN_SOURCE_V1_CONTRACT;
  batchId: string;
  application: DomainSourceApplication;
  firstSequence: string;
  lastSequence: string;
  records: readonly DomainSourceRecord[];
  batchHash: DomainSourceSha256;
}>;

export type DomainSourceBatchUnsigned = Omit<DomainSourceBatchRequest, "batchHash">;

export type DomainSourceEpisodeSealRequest = Readonly<{
  contractVersion: typeof DOMAIN_SOURCE_V1_CONTRACT;
  application: DomainSourceApplication;
  tenantId: string;
  projectId: string;
  environment: "dev" | "test" | "staging" | "prod";
  sealId: string;
  sealRevision: string;
  sourceContractId: DomainSourceContractId;
  sourceContractVersion: typeof DOMAIN_SOURCE_V1_SOURCE_CONTRACT_VERSION;
  episodeId: string;
  finalSequence: string;
  finalSourceRevision: string;
  sourceRecordCount: string;
  sourceSnapshotHash: DomainSourceSha256;
  sealStatus: "sealed" | "superseded" | "invalid";
  producerId: string;
  producerVersion: string;
  payload: Readonly<Record<string, unknown>>;
  sealedAt: string;
}>;

export type DomainSourceBatchAcknowledgement = Readonly<{
  lastAcknowledgedSequence: string;
}>;

export type DomainSourceSealAcknowledgement = Readonly<{
  sealId: string;
  sealRevision: string;
}>;

export type DomainSourceContractKind = "batch" | "seal" | "batchAck" | "sealAck";

export interface DomainSourceContractTypeMap {
  readonly batch: DomainSourceBatchRequest;
  readonly seal: DomainSourceEpisodeSealRequest;
  readonly batchAck: DomainSourceBatchAcknowledgement;
  readonly sealAck: DomainSourceSealAcknowledgement;
}

export interface DomainSourceV1Validator {
  readonly schemaRoot: string;
  readonly contractVersion: typeof DOMAIN_SOURCE_V1_CONTRACT;
  readonly sourceContractIds: readonly DomainSourceContractId[];
  assert<K extends DomainSourceContractKind>(
    kind: K,
    value: unknown,
  ): DomainSourceContractTypeMap[K];
  assertBatch(value: unknown): DomainSourceBatchRequest;
  assertEpisodeSeal(value: unknown): DomainSourceEpisodeSealRequest;
  assertBatchAcknowledgement(value: unknown): DomainSourceBatchAcknowledgement;
  assertSealAcknowledgement(value: unknown): DomainSourceSealAcknowledgement;
}

export const DOMAIN_SOURCE_V1_ERROR_CODES = Object.freeze({
  assetInvalid: "DOMAIN_SOURCE_CONTRACT_ASSET_INVALID",
  schemaInvalid: "DOMAIN_SOURCE_SCHEMA_INVALID",
  applicationMismatch: "DOMAIN_SOURCE_APPLICATION_MISMATCH",
  sequenceInvalid: "DOMAIN_SOURCE_SEQUENCE_INVALID",
  identityDuplicate: "DOMAIN_SOURCE_IDENTITY_DUPLICATE",
  payloadHashInvalid: "DOMAIN_SOURCE_PAYLOAD_HASH_INVALID",
  batchHashInvalid: "DOMAIN_SOURCE_BATCH_HASH_INVALID",
  finiteJsonRequired: "DOMAIN_SOURCE_FINITE_JSON_REQUIRED",
} as const);

export class DomainSourceContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "DomainSourceContractError";
  }
}

interface JsonSchema extends Record<string, unknown> {
  readonly $id?: string;
}

interface DomainSourceContractManifest {
  readonly contractVersion: typeof DOMAIN_SOURCE_V1_CONTRACT;
  readonly schemas: readonly Readonly<{
    kind: DomainSourceContractKind;
    path: string;
    canonicalHash: DomainSourceSha256;
  }>[];
}

const schemaAssets = Object.freeze({
  batch: "domain-source-batch.schema.json",
  seal: "domain-source-episode-seal.schema.json",
  batchAck: "domain-source-batch-acknowledgement.schema.json",
  sealAck: "domain-source-seal-acknowledgement.schema.json",
} satisfies Record<DomainSourceContractKind, string>);

const unsignedDecimal = /^(?:0|[1-9][0-9]*)$/u;
const positiveDecimal = /^[1-9][0-9]*$/u;
const maxUInt64 = 18_446_744_073_709_551_615n;
const strictUtc =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

export async function loadDomainSourceV1Validator(
  root?: string,
): Promise<DomainSourceV1Validator> {
  const schemaRoot = path.resolve(
    root ??
      path.join(
        process.cwd(),
        "integrations",
        "domain-source",
        "contracts",
        "v1",
        "schemas",
      ),
  );
  const manifest = await readJson<DomainSourceContractManifest>(
    path.join(path.dirname(schemaRoot), "contract-manifest.json"),
  );
  assertManifest(manifest);

  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat("date-time", { type: "string", validate: isStrictUtcTimestamp });
  const validators = {} as Record<DomainSourceContractKind, ValidateFunction>;
  for (const kind of Object.keys(schemaAssets) as DomainSourceContractKind[]) {
    const filename = schemaAssets[kind];
    const schema = await readJson<JsonSchema>(path.join(schemaRoot, filename));
    const manifestEntry = manifest.schemas.find((entry) => entry.kind === kind);
    if (
      manifestEntry === undefined ||
      manifestEntry.path !== `schemas/${filename}` ||
      manifestEntry.canonicalHash !== hashCanonicalDomainSourceJson(schema)
    ) {
      throw new DomainSourceContractError(
        DOMAIN_SOURCE_V1_ERROR_CODES.assetInvalid,
        `Domain Source schema asset ${filename} does not match its frozen manifest.`,
      );
    }
    try {
      validators[kind] = ajv.compile(schema);
    } catch {
      throw new DomainSourceContractError(
        DOMAIN_SOURCE_V1_ERROR_CODES.assetInvalid,
        `Domain Source schema asset ${filename} cannot compile.`,
      );
    }
  }

  function assert<K extends DomainSourceContractKind>(
    kind: K,
    value: unknown,
  ): DomainSourceContractTypeMap[K] {
    const clone = parseCanonicalClone(value);
    const validator = validators[kind];
    if (!validator(clone)) {
      throw new DomainSourceContractError(
        DOMAIN_SOURCE_V1_ERROR_CODES.schemaInvalid,
        `${kind} schema validation failed: ${schemaErrors(validator.errors)}.`,
      );
    }
    if (kind === "batch") assertBatchIntegrity(clone as DomainSourceBatchRequest);
    if (kind === "seal") assertSealIntegrity(clone as DomainSourceEpisodeSealRequest);
    if (kind === "batchAck") {
      assertUInt64(
        (clone as DomainSourceBatchAcknowledgement).lastAcknowledgedSequence,
        false,
        "lastAcknowledgedSequence",
      );
    }
    if (kind === "sealAck") {
      assertUInt64(
        (clone as DomainSourceSealAcknowledgement).sealRevision,
        true,
        "sealRevision",
      );
    }
    return deepFreeze(clone as DomainSourceContractTypeMap[K]);
  }

  return Object.freeze({
    schemaRoot,
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    sourceContractIds: DOMAIN_SOURCE_V1_CONTRACT_IDS,
    assert,
    assertBatch: (value: unknown) => assert("batch", value),
    assertEpisodeSeal: (value: unknown) => assert("seal", value),
    assertBatchAcknowledgement: (value: unknown) => assert("batchAck", value),
    assertSealAcknowledgement: (value: unknown) => assert("sealAck", value),
  });
}

export function canonicalizeDomainSourceJson(value: unknown): string {
  try {
    return canonicalizeDomainProjectionJson(value);
  } catch (error) {
    if (error instanceof DomainSourceContractError) throw error;
    const field = error instanceof DomainProjectionContractError ? error.field : undefined;
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.finiteJsonRequired,
      "Domain Source content must be bounded finite canonical JSON.",
      field,
    );
  }
}

export function hashCanonicalDomainSourceJson(value: unknown): DomainSourceSha256 {
  return `sha256:${createHash("sha256")
    .update(canonicalizeDomainSourceJson(value))
    .digest("hex")}`;
}

export function createDomainSourcePayloadHash(
  payload: Readonly<Record<string, unknown>>,
): DomainSourceSha256 {
  return hashCanonicalDomainSourceJson(payload);
}

export function createDomainSourceBatchHash(
  batch: DomainSourceBatchUnsigned,
): DomainSourceSha256 {
  return hashCanonicalDomainSourceJson(batch);
}

export function createDomainSourceRecordIdentityHash(
  record: Pick<
    DomainSourceRecord,
    "tenantId" | "projectId" | "sourceContractId" | "recordId" | "sourceRevision"
  >,
): DomainSourceSha256 {
  return hashCanonicalDomainSourceJson([
    record.tenantId,
    record.projectId,
    record.sourceContractId,
    record.recordId,
    record.sourceRevision,
  ]);
}

export function domainSourceApplicationFor(
  sourceContractId: DomainSourceContractId,
): DomainSourceApplication {
  return sourceContractId.startsWith("sdar.domain-source/commander/") ? "commander" : "npc";
}

function assertBatchIntegrity(batch: DomainSourceBatchRequest): void {
  if (batch.records.length === 0 || batch.records.length > DOMAIN_SOURCE_V1_MAX_BATCH_RECORDS) {
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.schemaInvalid,
      "Domain Source batch size is outside the frozen range.",
      "records",
    );
  }
  const seenIdentity = new Set<string>();
  let previous: bigint | undefined;
  for (const [index, record] of batch.records.entries()) {
    assertUInt64(record.sequence, false, `records[${String(index)}].sequence`);
    assertUInt64(record.sourceRevision, true, `records[${String(index)}].sourceRevision`);
    const sequence = BigInt(record.sequence);
    if (previous !== undefined && sequence <= previous) {
      throw new DomainSourceContractError(
        DOMAIN_SOURCE_V1_ERROR_CODES.sequenceInvalid,
        "Domain Source record sequences must be strictly increasing within a batch.",
        `records[${String(index)}].sequence`,
      );
    }
    previous = sequence;
    if (domainSourceApplicationFor(record.sourceContractId) !== batch.application) {
      throw new DomainSourceContractError(
        DOMAIN_SOURCE_V1_ERROR_CODES.applicationMismatch,
        "Every Domain Source record must belong to the batch application.",
        `records[${String(index)}].sourceContractId`,
      );
    }
    const identity = createDomainSourceRecordIdentityHash(record);
    if (seenIdentity.has(identity)) {
      throw new DomainSourceContractError(
        DOMAIN_SOURCE_V1_ERROR_CODES.identityDuplicate,
        "A Domain Source batch cannot contain the same source identity twice.",
        `records[${String(index)}]`,
      );
    }
    seenIdentity.add(identity);
    if (createDomainSourcePayloadHash(record.payload) !== record.payloadHash) {
      throw new DomainSourceContractError(
        DOMAIN_SOURCE_V1_ERROR_CODES.payloadHashInvalid,
        "Domain Source payload hash does not match its canonical payload.",
        `records[${String(index)}].payloadHash`,
      );
    }
  }
  const first = batch.records[0]!;
  const last = batch.records.at(-1)!;
  if (batch.firstSequence !== first.sequence || batch.lastSequence !== last.sequence) {
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.sequenceInvalid,
      "Domain Source batch sequence boundaries do not match its records.",
      "firstSequence",
    );
  }
  const { batchHash, ...unsigned } = batch;
  if (createDomainSourceBatchHash(unsigned) !== batchHash) {
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.batchHashInvalid,
      "Domain Source batch hash does not match its canonical unsigned content.",
      "batchHash",
    );
  }
}

function assertSealIntegrity(seal: DomainSourceEpisodeSealRequest): void {
  assertUInt64(seal.sealRevision, true, "sealRevision");
  assertUInt64(seal.finalSequence, false, "finalSequence");
  assertUInt64(seal.finalSourceRevision, true, "finalSourceRevision");
  assertUInt64(seal.sourceRecordCount, false, "sourceRecordCount");
  if (domainSourceApplicationFor(seal.sourceContractId) !== seal.application) {
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.applicationMismatch,
      "Domain Source seal contract must belong to the declared application.",
      "sourceContractId",
    );
  }
}

function assertUInt64(value: string, positive: boolean, field: string): void {
  if (!(positive ? positiveDecimal : unsignedDecimal).test(value) || BigInt(value) > maxUInt64) {
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.sequenceInvalid,
      `${field} must be a canonical ${positive ? "positive " : ""}UInt64 decimal string.`,
      field,
    );
  }
}

function parseCanonicalClone(value: unknown): unknown {
  return JSON.parse(canonicalizeDomainSourceJson(value)) as unknown;
}

function isStrictUtcTimestamp(value: string): boolean {
  const match = strictUtc.exec(value);
  if (match === null) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const date = new Date(parsed);
  const millis = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3) || "0");
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6]) &&
    date.getUTCMilliseconds() === millis
  );
}

function assertManifest(manifest: DomainSourceContractManifest): void {
  const kinds = Object.keys(schemaAssets) as DomainSourceContractKind[];
  if (
    manifest.contractVersion !== DOMAIN_SOURCE_V1_CONTRACT ||
    !Array.isArray(manifest.schemas) ||
    manifest.schemas.length !== kinds.length ||
    new Set(manifest.schemas.map((entry) => entry.kind)).size !== kinds.length ||
    kinds.some((kind) => !manifest.schemas.some((entry) => entry.kind === kind))
  ) {
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.assetInvalid,
      "Domain Source contract manifest is invalid.",
    );
  }
}

async function readJson<T>(filename: string): Promise<T> {
  try {
    const value = JSON.parse(await readFile(filename, "utf8")) as unknown;
    canonicalizeDomainSourceJson(value);
    return value as T;
  } catch (error) {
    if (error instanceof DomainSourceContractError) throw error;
    throw new DomainSourceContractError(
      DOMAIN_SOURCE_V1_ERROR_CODES.assetInvalid,
      `Domain Source contract asset is unreadable: ${filename}.`,
    );
  }
}

function schemaErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"}:${error.keyword}`)
    .join(", ") || "unknown schema error";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
