import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type {
  DomainSourceBatchRequest,
  DomainSourceRecord,
} from "../../packages/telemetry-contracts/src/index.js";
import { CommanderDomainMapper } from "../../packages/telemetry-projection-registry/src/commander-mappings.js";
import { DomainProjectionRegistry } from "../../packages/telemetry-projection-registry/src/domain.js";
import { NpcDomainMapper } from "../../packages/telemetry-projection-registry/src/npc-mappings.js";
import {
  ClickHouseDomainTargetWriter,
  DomainProjectionTerminalCloser,
  buildExactTargetRow,
  type DomainCheckpointCommitter,
  type DomainMappingDecision,
  type DomainTargetClickHouseClient,
  type DomainTerminalCloseInput,
  type DomainTerminalClosure,
} from "../../apps/domain-projection-worker/src/target-writer.js";

const PROJECTION_RUN_ID = "2efc4d90-1b16-5bd9-8278-8401038335bf";
const PROJECTED_AT = "2026-08-17T09:00:00.000Z";

test("produced target closes in exact target -> lineage -> checkpoint order", async () => {
  const source = await sourceFixture("commander", 0);
  const input = producedInput(source);
  const clickHouse = new MemoryTargetClickHouse();
  const checkpoint = new MemoryCheckpoint();
  const closer = new DomainProjectionTerminalCloser(
    new ClickHouseDomainTargetWriter(clickHouse),
    checkpoint,
  );

  const result = await closer.close(input);
  assert.deepEqual(result, {
    outcome: "produced",
    checkpointEligible: true,
    targetWritten: true,
    lineageWritten: true,
    deadLetterWritten: false,
    reasonCode: "TARGET_PRODUCED",
  });
  assert.deepEqual(clickHouse.writeOrder, [
    "sdar_embodied.control_action",
    "sdar_meta.projection_lineage",
  ]);
  assert.deepEqual(checkpoint.outcomes, ["produced"]);
  const target = clickHouse.targetRows[0]!;
  assert.equal(target.payload_sha256, input.decision.kind === "produce"
    ? input.decision.envelope.payloadSha256.slice("sha256:".length)
    : "unreachable");
  assert.equal(target.source_payload_hash, source.payloadHash.slice("sha256:".length));
  assert.equal("sequence" in target, false, "ALIAS columns must never be inserted");
  assert.equal(target.projection_version, "1");
});

test("same target and lineage hashes replay as one logical duplicate", async () => {
  const source = await sourceFixture("commander", 0);
  const input = producedInput(source);
  const clickHouse = new MemoryTargetClickHouse();
  const writer = new ClickHouseDomainTargetWriter(clickHouse);
  const first = await writer.close(input);
  const second = await writer.close({ ...input, projectedAt: "2026-08-17T09:01:00.000Z" });

  assert.equal(first.outcome, "produced");
  assert.deepEqual(second, {
    outcome: "duplicate",
    checkpointEligible: true,
    targetWritten: false,
    lineageWritten: false,
    deadLetterWritten: false,
    reasonCode: "TARGET_DUPLICATE_SAME_HASH",
  });
  assert.equal(clickHouse.targetRows.length, 1);
  assert.equal(clickHouse.lineageRows.length, 1);
});

test("different target hash writes blocking DLQ and never advances checkpoint", async () => {
  const source = await sourceFixture("commander", 0);
  const input = producedInput(source);
  const clickHouse = new MemoryTargetClickHouse();
  clickHouse.targetRows.push({ payload_sha256: "f".repeat(64) });
  const checkpoint = new MemoryCheckpoint();
  const result = await new DomainProjectionTerminalCloser(
    new ClickHouseDomainTargetWriter(clickHouse),
    checkpoint,
  ).close(input);

  assert.equal(result.outcome, "blocked");
  assert.equal(result.reasonCode, "TARGET_CONTENT_CONFLICT");
  assert.equal(result.checkpointEligible, false);
  assert.deepEqual(checkpoint.outcomes, []);
  assert.equal(clickHouse.deadLetterRows.length, 1);
  assert.equal(clickHouse.deadLetterRows[0]!.error_code, "TARGET_CONTENT_CONFLICT");
  assert.equal(clickHouse.deadLetterRows[0]!.blocking, 1);
  assert.equal(clickHouse.targetRows.length, 1);
});

