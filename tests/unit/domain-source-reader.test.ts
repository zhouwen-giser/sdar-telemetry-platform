import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createDomainSourcePayloadHash,
  createDomainSourceRecordIdentityHash,
  type DomainSourceBatchRequest,
  type DomainSourceSha256,
} from "../../packages/telemetry-contracts/src/index.js";
import { DomainProjectionRegistry } from "../../packages/telemetry-projection-registry/src/domain.js";
import {
  ClickHouseDomainSourceReader,
  DOMAIN_PROJECTION_LOOKBACK_MS,
  buildDomainSourcePageQuery,
  compareDomainSourceCursor,
  type DomainSourceCursor,
  type DomainSourceIdentityIndex,
} from "../../apps/domain-projection-worker/src/source-reader.js";

test("bounded lookback recovers a late record once and never moves checkpoint backward", async () => {
  const batch = await fixtureBatch("commander-five-records.batch.json");
  const original = batch.records[0]!;
  const descriptor = new DomainProjectionRegistry().resolveSource(original.sourceContractId)!;
  const late = {
    ...original,
    recordId: "phase6-late-record",
    sequence: "9",
    sourceRevision: "1",
    occurredAt: "2026-08-17T11:50:00.000Z",
    payload: { ...original.payload, late: true },
  };
  late.payloadHash = createDomainSourcePayloadHash(late.payload);
  const duplicate = { ...original, occurredAt: "2026-08-17T11:55:00.000Z" };
  const checkpoint = cursor("2026-08-17T12:00:00.000Z", "10", "checkpoint-record", "1");
  const known = new MemoryIdentityIndex([
    [createDomainSourceRecordIdentityHash(duplicate), duplicate.payloadHash],
  ]);
  const client = new FakeQueryClient([sourceRow(late), sourceRow(duplicate)]);
  const reader = new ClickHouseDomainSourceReader(client, known);

  const first = await reader.readPage({
    descriptor,
    checkpoint,
    readThrough: "2026-08-17T12:05:00.000Z",
    limit: 50,
  });
  assert.equal(first.lookbackFrom, "2026-08-17T11:30:00.000Z");
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0]!.record.recordId, late.recordId);
  assert.equal(first.duplicateCount, 1);
  assert.deepEqual(first.nextCursor, checkpoint);
  assert.match(client.sql, /FROM sdar_commander\.domain_mcp_action_source_v1\n/u);
  assert.doesNotMatch(client.sql, /\bFINAL\b|length\((?:sequence|source_revision)\)/u);
  assert.doesNotMatch(client.sql, /phase6-late-record|2026-08-17/u);
  assert.deepEqual(client.options, { readonly: 2, maxResultRows: 50 });

  known.add(first.records[0]!.identityHash, first.records[0]!.contentHash);
  const replay = await reader.readPage({
    descriptor,
    checkpoint: first.nextCursor,
    readThrough: "2026-08-17T12:05:00.000Z",
    limit: 50,
  });
  assert.equal(replay.records.length, 0);
  assert.equal(replay.duplicateCount, 2);
  assert.deepEqual(replay.nextCursor, checkpoint);
  assert.equal(DOMAIN_PROJECTION_LOOKBACK_MS, 1_800_000);
});

test("same immutable source identity with a different hash blocks the page", async () => {
  const batch = await fixtureBatch("commander-five-records.batch.json");
  const source = batch.records[0]!;
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const identity = createDomainSourceRecordIdentityHash(source);
  const reader = new ClickHouseDomainSourceReader(
    new FakeQueryClient([sourceRow(source)]),
    new MemoryIdentityIndex([[identity, `sha256:${"f".repeat(64)}`]]),
  );
  await assert.rejects(
    reader.readPage({
      descriptor,
      checkpoint: null,
      readThrough: "2026-08-17T12:05:00.000Z",
      limit: 10,
    }),
    (error: unknown) => hasCode(error, "SOURCE_CONTENT_CONFLICT"),
  );
});

