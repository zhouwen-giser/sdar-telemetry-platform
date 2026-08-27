import type {
  DomainSourceQueryClient,
  DomainSourceReadRecord,
} from "./source-reader.js";
import { sourceRecordFromRow } from "./source-reader.js";
import {
  DOMAIN_PROJECTION_DESCRIPTORS,
  type DomainProjectionDescriptor,
} from "../../../packages/telemetry-projection-registry/src/domain.js";
import type {
  DomainRuntimeScope,
  IngestionCursor,
} from "../../../packages/telemetry-control-postgres/src/domain-runtime.js";
import { failure } from "../../../packages/telemetry-control-postgres/src/domain-runtime.js";

export type ScopedSourceRecord = DomainSourceReadRecord &
  Readonly<{ ingestionCursor: IngestionCursor }>;
export interface ScopedSourceInput {
  scope: DomainRuntimeScope;
  producerId: string;
  activatedAt: string;
  descriptor: DomainProjectionDescriptor;
  cursor: IngestionCursor | null;
  limit: number;
}
const text = (value: string): string =>
  `unhex('${Buffer.from(value, "utf8").toString("hex")}')`;
const time = (value: string): string => {
  if (!Number.isFinite(Date.parse(value)))
    throw failure("DOMAIN_SOURCE_CURSOR_INVALID");
  return `parseDateTime64BestEffort(${text(value)},9,'UTC')`;
};
export function scopedSourceQuery(input: ScopedSourceInput): string {
  if (
    !DOMAIN_PROJECTION_DESCRIPTORS.some(
      (d) =>
        d.definitionHash === input.descriptor.definitionHash &&
        d.sourceQualifiedTable === input.descriptor.sourceQualifiedTable,
    ) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 1000 ||
    [input.scope.tenantId, input.scope.projectId, input.producerId].some(
      (value) => !value || value.length > 512,
    )
  )
    throw failure("DOMAIN_SOURCE_SCOPE_INVALID");
  const cursor = input.cursor;
  if (
    cursor !== null &&
    (!/^[1-9][0-9]*$/u.test(cursor.sourceRevision) || !cursor.recordId)
  )
    throw failure("DOMAIN_SOURCE_CURSOR_INVALID");
  return `SELECT * FROM ${input.descriptor.sourceQualifiedTable}
WHERE tenant_id=${text(input.scope.tenantId)} AND project_id=${text(input.scope.projectId)} AND producer_id=${text(input.producerId)}
  AND ingested_at>=${time(input.activatedAt)} AND ingested_at<=now64(3)
  ${cursor === null ? "" : `AND (ingested_at,record_id,source_revision)>(${time(cursor.ingestedAt)},${text(cursor.recordId)},toUInt64(${text(cursor.sourceRevision)}))`}
ORDER BY ingested_at,record_id,source_revision LIMIT ${String(input.limit)} FORMAT JSON`;
}
export async function readScopedSource(
  client: DomainSourceQueryClient,
  input: ScopedSourceInput,
): Promise<readonly ScopedSourceRecord[]> {
  const value: unknown = JSON.parse(
    await client.query(scopedSourceQuery(input), {
      readonly: 2,
      maxResultRows: input.limit,
    }),
  );
  if (
    value === null ||
    typeof value !== "object" ||
    !("data" in value) ||
    !Array.isArray(value.data) ||
    value.data.length > input.limit
  )
    throw failure("DOMAIN_SOURCE_RESPONSE_INVALID");
  return value.data.map((raw: unknown) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      throw failure("DOMAIN_SOURCE_RESPONSE_INVALID");
    const row = raw as Record<string, unknown>;
    const parsed = sourceRecordFromRow(input.descriptor, row);
    if (
      parsed.record.tenantId !== input.scope.tenantId ||
      parsed.record.projectId !== input.scope.projectId ||
      parsed.record.producerId !== input.producerId
    )
      throw failure("DOMAIN_SOURCE_SCOPE_CONFLICT");
    const stamp = row["ingested_at"];
    if (typeof stamp !== "string")
      throw failure("DOMAIN_SOURCE_RESPONSE_INVALID");
    // Keep DateTime64 sub-millisecond precision: rounding here can strand the keyset cursor.
    const ingestedAt = stamp.includes("T")
      ? stamp
      : `${stamp.replace(" ", "T")}Z`;
    if (!Number.isFinite(Date.parse(ingestedAt)))
      throw failure("DOMAIN_SOURCE_RESPONSE_INVALID");
    if (Date.parse(ingestedAt) < Date.parse(input.activatedAt))
      throw failure("DOMAIN_SOURCE_BEFORE_ACTIVATION");
    return {
      ...parsed,
      ingestionCursor: {
        ingestedAt,
        recordId: parsed.record.recordId,
        sourceRevision: parsed.record.sourceRevision,
      },
    };
  });
}