test("deterministic mapping failure is a durable terminal DLQ before checkpoint", async () => {
  const source = await sourceFixture("commander", 0);
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const invalid = { ...source, payload: { ...source.payload } };
  delete (invalid.payload as Record<string, unknown>).actionName;
  const decision = new CommanderDomainMapper().map(invalid);
  assert.equal(decision.kind, "fail");
  const clickHouse = new MemoryTargetClickHouse();
  const checkpoint = new MemoryCheckpoint();
  const result = await new DomainProjectionTerminalCloser(
    new ClickHouseDomainTargetWriter(clickHouse),
    checkpoint,
  ).close(baseInput(invalid, descriptor, decision));

  assert.equal(result.outcome, "failed");
  assert.equal(result.checkpointEligible, true);
  assert.deepEqual(clickHouse.writeOrder, ["sdar_meta.projection_dead_letter"]);
  assert.deepEqual(checkpoint.outcomes, ["failed"]);
  assert.equal(clickHouse.deadLetterRows[0]!.payload_json, JSON.stringify({
    field: "actionName",
    reasonCode: "MAPPING_REQUIRED_FIELD_MISSING",
  }));
  assert.doesNotMatch(clickHouse.deadLetterRows[0]!.payload_json as string, /deviceId|resourceChannel/u);
});

test("skip writes reasoned lineage and no target", async () => {
  const source = await sourceFixture("npc", 0);
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const decision = new CommanderDomainMapper().map(source);
  assert.equal(decision.kind, "skip");
  const clickHouse = new MemoryTargetClickHouse();
  const checkpoint = new MemoryCheckpoint();
  const result = await new DomainProjectionTerminalCloser(
    new ClickHouseDomainTargetWriter(clickHouse),
    checkpoint,
  ).close(baseInput(source, descriptor, decision));

  assert.equal(result.outcome, "skipped");
  assert.deepEqual(clickHouse.writeOrder, ["sdar_meta.projection_lineage"]);
  assert.equal(clickHouse.lineageRows[0]!.decision, "skipped");
  assert.equal(clickHouse.lineageRows[0]!.reason_code, "SOURCE_NOT_APPLICABLE");
  assert.equal(clickHouse.lineageRows[0]!.target_record_id, "");
  assert.deepEqual(checkpoint.outcomes, ["skipped"]);
});

test("crash after target but before lineage replays safely and checkpoint stays last", async () => {
  const source = await sourceFixture("commander", 0);
  const input = producedInput(source);
  const clickHouse = new MemoryTargetClickHouse();
  clickHouse.failLineageOnce = true;
  const checkpoint = new MemoryCheckpoint();
  const closer = new DomainProjectionTerminalCloser(
    new ClickHouseDomainTargetWriter(clickHouse),
    checkpoint,
  );

  await assert.rejects(closer.close(input), (error: unknown) => hasCode(error, "LINEAGE_WRITE_TRANSIENT"));
  assert.equal(clickHouse.targetRows.length, 1);
  assert.equal(clickHouse.lineageRows.length, 0);
  assert.deepEqual(checkpoint.outcomes, []);

  const replay = await closer.close(input);
  assert.equal(replay.outcome, "duplicate");
  assert.equal(replay.lineageWritten, true);
  assert.equal(clickHouse.targetRows.length, 1);
  assert.equal(clickHouse.lineageRows.length, 1);
  assert.deepEqual(checkpoint.outcomes, ["duplicate"]);
});

test("exact writer rejects target field drift before any query or write", async () => {
  const source = await sourceFixture("commander", 0);
  const input = producedInput(source);
  const decision = input.decision;
  assert.equal(decision.kind, "produce");
  if (decision.kind !== "produce") return;
  assert.throws(
    () => buildExactTargetRow(decision.envelope, {
      ...decision.targetFields,
      near_name_legacy_field: "forbidden",
    }),
    (error: unknown) => hasCode(error, "TARGET_SCHEMA_INVALID"),
  );
});

test("all ten frozen mappings close with exact target rows and 100% produced lineage", async () => {
  const commander = await fixtureBatch("commander");
  const npc = await fixtureBatch("npc");
  const descriptors = await rc2Descriptors();
  const mappings = [
    ...commander.records.map((source) => ({ source, decision: new CommanderDomainMapper().map(source) })),
    ...npc.records.map((source) => ({ source, decision: new NpcDomainMapper().map(source) })),
  ];
  assert.equal(mappings.length, 10);
  for (const { source, decision } of mappings) {
    assert.equal(decision.kind, "produce");
    if (decision.kind !== "produce") continue;
    const row = buildExactTargetRow(decision.envelope, decision.targetFields);
    const descriptor = descriptors.get(decision.targetTable)!;
    assert.ok(descriptor, `missing locked descriptor ${decision.targetTable}`);
    const allowedColumns = new Set(descriptor.columns.map((column) => column.name));
    const requiredColumns = descriptor.columns.filter(
      (column) => column.default_kind === "" && !column.type.startsWith("Nullable("),
    );
    assert.deepEqual(
      Object.keys(row).filter((key) => !allowedColumns.has(key)),
      [],
      `${decision.mappingId} wrote a column outside its RC2 descriptor`,
    );
    assert.deepEqual(
      requiredColumns.map((column) => column.name).filter((key) => !(key in row)),
      [],
      `${decision.mappingId} omitted an RC2 required column`,
    );
    assert.equal(row.projection_id, decision.envelope.projectionId);
    assert.equal(row.source_record_id, decision.envelope.sourceRecordId);
    assert.equal(Object.keys(row).some((key) => key.includes("legacy")), false);
    const projection = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
    const clickHouse = new MemoryTargetClickHouse();
    const closure = await new ClickHouseDomainTargetWriter(clickHouse).close(
      baseInput(source, projection, decision),
    );
    assert.equal(closure.outcome, "produced");
    assert.equal(clickHouse.targetRows.length, 1);
    assert.equal(clickHouse.lineageRows.length, 1);
    assert.equal(clickHouse.lineageRows[0]!.source_record_id, source.recordId);
    assert.equal(clickHouse.lineageRows[0]!.target_record_id, decision.envelope.canonicalRecordId);
  }
});

