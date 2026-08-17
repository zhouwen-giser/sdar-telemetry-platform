import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type {
  DomainSourceBatchRequest,
  DomainSourceRecord,
  DomainSourceSha256,
} from "../../packages/telemetry-contracts/src/index.js";
import { CommanderDomainMapper } from "../../packages/telemetry-projection-registry/src/commander-mappings.js";
import { DomainProjectionRegistry } from "../../packages/telemetry-projection-registry/src/domain.js";
import {
  domainReconciliationSourceKey,
  reconcileDomainProjection,
  type DomainReconciliationInput,
} from "../../packages/telemetry-reconciliation/src/domain.js";
import {
  DomainBoundedReplayService,
  type DomainBoundedReplayRequest,
  type DomainReplayClosurePort,
  type DomainReplaySourcePort,
} from "../../apps/domain-projection-worker/src/replay.js";
import { ClickHouseDomainSchemaPreflight } from "../../apps/domain-projection-worker/src/schema-preflight.js";
import type {
  DomainSourceCursor,
  DomainSourceReadRecord,
} from "../../apps/domain-projection-worker/src/source-reader.js";
import type {
  DomainTerminalCloseInput,
  DomainTerminalClosure,
} from "../../apps/domain-projection-worker/src/target-writer.js";
import {
  DomainDeadLetterControlService,
  type DomainDeadLetterRetryPort,
  type DomainDeadLetterState,
  type DomainDeadLetterStatePort,
} from "../../apps/domain-projection-worker/src/dead-letter-control.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("reconciliation reports healthy only with terminal source/target/lineage closure", () => {
  const input = healthyReconciliation();
  const result = reconcileDomainProjection(input);
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.issues, []);

  const empty = reconcileDomainProjection({
    ...input,
    sources: [],
    targets: [],
    lineage: [],
    checkpointedSourceKeys: [],
  });
  assert.equal(empty.status, "empty");
  assert.notEqual(empty.status, "healthy");
});

test("reconciliation deterministically detects every required asymmetry", () => {
  const key = domainReconciliationSourceKey("source-1", "1");
  const result = reconcileDomainProjection({
    ...healthyReconciliation(),
    sources: [
      { recordId: "source-1", sourceRevision: "1", contentHash: HASH_A },
      { recordId: "source-2", sourceRevision: "1", contentHash: HASH_A },
    ],
    targets: [
      { recordId: "target-1", contentHash: HASH_B },
      { recordId: "target-1", contentHash: HASH_B },
      { recordId: "target-orphan", contentHash: HASH_A },
    ],
    lineage: [
      {
        sourceRecordId: "source-1",
        sourceRevision: "1",
        targetRecordId: "target-1",
        targetContentHash: HASH_A,
        decision: "produced",
      },
      {
        sourceRecordId: "source-lineage-orphan",
        sourceRevision: "1",
        targetRecordId: "missing-target",
        targetContentHash: HASH_A,
        decision: "produced",
      },
    ],
    deadLetters: [
      {
        sourceRecordId: "source-2",
        sourceRevision: "1",
        blocking: true,
        status: "open",
      },
    ],
    checkpointedSourceKeys: [key, domainReconciliationSourceKey("ahead", "1")],
    schemaDefinitionDrift: true,
  });
  assert.equal(result.status, "gap");
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      "CHECKPOINT_AHEAD_OF_TERMINAL",
      "DUPLICATE_TARGET_IDENTITY",
      "PRODUCED_LINEAGE_WITHOUT_TARGET",
      "SCHEMA_DEFINITION_DRIFT",
      "TARGET_CONTENT_HASH_MISMATCH",
      "TARGET_WITHOUT_LINEAGE",
      "UNRESOLVED_BLOCKING_DLQ",
    ]),
  );
});

