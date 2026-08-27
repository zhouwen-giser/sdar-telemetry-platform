import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assembleProviderEpisodeClosure,
  type ProviderClosureCapture,
  type ProviderClosureFact,
  type ProviderClosureScope,
  type ProviderEpisodeClosureDataSource,
  type ProviderEvidencePage,
  type ProviderReconciliationHint,
  type ProviderRemoteTaskBinding,
} from "../../packages/telemetry-smpp-consumer/src/closure-v2.js";
import {
  canonicalBinding,
  type ClosureWarehouse,
} from "../../packages/telemetry-smpp-consumer/src/canonical-closure-source.js";
import {
  closurePublication,
  publishClosureDetails,
} from "../../packages/telemetry-smpp-consumer/src/closure-publisher.js";
import { hashCanonicalDomainProjectionJson } from "../../packages/telemetry-contracts/src/index.js";

const scopeA = {
  tenantId: "tenant-1",
  projectId: "project-1",
  environment: "test",
  episodeId: "episode-a",
} as const;

const bindingA: ProviderRemoteTaskBinding = {
  bindingId: "binding-a",
  ...scopeA,
  a2aTaskId: "a2a-a",
  remoteTaskId: "remote-a",
  providerOriginSourceId: "source-shared",
  externalProviderId: "provider-1",
  externalProviderInstanceId: "instance-1",
  revision: "1",
  status: "active",
  updatedAt: "2026-08-21T00:00:00.000Z",
  authoritativeOriginTaskIds: ["sdar-task-a"],
};

const bindingB: ProviderRemoteTaskBinding = {
  ...bindingA,
  bindingId: "binding-b",
  episodeId: "episode-b",
  a2aTaskId: "a2a-b",
  remoteTaskId: "remote-b",
  authoritativeOriginTaskIds: ["sdar-task-b"],
};

test("same Provider Source remains isolated by authoritative Episode binding", async () => {
  const facts = [fact(1, bindingA), fact(2, bindingB)];
  const source = new MemoryClosureSource([bindingA, bindingB], facts, []);
  const closureA = await assembleProviderEpisodeClosure(source, {
    ...scopeA,
    required: true,
    pageSize: 1,
  });
  const closureB = await assembleProviderEpisodeClosure(source, {
    ...scopeA,
    episodeId: "episode-b",
    required: true,
    pageSize: 1,
  });

  assert.deepEqual(closureA.closure.providerFacts.map((item) => item.factId), ["fact-00001"]);
  assert.deepEqual(closureB.closure.providerFacts.map((item) => item.factId), ["fact-00002"]);
  assert.equal(closureA.closure.foreignFactCount, 0);
  assert.equal(closureB.closure.foreignFactCount, 0);
  assert.equal(closureA.reconciliation.hintsUsedForAuthority, false);
});

test("Provider v2 migration is additive and every detail view is manifest-gated", async () => {
  const source = await readFile("migrations/clickhouse/015_provider_closure_v2.sql", "utf8");
  assert.equal((source.match(/CREATE TABLE IF NOT EXISTS/gu) ?? []).length, 5);
  assert.equal((source.match(/CREATE VIEW IF NOT EXISTS/gu) ?? []).length, 5);
  assert.equal((source.match(/provider_closure_manifest_v2 FINAL/gu) ?? []).length, 5);
  assert.doesNotMatch(source, /\b(?:ALTER|DELETE|DROP|INSERT|TRUNCATE|UPDATE)\b/iu);
});

for (const count of [1_500, 10_000]) {
  test(`${count} Provider facts are completely paged without truncation`, async () => {
    const facts = Array.from({ length: count }, (_, index) => fact(index + 1, bindingA));
    const closure = await assembleProviderEpisodeClosure(
      new MemoryClosureSource([bindingA], facts, []),
      { ...scopeA, required: true, pageSize: 333, maxPages: 100, maxItems: 20_000 },
    );
    assert.equal(closure.closure.expectedFactCount, count);
    assert.equal(closure.closure.selectedFactCount, count);
    assert.equal(closure.closure.truncated, false);
    assert.equal(closure.pagination.hasMore, false);
    const ids = new Set(closure.closure.providerFacts.map((item) => item.factId));
    assert.equal(ids.has("fact-00001"), true);
    assert.equal(ids.has(`fact-${String(count).padStart(5, "0")}`), true);
  });
}

