import { Buffer } from "node:buffer";

import {
  createDomainSourcePayloadHash,
  createDomainSourceRecordIdentityHash,
  type DomainSourceContractId,
  type DomainSourceRecord,
  type DomainSourceSha256,
} from "../../../packages/telemetry-contracts/src/index.js";
import type { ClickHouseQueryOptions } from "../../../packages/telemetry-clickhouse/src/index.js";
import {
  DOMAIN_PROJECTION_DESCRIPTORS,
  type DomainProjectionDescriptor,
} from "../../../packages/telemetry-projection-registry/src/domain.js";

export const DOMAIN_PROJECTION_LOOKBACK_MS = 1_800_000;
export const DOMAIN_SOURCE_CURSOR_VERSION = 1 as const;
const MAX_SOURCE_PAGE_SIZE = 1_000;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z?$/u;
const EXACT_SOURCE_TABLES = new Set(
  DOMAIN_PROJECTION_DESCRIPTORS.map(
    (descriptor) => descriptor.sourceQualifiedTable,
  ),
);

export type DomainSourceCursor = Readonly<{
  version: typeof DOMAIN_SOURCE_CURSOR_VERSION;
  kind: "ordinary" | "state";
  occurredAt: string;
  sequence: string;
  stateSnapshotVersion: string | null;
  recordId: string;
  sourceRevision: string;
}>;

export type DomainSourceReadRecord = Readonly<{
  identityHash: DomainSourceSha256;
  contentHash: DomainSourceSha256;
  cursor: DomainSourceCursor;
  record: DomainSourceRecord;
  raw: Readonly<Record<string, unknown>>;
}>;

export type DomainSourceReadPage = Readonly<{
  records: readonly DomainSourceReadRecord[];
  nextCursor: DomainSourceCursor | null;
  duplicateCount: number;
  scannedCount: number;
  lookbackFrom: string;
  readThrough: string;
}>;

export interface DomainSourceQueryClient {
  query(sql: string, options?: ClickHouseQueryOptions): Promise<string>;
}

export interface DomainSourceIdentityIndex {
  contentHash(
    identityHash: DomainSourceSha256,
  ): Promise<DomainSourceSha256 | undefined>;
}

export class ClickHouseDomainSourceReader {
  constructor(
    private readonly clickHouse: DomainSourceQueryClient,
    private readonly identityIndex: DomainSourceIdentityIndex,
    private readonly lookbackMs = DOMAIN_PROJECTION_LOOKBACK_MS,
  ) {
    if (
      !Number.isSafeInteger(lookbackMs) ||
      lookbackMs < 0 ||
      lookbackMs > 86_400_000
    ) {
      throw sourceReaderError("DOMAIN_SOURCE_LOOKBACK_INVALID");
    }
  }

  async readPage(
    input: Readonly<{
      descriptor: DomainProjectionDescriptor;
      checkpoint: DomainSourceCursor | null;
      readThrough: string;
      limit: number;
    }>,
  ): Promise<DomainSourceReadPage> {
    assertPageLimit(input.limit);
    const readThrough = normalizeTimestamp(input.readThrough);
    const checkpoint =
      input.checkpoint === null ? null : assertCursor(input.checkpoint);
    const start =
      checkpoint === null
        ? "1970-01-01T00:00:00.000Z"
        : new Date(
            Math.max(0, Date.parse(checkpoint.occurredAt) - this.lookbackMs),
          ).toISOString();
    if (
      checkpoint !== null &&
      compareTimestamp(checkpoint.occurredAt, readThrough) > 0
    ) {
      throw sourceReaderError("DOMAIN_SOURCE_CURSOR_AHEAD");
    }
    const raw = await this.clickHouse.query(
      buildDomainSourcePageQuery(
        input.descriptor,
        start,
        readThrough,
        input.limit,
      ),
      { readonly: 2, maxResultRows: input.limit },
    );
    const rows = parseRows(raw);
    const local = new Map<DomainSourceSha256, DomainSourceSha256>();
    const accepted: DomainSourceReadRecord[] = [];
    let duplicateCount = 0;
    let nextCursor = checkpoint;
    for (const row of rows) {
      const candidate = sourceRecordFromRow(input.descriptor, row);
      const localHash = local.get(candidate.identityHash);
      const persistedHash =
        localHash ??
        (await this.identityIndex.contentHash(candidate.identityHash));
      if (persistedHash !== undefined) {
        if (persistedHash !== candidate.contentHash) {
          throw sourceReaderError("SOURCE_CONTENT_CONFLICT");
        }
        duplicateCount += 1;
      } else {
        local.set(candidate.identityHash, candidate.contentHash);
        accepted.push(candidate);
      }
      if (
        nextCursor === null ||
        compareDomainSourceCursor(candidate.cursor, nextCursor) > 0
      ) {
        nextCursor = candidate.cursor;
      }
    }
    return Object.freeze({
      records: Object.freeze(accepted),
      nextCursor,
      duplicateCount,
      scannedCount: rows.length,
      lookbackFrom: start,
      readThrough,
    });
  }
}