test("schema preflight pins mapping hash and exact source/target/governance descriptors", async () => {
  const source = await commanderSource(0);
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const locked = await lockedObjects();
  const client = new DescriptorQueryClient(locked, descriptor.sourceQualifiedTable, descriptor.targetQualifiedTable);
  const preflight = await ClickHouseDomainSchemaPreflight.load(client);
  const mappingHash = preflight.expectedMappingHash(descriptor.mappingId);
  const result = await preflight.verify({ descriptor, mappingHash });
  assert.equal(result.checkedObjects.length, 5);
  assert.match(result.descriptorFingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(client.options.every((value) => value?.readonly === 2), true);
  assert.equal(client.sql.some((sql) => sql.includes("legacy")), false);

  await assert.rejects(
    preflight.verify({ descriptor, mappingHash: HASH_A }),
    (error: unknown) => hasCode(error, "MAPPING_HASH_DRIFT"),
  );
  assert.equal(client.sql.length, 2, "mapping drift must fail before querying ClickHouse");
});

test("any locked column drift fails closed", async () => {
  const source = await commanderSource(0);
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const locked = await lockedObjects();
  const client = new DescriptorQueryClient(
    locked,
    descriptor.sourceQualifiedTable,
    descriptor.targetQualifiedTable,
    true,
  );
  const preflight = await ClickHouseDomainSchemaPreflight.load(client);
  await assert.rejects(
    preflight.verify({ descriptor, mappingHash: preflight.expectedMappingHash(descriptor.mappingId) }),
    (error: unknown) => hasCode(error, "SCHEMA_CONTRACT_DRIFT"),
  );
});

test("bounded replay preserves frozen scope and stops at blocking closure", async () => {
  const source = await commanderSource(0);
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const item = readRecord(source);
  const sourcePort = new MemoryReplaySource([item, item]);
  const closure = new MemoryReplayClosure(["produced", "blocked"]);
  const service = new DomainBoundedReplayService(
    sourcePort,
    new CommanderDomainMapper(),
    closure,
  );
  const request = replayRequest(descriptor, item.cursor);
  const result = await service.execute(request);
  assert.deepEqual(result, {
    replayRequestId: request.replayRequestId,
    processed: 2,
    produced: 1,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    blocked: true,
  });
  assert.equal(closure.inputs.length, 2);
  assert.equal(closure.inputs.every((input) => input.descriptor === descriptor), true);

  await assert.rejects(
    service.execute({ ...request, limit: 1 }),
    (error: unknown) => hasCode(error, "DOMAIN_REPLAY_BOUND_EXCEEDED"),
  );
  await assert.rejects(
    service.execute({ ...request, toCursor: { ...request.toCursor, occurredAt: "2026-08-16T00:00:00.000Z" } }),
    (error: unknown) => hasCode(error, "DOMAIN_REPLAY_SCOPE_INVALID"),
  );
});

test("DLQ controls are scope-pinned, idempotent and resolve only after terminal retry", async () => {
  const initial: DomainDeadLetterState = Object.freeze({
    deadLetterId: "dead-letter-1",
    projectionId: "application_to_embodied.dp-c01",
    projectionVersion: 1,
    mappingHash: HASH_A,
    status: "open",
    managementActionId: "",
    retryCount: 0,
  });
  const state = new MemoryDeadLetterState(initial);
  const replay = new MemoryDeadLetterRetry({ terminal: true, blocked: false });
  const service = new DomainDeadLetterControlService(state, replay);
  const action = {
    deadLetterId: initial.deadLetterId,
    managementActionId: "management-action-1",
    expectedProjectionId: initial.projectionId,
    expectedProjectionVersion: initial.projectionVersion,
    expectedMappingHash: initial.mappingHash,
    expectedStatus: "open" as const,
    action: "retry" as const,
  };
  const resolved = await service.execute(action);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.retryCount, 1);
  assert.equal(replay.calls, 1);
  assert.equal((await service.execute(action)).status, "resolved");
  assert.equal(replay.calls, 1, "same management action must be idempotent");

  const wrongScope = new DomainDeadLetterControlService(
    new MemoryDeadLetterState(initial),
    replay,
  );
  await assert.rejects(
    wrongScope.execute({ ...action, expectedMappingHash: HASH_B }),
    (error: unknown) => hasCode(error, "DOMAIN_DEAD_LETTER_SCOPE_CONFLICT"),
  );
});