test("origin claims reconcile only after binding selection and cannot expand the closure", async () => {
  const selected = {
    ...fact(1, bindingA),
    originSystem: "sdar",
    originTaskIds: ["sdar-task-a"],
    originInvocationIds: ["invocation-not-mapped"],
  };
  const foreign = {
    ...fact(2, bindingB),
    originSystem: "sdar",
    originTaskIds: ["sdar-task-a"],
  };
  const source = new MemoryClosureSource([bindingA], [selected, foreign], [], true);
  const closure = await assembleProviderEpisodeClosure(source, { ...scopeA, required: true });

  assert.deepEqual(closure.closure.providerFacts.map((item) => item.factId), [selected.factId]);
  assert.equal(closure.closure.foreignFactCount, 1);
  assert.equal(closure.readiness.status, "conflict");
  assert.ok(closure.readiness.reasonCodes.includes("SMPP_PROVIDER_FACT_FOREIGN"));
  assert.equal(
    closure.reconciliation.results.find((result) => result.claimType === "task")?.status,
    "matched",
  );
  assert.equal(
    closure.reconciliation.results.find((result) => result.claimType === "invocation")?.status,
    "unverifiable",
  );
});

test("an authoritative SMPP relation is rejected instead of receiving compatibility treatment", async () => {
  const selected = fact(1, bindingA);
  const hint: ProviderReconciliationHint = {
    relationId: "relation-1",
    relationType: "invokes",
    producerSystem: "smpp",
    projectionId: "smpp_relations_to_sdar_core",
    confidenceClass: "authoritative",
    bindingSource: "provider_correlation_metadata",
    evidenceFactIds: [selected.factId],
    sourceRecordHash: "a".repeat(64),
    projectedAt: "2026-08-21T00:00:02.000Z",
    authority: true,
    maySelectFacts: false,
    mayOverrideBinding: false,
  };
  const closure = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [selected], [hint]),
    { ...scopeA, required: true },
  );
  assert.equal(closure.readiness.status, "conflict");
  assert.ok(closure.readiness.reasonCodes.includes("SMPP_RECONCILIATION_HINT_INVALID"));
  assert.equal(closure.reconciliation.relationHints[0]?.authority, false);
  assert.equal(closure.reconciliation.hintsUsedForAuthority, false);
});

test("a moving source exhausts bounded attempts and never persists a mixed closure", async () => {
  const source = new MemoryClosureSource([bindingA], [fact(1, bindingA)], [], false, true);
  const closure = await assembleProviderEpisodeClosure(source, {
    ...scopeA,
    required: true,
    maxAttempts: 2,
  });
  assert.equal(closure.readiness.status, "blocked_drift");
  assert.deepEqual(closure.readiness.reasonCodes, ["SMPP_SOURCE_MOVED_DURING_SNAPSHOT"]);
  assert.equal(source.captureCount, 4);
});

test("canonical Binding authority is read from the frozen remote Task evidence", () => {
  const providerAuthority = {
    schemaVersion: "runtime.remote-task-provider-authority/v1",
    authoritySource: "remote_task_binding.authority_snapshot_json",
    providerSourceId: bindingA.providerOriginSourceId,
    providerId: bindingA.externalProviderId,
  };
  const payload = {
    bindingId: bindingA.bindingId,
    version: 1,
    remoteTaskId: bindingA.remoteTaskId,
    localState: bindingA.status,
    providerAuthority,
    providerAuthorityHash: hashCanonicalDomainProjectionJson(providerAuthority),
  };
  const record = {
    recordType: "mcp_task.remote_binding",
    episodeId: scopeA.episodeId,
    tenantId: scopeA.tenantId,
    projectId: scopeA.projectId,
    environment: scopeA.environment,
    taskId: bindingA.a2aTaskId,
    recordedAt: bindingA.updatedAt,
    payload,
    payloadHash: hashCanonicalDomainProjectionJson(payload),
  };
  assert.deepEqual(canonicalBinding({ record_json: JSON.stringify(record) }, scopeA), {
    ...scopeA,
    bindingId: bindingA.bindingId,
    a2aTaskId: bindingA.a2aTaskId,
    remoteTaskId: bindingA.remoteTaskId,
    providerOriginSourceId: bindingA.providerOriginSourceId,
    externalProviderId: bindingA.externalProviderId,
    revision: "1",
    status: bindingA.status,
    updatedAt: bindingA.updatedAt,
  });
  assert.throws(
    () => canonicalBinding({ record_json: JSON.stringify({ ...record, payloadHash: sha("current-binding") }) }, scopeA),
    /PROVIDER_CANONICAL_BINDING_INVALID/,
  );
});