class MemoryTargetClickHouse implements DomainTargetClickHouseClient {
  readonly targetRows: Record<string, unknown>[] = [];
  readonly lineageRows: Record<string, unknown>[] = [];
  readonly deadLetterRows: Record<string, unknown>[] = [];
  readonly writeOrder: string[] = [];
  failLineageOnce = false;

  async query(sql: string): Promise<string> {
    if (sql.includes("FROM sdar_meta.projection_lineage")) {
      return JSON.stringify({
        data: this.lineageRows.map((row) => ({
          source_payload_hash: row.source_payload_hash,
          target_payload_hash: row.target_payload_hash,
          decision: row.decision,
          reason_code: row.reason_code,
        })),
      });
    }
    return JSON.stringify({
      data: this.targetRows.map((row) => ({ payload_sha256: row.payload_sha256 })),
    });
  }

  async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (table === "sdar_meta.projection_lineage" && this.failLineageOnce) {
      this.failLineageOnce = false;
      throw new Error("injected");
    }
    this.writeOrder.push(table);
    if (table === "sdar_meta.projection_lineage") this.lineageRows.push(...structuredClone(rows));
    else if (table === "sdar_meta.projection_dead_letter") this.deadLetterRows.push(...structuredClone(rows));
    else this.targetRows.push(...structuredClone(rows));
  }
}

class MemoryCheckpoint implements DomainCheckpointCommitter {
  readonly outcomes: DomainTerminalClosure["outcome"][] = [];

  async commit(input: Readonly<{ closure: DomainTerminalClosure }>): Promise<void> {
    this.outcomes.push(input.closure.outcome);
  }
}

function producedInput(source: DomainSourceRecord): DomainTerminalCloseInput {
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const decision = new CommanderDomainMapper().map(source);
  assert.equal(decision.kind, "produce");
  return baseInput(source, descriptor, decision);
}

function baseInput(
  source: DomainSourceRecord,
  descriptor: ReturnType<DomainProjectionRegistry["resolveSource"]> & {},
  decision: DomainMappingDecision,
): DomainTerminalCloseInput {
  return Object.freeze({
    descriptor,
    source,
    decision,
    projectionRunId: PROJECTION_RUN_ID,
    mappingHash: descriptor.definitionHash,
    sourceCursor: JSON.stringify({ recordId: source.recordId, sourceRevision: source.sourceRevision }),
    projectedAt: PROJECTED_AT,
  });
}

async function sourceFixture(application: "commander" | "npc", index: number): Promise<DomainSourceRecord> {
  return (await fixtureBatch(application)).records[index]!;
}

async function fixtureBatch(application: "commander" | "npc"): Promise<DomainSourceBatchRequest> {
  const filename = application === "commander"
    ? "commander-five-records.batch.json"
    : "npc-five-records.batch.json";
  return JSON.parse(
    await readFile(
      path.join(process.cwd(), "integrations/domain-source/contracts/v1/fixtures/valid", filename),
      "utf8",
    ),
  ) as DomainSourceBatchRequest;
}

async function rc2Descriptors(): Promise<Map<string, LockedDescriptor>> {
  const value = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "integrations/sdar-clickhouse/1.5.1-rc.2/required-object-descriptors.json",
      ),
      "utf8",
    ),
  ) as { objects: LockedDescriptor[] };
  return new Map(value.objects.map((descriptor) => [descriptor.name, descriptor]));
}

type LockedDescriptor = Readonly<{
  name: string;
  columns: readonly Readonly<{
    name: string;
    type: string;
    default_kind: string;
  }>[];
}>;

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