test("blocked DLQ retry remains retrying and explicit ignore is audited", async () => {
  const initial: DomainDeadLetterState = Object.freeze({
    deadLetterId: "dead-letter-2",
    projectionId: "application_to_embodied.dp-n03",
    projectionVersion: 1,
    mappingHash: HASH_A,
    status: "open",
    managementActionId: "",
    retryCount: 0,
  });
  const state = new MemoryDeadLetterState(initial);
  const service = new DomainDeadLetterControlService(
    state,
    new MemoryDeadLetterRetry({ terminal: false, blocked: true }),
  );
  const retrying = await service.execute({
    deadLetterId: initial.deadLetterId,
    managementActionId: "management-action-2",
    expectedProjectionId: initial.projectionId,
    expectedProjectionVersion: 1,
    expectedMappingHash: HASH_A,
    expectedStatus: "open",
    action: "retry",
  });
  assert.equal(retrying.status, "retrying");
  const ignored = await service.execute({
    deadLetterId: initial.deadLetterId,
    managementActionId: "management-action-3",
    expectedProjectionId: initial.projectionId,
    expectedProjectionVersion: 1,
    expectedMappingHash: HASH_A,
    expectedStatus: "retrying",
    action: "ignore",
  });
  assert.equal(ignored.status, "ignored");
  assert.equal(ignored.managementActionId, "management-action-3");
});

class DescriptorQueryClient {
  readonly sql: string[] = [];
  readonly options: Array<{ readonly?: 2 } | undefined> = [];

  constructor(
    private readonly locked: ReadonlyMap<string, LockedObject>,
    private readonly source: string,
    private readonly target: string,
    private readonly mutateColumn = false,
  ) {}

  async query(sql: string, options?: { readonly?: 2 }): Promise<string> {
    this.sql.push(sql);
    this.options.push(options);
    const names = [
      this.source,
      this.target,
      "sdar_meta.projection_checkpoint",
      "sdar_meta.projection_dead_letter",
      "sdar_meta.projection_lineage",
    ];
    if (sql.includes("FROM system.tables")) {
      return JSON.stringify({ data: names.map((name) => structuredClone(this.locked.get(name)!.table)) });
    }
    const columns = names.flatMap((name) => structuredClone(this.locked.get(name)!.columns));
    if (this.mutateColumn) columns[0]!.type = "String__DRIFT";
    return JSON.stringify({ data: columns });
  }
}

class MemoryReplaySource implements DomainReplaySourcePort {
  constructor(private readonly records: readonly DomainSourceReadRecord[]) {}

  async readBounded(): Promise<readonly DomainSourceReadRecord[]> {
    return this.records;
  }
}

class MemoryReplayClosure implements DomainReplayClosurePort {
  readonly inputs: DomainTerminalCloseInput[] = [];

  constructor(private readonly outcomes: readonly DomainTerminalClosure["outcome"][]) {}

  async close(input: DomainTerminalCloseInput): Promise<DomainTerminalClosure> {
    this.inputs.push(input);
    const outcome = this.outcomes[this.inputs.length - 1] ?? "duplicate";
    return Object.freeze({
      outcome,
      checkpointEligible: outcome !== "blocked",
      targetWritten: outcome === "produced",
      lineageWritten: outcome === "produced" || outcome === "skipped",
      deadLetterWritten: outcome === "failed" || outcome === "blocked",
      reasonCode: outcome.toUpperCase(),
    });
  }
}

class MemoryDeadLetterState implements DomainDeadLetterStatePort {
  constructor(private current: DomainDeadLetterState) {}