test("publishes all detail pages before the immutable manifest marker", async () => {
  const closure = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [fact(1, bindingA)], []),
    { ...scopeA, required: true },
  );
  const calls: string[] = [];
  const warehouse: ClosureWarehouse = {
    query: async () => "",
    insert: async (table, rows, options) => {
      assert.ok(rows.length > 0);
      assert.match(options?.deduplicationToken ?? "", /^[0-9a-f]{64}$/u);
      calls.push(table);
    },
  };
  const publication = closurePublication(closure);
  for (const rows of Object.values(publication.rows)) {
    assert.equal(new Set(rows.map((row) => row["closure_snapshot_id"])).size, 1);
    assert.equal(rows[0]?.["closure_snapshot_id"], publication.snapshotId);
  }
  const commit = await publishClosureDetails(warehouse, closure);
  assert.deepEqual(calls, [
    "sdar_mart.provider_closure_binding_v2",
    "sdar_mart.provider_closure_fact_v2",
    "sdar_mart.provider_closure_relation_v2",
    "sdar_mart.provider_closure_reconciliation_v2",
  ]);
  await commit();
  assert.equal(calls.at(-1), "sdar_mart.provider_closure_manifest_v2");
});

class MemoryClosureSource implements ProviderEpisodeClosureDataSource {
  captureCount = 0;

  constructor(
    private readonly bindings: readonly ProviderRemoteTaskBinding[],
    private readonly facts: readonly ProviderClosureFact[],
    private readonly hints: readonly ProviderReconciliationHint[],
    private readonly leakForeignFacts = false,
    private readonly moving = false,
  ) {}

  capture(scope: ProviderClosureScope, asOfProjectedAt?: string): Promise<ProviderClosureCapture> {
    this.captureCount += 1;
    const bindings = this.bindings.filter((binding) => binding.episodeId === scope.episodeId);
    const remoteTasks = new Set(bindings.map((binding) => binding.remoteTaskId));
    const facts = this.facts.filter((item) => remoteTasks.has(item.externalTaskId));
    return Promise.resolve({
      asOfProjectedAt: asOfProjectedAt ?? "2026-08-21T00:01:00.000Z",
      effectiveWatermark: "2026-08-21T00:00:02.000Z",
      bindingCount: bindings.length,
      expectedFactCount: facts.length,
      identityHash: sha(this.moving ? `capture-${this.captureCount}` : { bindings, facts }),
    });
  }

  listBindings(input: {
    readonly scope: ProviderClosureScope;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<ProviderEvidencePage<ProviderRemoteTaskBinding>> {
    return Promise.resolve(
      page(
        this.bindings.filter((binding) => binding.episodeId === input.scope.episodeId),
        input.cursor,
        input.limit,
      ),
    );
  }

  listFacts(input: {
    readonly bindings: readonly ProviderRemoteTaskBinding[];
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<ProviderEvidencePage<ProviderClosureFact>> {
    const remoteTasks = new Set(input.bindings.map((binding) => binding.remoteTaskId));
    const facts = this.leakForeignFacts
      ? this.facts
      : this.facts.filter((item) => remoteTasks.has(item.externalTaskId));
    return Promise.resolve(page(facts, input.cursor, input.limit));
  }

  listRelationHints(input: {
    readonly selectedFactIds: readonly string[];
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<ProviderEvidencePage<ProviderReconciliationHint>> {
    const selected = new Set(input.selectedFactIds);
    return Promise.resolve(
      page(
        this.hints.filter((hint) => hint.evidenceFactIds.some((factId) => selected.has(factId))),
        input.cursor,
        input.limit,
      ),
    );
  }
}

function fact(index: number, binding: ProviderRemoteTaskBinding): ProviderClosureFact {
  const id = `fact-${String(index).padStart(5, "0")}`;
  return {
    factId: id,
    factHash: sha(id),
    factType: "provider.task.lifecycle",
    tenantId: binding.tenantId,
    projectId: binding.projectId,
    environment: binding.environment,
    smppSourceId: binding.providerOriginSourceId,
    providerId: binding.externalProviderId,
    providerInstanceId: binding.externalProviderInstanceId,
    externalTaskId: binding.remoteTaskId,
    occurredAt: `2026-08-21T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
    projectedAt: "2026-08-21T00:00:02.000Z",
    sourceRecordId: `record-${id}`,
    sourceRecordHash: sha(`record-${id}`),
  };
}

function page<T>(values: readonly T[], cursor: string | null, limit: number): ProviderEvidencePage<T> {
  const offset = cursor === null ? 0 : Number(cursor);
  const items = values.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < values.length;
  return {
    items,
    nextCursor: hasMore ? String(nextOffset) : null,
    hasMore,
    pageHash: sha({ offset, items }),
  };
}

function sha(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