test("state cursor orders by snapshot version without event sequence and is kind isolated", async () => {
  const ordinary = cursor("2026-08-17T12:00:00.000Z", "2", "record", "1");
  const stateA = { ...ordinary, kind: "state" as const, stateSnapshotVersion: "9" };
  const stateB = { ...stateA, stateSnapshotVersion: "10", sequence: "1" };
  assert.ok(compareDomainSourceCursor(stateA, stateB) < 0);
  assert.equal(compareDomainSourceCursor(stateA, { ...stateA, sequence: "999" }), 0);
  assert.throws(
    () => compareDomainSourceCursor(ordinary, stateA),
    (error: unknown) => hasCode(error, "DOMAIN_SOURCE_CURSOR_KIND_MISMATCH"),
  );

  const batch = await fixtureBatch("commander-five-records.batch.json");
  const stateRecord = batch.records.find((record) =>
    record.sourceContractId.endsWith("/ugv-state-snapshot"),
  )!;
  const descriptor = new DomainProjectionRegistry().resolveSource(stateRecord.sourceContractId)!;
  const sql = buildDomainSourcePageQuery(
    descriptor,
    "2026-08-17T11:30:00.000Z",
    "2026-08-17T12:05:00.000Z",
    100,
  );
  assert.match(sql, /ORDER BY occurred_at, state_snapshot_version, record_id/u);
});

test("reader rejects wrong exact source contract, invalid payload hash and unbounded input", async () => {
  const batch = await fixtureBatch("commander-five-records.batch.json");
  const source = batch.records[0]!;
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const wrongContract = sourceRow(source);
  wrongContract.source_contract_id = "sdar.domain-source/npc/mission-tool-call";
  const invalidHash = sourceRow(source);
  invalidHash.payload_sha256 = "0".repeat(64);
  for (const row of [wrongContract, invalidHash]) {
    const reader = new ClickHouseDomainSourceReader(
      new FakeQueryClient([row]),
      new MemoryIdentityIndex([]),
    );
    await assert.rejects(
      reader.readPage({
        descriptor,
        checkpoint: null,
        readThrough: "2026-08-17T12:05:00.000Z",
        limit: 10,
      }),
      (error: unknown) => hasCode(error, "SOURCE_CONTRACT_INVALID"),
    );
  }
  assert.throws(
    () => buildDomainSourcePageQuery(descriptor, "2026-08-17T00:00:00.000Z", "2026-08-17T01:00:00.000Z", 1001),
    (error: unknown) => hasCode(error, "DOMAIN_SOURCE_PAGE_LIMIT_INVALID"),
  );
});

class FakeQueryClient {
  sql = "";
  options: unknown;

  constructor(readonly rows: readonly Record<string, unknown>[]) {}

  async query(sql: string, options?: unknown): Promise<string> {
    this.sql = sql;
    this.options = options;
    return JSON.stringify({ data: this.rows });
  }
}

class MemoryIdentityIndex implements DomainSourceIdentityIndex {
  private readonly values: Map<DomainSourceSha256, DomainSourceSha256>;

  constructor(entries: readonly (readonly [DomainSourceSha256, DomainSourceSha256])[]) {
    this.values = new Map(entries);
  }

  async contentHash(identityHash: DomainSourceSha256): Promise<DomainSourceSha256 | undefined> {
    return this.values.get(identityHash);
  }

  add(identityHash: DomainSourceSha256, contentHash: DomainSourceSha256): void {
    this.values.set(identityHash, contentHash);
  }
}

function sourceRow(record: DomainSourceBatchRequest["records"][number]): Record<string, unknown> {
  return {
    tenant_id: record.tenantId,
    project_id: record.projectId,
    environment: record.environment,
    record_id: record.recordId,
    episode_id: record.episodeId,
    task_id: record.taskId ?? "",
    context_id: record.contextId ?? "",
    agent_id: record.agentId,
    agent_version: record.agentVersion ?? "",
    scenario_id: record.scenarioId ?? "",
    correlation_id: record.correlationId ?? "",
    sequence: record.sequence,
    source_revision: record.sourceRevision,
    source_contract_id: record.sourceContractId,
    source_contract_version: record.sourceContractVersion,
    producer_id: record.producerId,
    producer_version: record.producerVersion,
    payload_json: JSON.stringify(record.payload),
    payload_sha256: record.payloadHash.slice("sha256:".length),
    occurred_at: record.occurredAt,
    state_snapshot_version:
      "stateSnapshotVersion" in record.payload ? record.payload.stateSnapshotVersion : "1",
  };
}

function cursor(
  occurredAt: string,
  sequence: string,
  recordId: string,
  sourceRevision: string,
): DomainSourceCursor {
  return Object.freeze({
    version: 1,
    kind: "ordinary",
    occurredAt,
    sequence,
    stateSnapshotVersion: null,
    recordId,
    sourceRevision,
  });
}

async function fixtureBatch(filename: string): Promise<DomainSourceBatchRequest> {
  return JSON.parse(
    await readFile(
      path.join(process.cwd(), "integrations/domain-source/contracts/v1/fixtures/valid", filename),
      "utf8",
    ),
  ) as DomainSourceBatchRequest;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