  async load(deadLetterId: string): Promise<DomainDeadLetterState | null> {
    return deadLetterId === this.current.deadLetterId ? this.current : null;
  }

  async markRetrying(
    state: DomainDeadLetterState,
    managementActionId: string,
  ): Promise<DomainDeadLetterState> {
    this.current = Object.freeze({
      ...state,
      status: "retrying",
      managementActionId,
      retryCount: state.retryCount + 1,
    });
    return this.current;
  }

  async markTerminal(
    state: DomainDeadLetterState,
    managementActionId: string,
    action: "resolve" | "ignore",
  ): Promise<DomainDeadLetterState> {
    this.current = Object.freeze({
      ...state,
      status: action === "resolve" ? "resolved" : "ignored",
      managementActionId,
    });
    return this.current;
  }
}

class MemoryDeadLetterRetry implements DomainDeadLetterRetryPort {
  calls = 0;

  constructor(private readonly result: Readonly<{ terminal: boolean; blocked: boolean }>) {}

  async retry(): Promise<Readonly<{ terminal: boolean; blocked: boolean }>> {
    this.calls += 1;
    return this.result;
  }
}

function healthyReconciliation(): DomainReconciliationInput {
  return {
    projectionId: "application_to_embodied.dp-c01",
    projectionVersion: 1,
    sources: [{ recordId: "source-1", sourceRevision: "1", contentHash: HASH_A }],
    targets: [{ recordId: "target-1", contentHash: HASH_B }],
    lineage: [{
      sourceRecordId: "source-1",
      sourceRevision: "1",
      targetRecordId: "target-1",
      targetContentHash: HASH_B,
      decision: "produced",
    }],
    deadLetters: [],
    checkpointedSourceKeys: [domainReconciliationSourceKey("source-1", "1")],
    schemaDefinitionDrift: false,
  };
}

function replayRequest(
  descriptor: ReturnType<DomainProjectionRegistry["resolveSource"]> & {},
  itemCursor: DomainSourceCursor,
): DomainBoundedReplayRequest {
  return {
    replayRequestId: "phase10-replay-1",
    descriptor,
    mappingHash: descriptor.definitionHash,
    tenantId: "tenant-domain-golden",
    projectId: "project-domain-golden",
    episodeId: "episode-domain-golden",
    fromCursor: { ...itemCursor, occurredAt: "2026-08-17T08:00:00.000Z" },
    toCursor: { ...itemCursor, occurredAt: "2026-08-17T08:01:00.000Z" },
    limit: 10,
    projectionRunId: "2efc4d90-1b16-5bd9-8278-8401038335bf",
    projectedAt: "2026-08-17T09:00:00.000Z",
  };
}

function readRecord(record: DomainSourceRecord): DomainSourceReadRecord {
  const cursor: DomainSourceCursor = Object.freeze({
    version: 1,
    kind: "ordinary",
    occurredAt: record.occurredAt,
    sequence: record.sequence,
    stateSnapshotVersion: null,
    recordId: record.recordId,
    sourceRevision: record.sourceRevision,
  });
  return Object.freeze({
    identityHash: HASH_A,
    contentHash: record.payloadHash,
    cursor,
    record,
    raw: Object.freeze({}),
  });
}

async function commanderSource(index: number): Promise<DomainSourceRecord> {
  const batch = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "integrations/domain-source/contracts/v1/fixtures/valid/commander-five-records.batch.json",
      ),
      "utf8",
    ),
  ) as DomainSourceBatchRequest;
  return batch.records[index]!;
}

async function lockedObjects(): Promise<Map<string, LockedObject>> {
  const value = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "integrations/sdar-clickhouse/1.5.1-rc.2/required-object-descriptors.json",
      ),
      "utf8",
    ),
  ) as { objects: LockedObject[] };
  return new Map(value.objects.map((object) => [object.name, object]));
}

type LockedObject = {
  name: string;
  table: Record<string, unknown>;
  columns: Record<string, unknown>[];
};

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