export function buildDomainSourcePageQuery(
  descriptor: DomainProjectionDescriptor,
  lookbackFrom: string,
  readThrough: string,
  limit: number,
): string {
  assertPageLimit(limit);
  if (!EXACT_SOURCE_TABLES.has(descriptor.sourceQualifiedTable)) {
    throw sourceReaderError("DOMAIN_SOURCE_DESCRIPTOR_NOT_LOCKED");
  }
  const from = timestampExpression(normalizeTimestamp(lookbackFrom));
  const through = timestampExpression(normalizeTimestamp(readThrough));
  const order = isStateDescriptor(descriptor)
    ? "occurred_at, state_snapshot_version, record_id, source_revision"
    : "occurred_at, sequence, record_id, source_revision";
  return `SELECT *
FROM ${descriptor.sourceQualifiedTable}
WHERE occurred_at >= ${from}
  AND occurred_at <= ${through}
ORDER BY ${order}
LIMIT ${String(limit)}
FORMAT JSON`;
}

export function compareDomainSourceCursor(
  left: DomainSourceCursor,
  right: DomainSourceCursor,
): number {
  const checkedLeft = assertCursor(left);
  const checkedRight = assertCursor(right);
  if (checkedLeft.kind !== checkedRight.kind) {
    throw sourceReaderError("DOMAIN_SOURCE_CURSOR_KIND_MISMATCH");
  }
  const occurred = compareTimestamp(
    checkedLeft.occurredAt,
    checkedRight.occurredAt,
  );
  if (occurred !== 0) return occurred;
  if (left.kind === "state") {
    const state = compareUInt64(
      left.stateSnapshotVersion!,
      right.stateSnapshotVersion!,
    );
    if (state !== 0) return state;
  } else {
    const sequence = compareUInt64(left.sequence, right.sequence);
    if (sequence !== 0) return sequence;
  }
  const record = compareUnicode(left.recordId, right.recordId);
  if (record !== 0) return record;
  return compareUInt64(left.sourceRevision, right.sourceRevision);
}

export function sourceRecordFromRow(
  descriptor: DomainProjectionDescriptor,
  row: Record<string, unknown>,
): DomainSourceReadRecord {
  const sourceContractId = requiredString(
    row,
    "source_contract_id",
  ) as DomainSourceContractId;
  if (sourceContractId !== descriptor.sourceContractId) {
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  }
  const sourceContractVersion = requiredString(row, "source_contract_version");
  if (sourceContractVersion !== "1")
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  const payload = jsonObject(row["payload_json"]);
  const contentHash = fixedHash(row["payload_sha256"]);
  if (createDomainSourcePayloadHash(payload) !== contentHash) {
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  }
  const occurredAt = normalizeTimestamp(requiredString(row, "occurred_at"));
  const sequence = positiveUInt64("sequence", requiredString(row, "sequence"));
  const sourceRevision = positiveUInt64(
    "source_revision",
    requiredString(row, "source_revision"),
  );
  const stateSnapshotVersion = isStateDescriptor(descriptor)
    ? positiveUInt64(
        "state_snapshot_version",
        decimalValue(row["state_snapshot_version"], "state_snapshot_version"),
      )
    : null;
  const optional = (field: string): string | undefined => {
    const value = row[field];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const record: DomainSourceRecord = Object.freeze({
    sourceContractId,
    sourceContractVersion: "1",
    tenantId: requiredString(row, "tenant_id"),
    projectId: requiredString(row, "project_id"),
    environment: environment(row["environment"]),
    recordId: requiredString(row, "record_id"),
    episodeId: requiredString(row, "episode_id"),
    ...(optional("task_id") === undefined
      ? {}
      : { taskId: optional("task_id") }),
    ...(optional("context_id") === undefined
      ? {}
      : { contextId: optional("context_id") }),
    agentId: requiredString(row, "agent_id"),
    ...(optional("agent_version") === undefined
      ? {}
      : { agentVersion: optional("agent_version") }),
    ...(optional("scenario_id") === undefined
      ? {}
      : { scenarioId: optional("scenario_id") }),
    ...(optional("correlation_id") === undefined
      ? {}
      : { correlationId: optional("correlation_id") }),
    sequence,
    sourceRevision,
    producerId: requiredString(row, "producer_id"),
    producerVersion: requiredString(row, "producer_version"),
    occurredAt,
    payload,
    payloadHash: contentHash,
  });
  const identityHash = createDomainSourceRecordIdentityHash(record);
  return deepFreeze({
    identityHash,
    contentHash,
    cursor: {
      version: DOMAIN_SOURCE_CURSOR_VERSION,
      kind: isStateDescriptor(descriptor) ? "state" : "ordinary",
      occurredAt,
      sequence,
      stateSnapshotVersion,
      recordId: record.recordId,
      sourceRevision,
    },
    record,
    raw: structuredClone(row),
  });
}

function assertCursor(value: DomainSourceCursor): DomainSourceCursor {
  if (value.version !== DOMAIN_SOURCE_CURSOR_VERSION) {
    throw sourceReaderError("DOMAIN_SOURCE_CURSOR_VERSION_INVALID");
  }
  normalizeTimestamp(value.occurredAt);
  positiveUInt64("sequence", value.sequence);
  positiveUInt64("sourceRevision", value.sourceRevision);
  if (value.recordId.trim() === "")
    throw sourceReaderError("DOMAIN_SOURCE_CURSOR_INVALID");
  if (value.kind === "state") {
    if (value.stateSnapshotVersion === null)
      throw sourceReaderError("DOMAIN_SOURCE_CURSOR_INVALID");
    positiveUInt64("stateSnapshotVersion", value.stateSnapshotVersion);
  } else if (value.kind === "ordinary") {
    if (value.stateSnapshotVersion !== null)
      throw sourceReaderError("DOMAIN_SOURCE_CURSOR_INVALID");
  } else {
    throw sourceReaderError("DOMAIN_SOURCE_CURSOR_INVALID");
  }
  return value;
}

function parseRows(raw: string): Record<string, unknown>[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw sourceReaderError("DOMAIN_SOURCE_RESPONSE_INVALID");
  }
  if (!isRecord(value) || !Array.isArray(value["data"])) {
    throw sourceReaderError("DOMAIN_SOURCE_RESPONSE_INVALID");
  }
  return value["data"].map((row) => {
    if (!isRecord(row))
      throw sourceReaderError("DOMAIN_SOURCE_RESPONSE_INVALID");
    return row;
  });
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw sourceReaderError("SOURCE_CONTRACT_INVALID");
    }
  }
  if (!isRecord(parsed)) throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  return deepFreeze(structuredClone(parsed));
}

function fixedHash(value: unknown): DomainSourceSha256 {
  if (typeof value !== "string")
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  const normalized = value.startsWith("sha256:") ? value : `sha256:${value}`;
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) {
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  }
  return normalized as DomainSourceSha256;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  }
  return value;
}

function decimalValue(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  throw sourceReaderError(
    field === "state_snapshot_version"
      ? "SOURCE_CONTRACT_INVALID"
      : "SOURCE_REVISION_INVALID",
  );
}

function environment(value: unknown): "dev" | "test" | "staging" | "prod" {
  if (
    value === "dev" ||
    value === "test" ||
    value === "staging" ||
    value === "prod"
  ) {
    return value;
  }
  throw sourceReaderError("ENVIRONMENT_MAPPING_UNRESOLVED");
}

function normalizeTimestamp(value: string): string {
  const match = UTC_TIMESTAMP.exec(value);
  if (match === null) {
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  }
  const milliseconds = Number(
    (match[7] ?? "").padEnd(3, "0").slice(0, 3) || "0",
  );
  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    milliseconds,
  );
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3]) ||
    date.getUTCHours() !== Number(match[4]) ||
    date.getUTCMinutes() !== Number(match[5]) ||
    date.getUTCSeconds() !== Number(match[6]) ||
    date.getUTCMilliseconds() !== milliseconds
  ) {
    throw sourceReaderError("SOURCE_CONTRACT_INVALID");
  }
  return date.toISOString();
}

function timestampExpression(value: string): string {
  return `parseDateTime64BestEffortOrNull(unhex('${Buffer.from(value, "utf8").toString("hex")}'),9,'UTC')`;
}

function positiveUInt64(field: string, value: string): string {
  if (!/^[1-9][0-9]*$/u.test(value) || BigInt(value) > MAX_UINT64) {
    throw sourceReaderError(
      field === "source_revision" || field === "sourceRevision"
        ? "SOURCE_REVISION_INVALID"
        : "SOURCE_CONTRACT_INVALID",
    );
  }
  return value;
}

function compareUInt64(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return compareUnicode(left, right);
}

function compareTimestamp(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function compareUnicode(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStateDescriptor(descriptor: DomainProjectionDescriptor): boolean {
  return descriptor.definition.cursorPolicy.fields.includes(
    "state_snapshot_version",
  );
}

function assertPageLimit(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_SOURCE_PAGE_SIZE
  ) {
    throw sourceReaderError("DOMAIN_SOURCE_PAGE_LIMIT_INVALID");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value as Record<string, unknown>))
    deepFreeze(nested);
  return Object.freeze(value);
}

function sourceReaderError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
