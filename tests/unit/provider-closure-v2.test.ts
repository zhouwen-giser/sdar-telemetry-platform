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
  type ProviderRuntimeEvidence,
} from "../../packages/telemetry-smpp-consumer/src/closure-v2.js";
import {
  CanonicalProviderClosureSource,
  canonicalBinding,
  type ClosureWarehouse,
} from "../../packages/telemetry-smpp-consumer/src/canonical-closure-source.js";
import {
  closurePublication,
  publishClosureDetails,
} from "../../packages/telemetry-smpp-consumer/src/closure-publisher.js";
import {
  hashCanonicalDomainProjectionJson,
  hashCanonicalEvidenceJson,
} from "../../packages/telemetry-contracts/src/index.js";
import {
  mayFormallyConsumeProviderClosure,
  type ProviderClosureManifest,
} from "../../integrations/sdar-benchmark-server/mcp-provider-telemetry/v2/consumer-contract.js";

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

test("Provider v2 migrations are additive, generic, manifest-gated, and preserve migration 015", async () => {
  const source = await readFile("migrations/clickhouse/015_provider_closure_v2.sql", "utf8");
  const semantic = await readFile("migrations/clickhouse/016_provider_closure_task_semantics_v2.sql", "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "dba7693c2ee3fe52bc4ea61182cce87244c6f83dbf2f5a94048da9fb9ed9740a");
  assert.equal(createHash("sha256").update(semantic).digest("hex"),
    "bb55fff94bce66ec9e72d5a53dca8d338d4efeab48d4a9e05d9f606e14708ff4");
  assert.equal((source.match(/CREATE TABLE IF NOT EXISTS/gu) ?? []).length, 5);
  assert.equal((source.match(/CREATE VIEW IF NOT EXISTS/gu) ?? []).length, 5);
  assert.equal((source.match(/provider_closure_manifest_v2 FINAL/gu) ?? []).length, 5);
  assert.equal((semantic.match(/ADD COLUMN IF NOT EXISTS/gu) ?? []).length, 10);
  assert.equal((semantic.match(/provider_closure_manifest_v2 FINAL/gu) ?? []).length, 3);
  assert.doesNotMatch(source, /\b(?:ALTER|DELETE|DROP|INSERT|TRUNCATE|UPDATE)\b/iu);
  assert.doesNotMatch(semantic, /\b(?:DELETE|DROP|INSERT|TRUNCATE|UPDATE)\b/iu);
  assert.doesNotMatch(`${source}\n${semantic}`, /\bugv\b/iu);
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
    externalServerId: bindingA.externalProviderInstanceId,
    runtimeServerId: "sdar-runtime-a",
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
    externalProviderInstanceId: bindingA.externalProviderInstanceId,
    revision: "1",
    status: bindingA.status,
    updatedAt: bindingA.updatedAt,
    authoritativeOriginRuntimeIds: ["sdar-runtime-a"],
    authoritativeOriginTaskIds: [bindingA.a2aTaskId],
  });
  assert.throws(
    () => canonicalBinding({ record_json: JSON.stringify({ ...record, payloadHash: sha("current-binding") }) }, scopeA),
    /PROVIDER_CANONICAL_BINDING_INVALID/,
  );
});

test("Canonical discovery keeps the DateTime cursor outside the projected_at text alias", async () => {
  let observedSql = "";
  const source = new CanonicalProviderClosureSource({
    query: (sql) => {
      observedSql = sql;
      return Promise.resolve("");
    },
    insert: () => Promise.resolve(),
  }, {
    tenantId: scopeA.tenantId,
    projectId: scopeA.projectId,
    environment: scopeA.environment,
    exportId: "export-a",
    sourceId: "source-a",
    nodeId: "node-a",
    notBefore: "2026-08-21T00:00:00.000Z",
  });

  assert.deepEqual(await source.discover({
    projectedAt: "2026-08-21T00:00:00.000Z",
    rowId: "",
  }), []);
  assert.match(observedSql, /\(evidence\.projected_at,evidence\.row_id\) >/u);
  assert.doesNotMatch(observedSql, /AND \(projected_at,row_id\) >/u);

  await source.capture(scopeA, "2026-08-21T00:01:00.000Z");
  assert.match(observedSql, /AND evidence\.projected_at<=parseDateTime64BestEffort/u);
  assert.doesNotMatch(observedSql, /AND projected_at<=parseDateTime64BestEffort/u);
});

test("Canonical Runtime Evidence is verified with the Evidence canonical hash contract", async () => {
  const payload = {
    intentId: "intent-hash-contract",
    bindingId: bindingA.bindingId,
    status: "uncertain",
    dispatchHash: sha("dispatch"),
    dispatchedAt: "2026-08-21T00:00:01.000Z",
    redispatchAllowed: false,
  };
  assert.notEqual(hashCanonicalEvidenceJson(payload), hashCanonicalDomainProjectionJson(payload));
  const record = {
    recordType: "mcp_task.admission",
    episodeId: scopeA.episodeId,
    tenantId: scopeA.tenantId,
    projectId: scopeA.projectId,
    environment: scopeA.environment,
    payload,
    payloadHash: hashCanonicalEvidenceJson(payload),
    recordedAt: "2026-08-21T00:00:01.000Z",
    sourceRecordId: "intent-hash-contract",
  };
  const source = new CanonicalProviderClosureSource({
    query: (sql) => Promise.resolve(sql.includes("record_type IN")
      ? `${JSON.stringify({
          identity: "runtime-hash-row",
          record_json: JSON.stringify(record),
          projected_at: "2026-08-21 00:00:02.000",
        })}\n`
      : ""),
    insert: () => Promise.resolve(),
  }, {
    tenantId: scopeA.tenantId,
    projectId: scopeA.projectId,
    environment: scopeA.environment,
    exportId: "export-a",
    sourceId: "source-a",
    nodeId: "node-a",
    notBefore: "2026-08-21T00:00:00.000Z",
  });

  const capture = await source.capture(scopeA, "2026-08-21T00:01:00.000Z");
  assert.equal(capture.bindingCount, 0);
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
    "sdar_mart.provider_closure_task_semantic_v2",
  ]);
  await commit();
  assert.equal(calls.at(-1), "sdar_mart.provider_closure_manifest_v2");
});

test("exact Task to Execution closure uses only the frozen Provider tuple", async () => {
  const exact = semanticFact(1, bindingA, { externalExecutionId: "execution-a" });
  const closure = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [exact], []),
    { ...scopeA, required: true, asOfProjectedAt: "2026-08-21T00:01:00.000Z" },
  );
  assert.equal(closure.closure.taskSemantics[0]?.taskExecution.status, "exact");
  assert.equal(closure.closure.taskSemantics[0]?.taskExecution.selectedExecutionId, "execution-a");
  assert.equal(closure.closure.unresolvedExecutionCount, 0);
  assert.equal(closure.readiness.status, "ready");
  assert.equal(closure.readiness.physicalSuccessProven, false);
  assert.equal(closure.readiness.goalSuccessProven, false);
});

test("same remote Task ID remains isolated by the complete Runtime Provider tuple", async () => {
  const otherBinding: ProviderRemoteTaskBinding = {
    ...bindingA,
    bindingId: "binding-other-provider",
    a2aTaskId: "a2a-other-provider",
    providerOriginSourceId: "source-other",
    externalProviderId: "provider-other",
    externalProviderInstanceId: "instance-other",
  };
  const first = semanticFact(1, bindingA, { externalExecutionId: "execution-a" });
  const second = semanticFact(2, otherBinding, { externalExecutionId: "execution-other" });
  const closure = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA, otherBinding], [first, second], []),
    { ...scopeA, required: true, asOfProjectedAt: "2026-08-21T00:01:00.000Z" },
  );

  assert.equal(closure.readiness.status, "ready");
  assert.deepEqual(
    closure.closure.taskSemantics.map((semantic) => [
      semantic.bindingId,
      semantic.taskExecution.selectedExecutionId,
    ]),
    [
      ["binding-a", "execution-a"],
      ["binding-other-provider", "execution-other"],
    ],
  );
});

test("zero and multiple Provider executions are unresolved and conflict without time heuristics", async () => {
  const unresolved = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [fact(1, bindingA)], []),
    { ...scopeA, required: true },
  );
  assert.equal(unresolved.closure.taskSemantics[0]?.taskExecution.status, "unresolved");
  assert.equal(unresolved.readiness.status, "not_ready");
  assert.ok(unresolved.readiness.reasonCodes.includes("SMPP_PROVIDER_EXECUTION_MISSING"));

  const conflict = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [
      semanticFact(1, bindingA, { externalExecutionId: "execution-older" }),
      semanticFact(2, bindingA, { externalExecutionId: "execution-newer" }),
    ], []),
    { ...scopeA, required: true },
  );
  assert.equal(conflict.closure.taskSemantics[0]?.taskExecution.status, "conflict");
  assert.deepEqual(conflict.closure.taskSemantics[0]?.taskExecution.candidateExecutionIds,
    ["execution-newer", "execution-older"]);
  assert.equal(conflict.readiness.status, "conflict");
});

test("uncertain dispatch stays independent and found exact recovers only the original execution", async () => {
  const uncertain = semanticFact(1, bindingA, {
    externalExecutionId: "execution-a",
    uncertainty: true,
  });
  const found = semanticFact(2, bindingA, {
    externalExecutionId: "execution-a",
    reconciliation: "found",
  });
  const recovered = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [uncertain, found], []),
    { ...scopeA, required: true },
  );
  assert.equal(recovered.closure.taskSemantics[0]?.dispatch.status, "recovered");
  assert.equal(recovered.closure.taskSemantics[0]?.dispatch.reconciliationStatus, "found_exact");

  for (const status of ["not_found", "transient_unavailable", "deferred"] as const) {
    const incomplete = await assembleProviderEpisodeClosure(
      new MemoryClosureSource([bindingA], [uncertain, semanticFact(3, bindingA, {
        reconciliation: status,
      })], []),
      { ...scopeA, required: true },
    );
    assert.equal(incomplete.closure.taskSemantics[0]?.dispatch.status, "unresolved");
    assert.equal(incomplete.readiness.status, "not_ready");
  }
});

test("four terminal axes remain independent and terminal failure can be structurally ready", async () => {
  const terminal = semanticFact(1, bindingA, {
    externalExecutionId: "execution-a",
    terminal: {
      mcpTaskStatus: "completed",
      transportStatus: "completed",
      providerExecutionStatus: "terminal_succeeded",
      businessStatus: "failed",
    },
  });
  const closure = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [terminal], []),
    { ...scopeA, required: true },
  );
  const axes = closure.closure.taskSemantics[0]?.terminal;
  assert.equal(axes?.mcpTaskControlState, "completed");
  assert.equal(axes?.dispatchTransportState, "certain");
  assert.equal(axes?.providerExecutionState, "terminal_succeeded");
  assert.equal(axes?.providerBusinessOutcome, "failed");
  assert.equal(closure.readiness.status, "ready");
});

test("optional Mission unresolved does not block phase-one readiness and observedAt is preserved", async () => {
  const mission = semanticFact(1, bindingA, {
    externalExecutionId: "execution-a",
    mission: "unresolved",
  });
  const closure = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [mission], []),
    { ...scopeA, required: true },
  );
  assert.equal(closure.closure.taskSemantics[0]?.mission.status, "unresolved");
  assert.equal(closure.readiness.status, "ready");
  assert.equal(closure.closure.providerFacts[0]?.observedAt, "2026-08-21T00:00:01.000Z");
});

test("same inputs are deterministic while late projected evidence creates a new immutable snapshot", async () => {
  const firstFact = semanticFact(1, bindingA, { externalExecutionId: "execution-a" });
  const firstSource = new MemoryClosureSource([bindingA], [firstFact], []);
  const first = await assembleProviderEpisodeClosure(firstSource, {
    ...scopeA, required: true, asOfProjectedAt: "2026-08-21T00:01:00.000Z",
  });
  const replay = await assembleProviderEpisodeClosure(firstSource, {
    ...scopeA, required: true, asOfProjectedAt: "2026-08-21T00:01:00.000Z",
  });
  assert.equal(closurePublication(first).snapshotId, closurePublication(replay).snapshotId);
  const late = await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA], [firstFact, semanticFact(2, bindingA, {
      externalExecutionId: "execution-a",
      terminal: {mcpTaskStatus:"completed",transportStatus:"completed",providerExecutionStatus:"terminal_succeeded",businessStatus:"succeeded"},
    })], []),
    { ...scopeA, required: true, asOfProjectedAt: "2026-08-21T00:02:00.000Z" },
  );
  assert.notEqual(closurePublication(first).snapshotId, closurePublication(late).snapshotId);
});

test("SDAR Canonical Evidence resolves Runtime uncertainty and control state by binding identity", async () => {
  const runtime = [
    runtimeEvidence("admission-row", "mcp_task.admission", {intentId:"intent-a",bindingId:bindingA.bindingId,status:"uncertain"}),
    runtimeEvidence("uncertain-row", "mcp_task.dispatch_uncertain", {intentId:"intent-a",reasonCode:"REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN",redispatchAllowed:false}),
    runtimeEvidence("reconcile-row", "mcp_task.dispatch_reconciliation", {intentId:"intent-a",status:"found_exact",identityValidated:true,remoteTaskId:bindingA.remoteTaskId,externalExecutionId:"execution-a"}),
    runtimeEvidence("link-row", "mcp_task.provider_execution_link", {bindingId:bindingA.bindingId,remoteTaskId:bindingA.remoteTaskId,
      providerId:bindingA.externalProviderId,smppSourceId:bindingA.providerOriginSourceId,externalServerId:bindingA.externalProviderInstanceId,
      executionStatus:"exact",externalExecutionId:"execution-a",missionStatus:"unresolved"}),
    runtimeEvidence("control-row", "mcp_task.control_event", {bindingId:bindingA.bindingId,eventType:"task.failed",status:"processed"}),
  ];
  const closure=await assembleProviderEpisodeClosure(new MemoryClosureSource(
    [bindingA],[semanticFact(1,bindingA,{externalExecutionId:"execution-a",terminal:{mcpTaskStatus:"failed",transportStatus:"completed",providerExecutionStatus:"terminal_failed",businessStatus:"failed"}})],[],false,false,runtime),
  {...scopeA,required:true});
  const semantic=closure.closure.taskSemantics[0];
  assert.equal(semantic?.taskExecution.status,"exact");
  assert.equal(semantic?.dispatch.status,"recovered");
  assert.equal(semantic?.terminal.mcpTaskControlState,"failed");
  assert.equal(semantic?.terminal.providerExecutionState,"terminal_failed");
  assert.equal(semantic?.terminal.providerBusinessOutcome,"failed");
  assert.equal(semantic?.mission.status,"unresolved");
  assert.equal(closure.readiness.status,"ready");
});

test("uncertainty and reconciliation may share one authoritative attempt source identity", async () => {
  const admission=runtimeEvidence("admission-shared","mcp_task.admission",{intentId:"intent-shared",bindingId:bindingA.bindingId,status:"uncertain"});
  const uncertain={...runtimeEvidence("uncertain-shared","mcp_task.dispatch_uncertain",{intentId:"intent-shared",redispatchAllowed:false}),sourceRecordId:"attempt-shared"};
  const reconciliation={...runtimeEvidence("reconcile-shared","mcp_task.dispatch_reconciliation",{
    intentId:"intent-shared",status:"found_exact",identityValidated:true,remoteTaskId:bindingA.remoteTaskId,externalExecutionId:"execution-a",redispatchAllowed:false,
  }),sourceRecordId:"attempt-shared"};
  const closure=await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA],[semanticFact(1,bindingA,{externalExecutionId:"execution-a"})],[],false,false,[admission,uncertain,reconciliation]),
    {...scopeA,required:true},
  );
  assert.equal(closure.closure.identityHashConflictCount,0);
  assert.equal(closure.closure.taskSemantics[0]?.dispatch.status,"recovered");
  assert.equal(closure.readiness.status,"ready");
});

test("same identity with different hash and conflicting terminal outcomes fail closed", async () => {
  const first=semanticFact(1,bindingA,{externalExecutionId:"execution-a",terminal:{mcpTaskStatus:"completed",transportStatus:"completed",providerExecutionStatus:"terminal_succeeded",businessStatus:"succeeded"}});
  const duplicate={...first,factHash:sha("different-content")};
  const identityConflict=await assembleProviderEpisodeClosure(new MemoryClosureSource([bindingA],[first,duplicate],[]),{...scopeA,required:true});
  assert.equal(identityConflict.readiness.status,"conflict");
  assert.equal(identityConflict.closure.identityHashConflictCount,1);
  assert.ok(identityConflict.readiness.reasonCodes.includes("SMPP_PROVIDER_IDENTITY_HASH_CONFLICT"));

  const failed=semanticFact(2,bindingA,{externalExecutionId:"execution-a",terminal:{mcpTaskStatus:"completed",transportStatus:"completed",providerExecutionStatus:"terminal_succeeded",businessStatus:"failed"}});
  const terminalConflict=await assembleProviderEpisodeClosure(new MemoryClosureSource([bindingA],[first,failed],[]),{...scopeA,required:true});
  assert.equal(terminalConflict.readiness.status,"conflict");
  assert.equal(terminalConflict.closure.terminalConflictCount,1);
  assert.ok(terminalConflict.readiness.reasonCodes.includes("SMPP_PROVIDER_TERMINAL_CONFLICT"));
});

test("same deterministic identity and hash is idempotent", async () => {
  const first=semanticFact(1,bindingA,{externalExecutionId:"execution-a"});
  const closure=await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA],[first,{...first}],[]),
    {...scopeA,required:true},
  );
  assert.equal(closure.closure.identityHashConflictCount,0);
  assert.equal(closure.closure.taskSemantics[0]?.taskExecution.status,"exact");
  assert.equal(closure.readiness.status,"ready");
});

test("Runtime provider link cannot override the authoritative Provider tuple", async () => {
  const mismatched=runtimeEvidence("foreign-link","mcp_task.provider_execution_link",{
    bindingId:bindingA.bindingId,
    remoteTaskId:bindingA.remoteTaskId,
    providerId:bindingA.externalProviderId,
    smppSourceId:bindingA.providerOriginSourceId,
    externalServerId:"foreign-instance",
    executionStatus:"exact",
    externalExecutionId:"foreign-execution",
    missionStatus:"unresolved",
  });
  const closure=await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA],[semanticFact(1,bindingA,{externalExecutionId:"execution-a"})],[],false,false,[mismatched]),
    {...scopeA,required:true},
  );
  assert.equal(closure.closure.taskSemantics[0]?.taskExecution.status,"conflict");
  assert.equal(closure.readiness.status,"conflict");
  assert.deepEqual(closure.closure.taskSemantics[0]?.taskExecution.candidateExecutionIds,["execution-a"]);
});

test("Runtime reconciliation and provider link must repeat authoritative task and runtime identities", async () => {
  const runtimeBinding = {
    ...bindingA,
    authoritativeOriginRuntimeIds: ["runtime-authoritative"],
  };
  const runtime = [
    runtimeEvidence("admission-authority", "mcp_task.admission", {
      intentId: "intent-authority",
      bindingId: runtimeBinding.bindingId,
      status: "uncertain",
    }),
    runtimeEvidence("uncertain-authority", "mcp_task.dispatch_uncertain", {
      intentId: "intent-authority",
      redispatchAllowed: false,
    }),
    runtimeEvidence("reconcile-foreign-task", "mcp_task.dispatch_reconciliation", {
      intentId: "intent-authority",
      status: "found_exact",
      identityValidated: true,
      remoteTaskId: "foreign-task",
      externalExecutionId: "execution-a",
    }),
    runtimeEvidence("link-foreign-runtime", "mcp_task.provider_execution_link", {
      bindingId: runtimeBinding.bindingId,
      remoteTaskId: runtimeBinding.remoteTaskId,
      providerId: runtimeBinding.externalProviderId,
      smppSourceId: runtimeBinding.providerOriginSourceId,
      externalServerId: runtimeBinding.externalProviderInstanceId,
      runtimeServerId: "runtime-foreign",
      executionStatus: "exact",
      externalExecutionId: "execution-a",
      missionStatus: "unresolved",
    }),
  ];
  const closure = await assembleProviderEpisodeClosure(
    new MemoryClosureSource(
      [runtimeBinding],
      [semanticFact(1, runtimeBinding, { externalExecutionId: "execution-a" })],
      [],
      false,
      false,
      runtime,
    ),
    { ...scopeA, required: true },
  );

  assert.equal(closure.closure.taskSemantics[0]?.taskExecution.status, "conflict");
  assert.equal(closure.closure.taskSemantics[0]?.dispatch.reconciliationStatus, "conflict");
  assert.equal(closure.closure.taskSemantics[0]?.dispatch.status, "conflict");
  assert.equal(closure.readiness.status, "conflict");
});

test("reconciliation conflict remains conflict and never becomes a recovered dispatch", async () => {
  const uncertain=semanticFact(1,bindingA,{externalExecutionId:"execution-a",uncertainty:true});
  const conflict=semanticFact(2,bindingA,{reconciliation:"conflict"});
  const closure=await assembleProviderEpisodeClosure(
    new MemoryClosureSource([bindingA],[uncertain,conflict],[]),
    {...scopeA,required:true},
  );
  assert.equal(closure.closure.taskSemantics[0]?.dispatch.reconciliationStatus,"conflict");
  assert.equal(closure.closure.taskSemantics[0]?.dispatch.status,"conflict");
  assert.equal(closure.readiness.status,"conflict");
});

test("Benchmark v2 consumer accepts only exact ready semantic closure", () => {
  const ready={
    contractId:"sdar.telemetry-smpp-providerops-handoff/v2",closureSnapshotId:sha("benchmark-ready"),
    asOfProjectedAt:"2026-08-21T00:01:00.000Z",effectiveWatermark:"2026-08-21T00:00:02.000Z",
    bindingCount:1,remoteTaskCount:1,providerSourceCount:1,expectedFactCount:1,selectedFactCount:1,
    bindingDerivedRelationCount:1,originClaimCount:0,relationHintCount:0,matchedClaimCount:0,missingClaimCount:0,
    unverifiableClaimCount:0,ambiguousClaimCount:0,conflictingClaimCount:0,unresolvedBindingCount:0,
    unresolvedExecutionCount:0,conflictingExecutionCount:0,unresolvedReconciliationCount:0,terminalConflictCount:0,
    identityHashConflictCount:0,foreignFactCount:0,pageCount:4,truncated:false,hintsUsedForAuthority:false,
    bindingAuthorityHash:sha("binding-authority"),selectionPredicateHash:sha("selection"),reconciliationHash:sha("reconciliation"),
    closureContentHash:sha("closure"),status:"ready",reasonCodes:[],goalSuccessProven:false,physicalSuccessProven:false,
  } satisfies ProviderClosureManifest;
  assert.equal(mayFormallyConsumeProviderClosure(ready),true);
  assert.equal(mayFormallyConsumeProviderClosure({...ready,status:"not_ready",unresolvedExecutionCount:1}),false);
  assert.equal(mayFormallyConsumeProviderClosure({...ready,status:"conflict",conflictingExecutionCount:1}),false);
  assert.equal(mayFormallyConsumeProviderClosure({...ready,status:"conflict",unresolvedReconciliationCount:1}),false);
});

class MemoryClosureSource implements ProviderEpisodeClosureDataSource {
  captureCount = 0;

  constructor(
    private readonly bindings: readonly ProviderRemoteTaskBinding[],
    private readonly facts: readonly ProviderClosureFact[],
    private readonly hints: readonly ProviderReconciliationHint[],
    private readonly leakForeignFacts = false,
    private readonly moving = false,
    private readonly runtimeEvidence: readonly ProviderRuntimeEvidence[] = [],
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
      expectedFactCount: new Set(facts.map((fact) => fact.factId)).size,
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
  listRuntimeEvidence(input: {readonly cursor:string|null;readonly limit:number}): Promise<ProviderEvidencePage<ProviderRuntimeEvidence>> {
    return Promise.resolve(page(this.runtimeEvidence,input.cursor,input.limit));
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

function semanticFact(index: number, binding: ProviderRemoteTaskBinding, input: {
  readonly externalExecutionId?: string;
  readonly uncertainty?: boolean;
  readonly reconciliation?: "found" | "not_found" | "conflict" | "transient_unavailable" | "deferred";
  readonly terminal?: {readonly mcpTaskStatus:string;readonly transportStatus:string;readonly providerExecutionStatus:string;readonly businessStatus:string};
  readonly mission?: "exact" | "unresolved" | "conflict";
}): ProviderClosureFact {
  const base=fact(index,binding);const occurredAt=base.occurredAt;
  return {...base,...(input.externalExecutionId===undefined?{}:{externalExecutionId:input.externalExecutionId}),observedAt:occurredAt,
    providerOpsSemantics:{contractId:"smpp.runtime-providerops-semantics/v1",capabilityIds:[],
      ...(input.uncertainty?{uncertainty:{taskId:binding.remoteTaskId,uncertaintyClass:"response_lost_after_adapter_success",redispatchAllowed:false as const,occurredAt}}:{}),
      ...(input.reconciliation===undefined?{}:{reconciliation:{taskId:binding.remoteTaskId,attempt:1,status:input.reconciliation,
        ...(input.reconciliation==="found"?{externalExecutionId:input.externalExecutionId??"execution-a"}:{}),identityValidated:input.reconciliation==="found",occurredAt}}),
      ...(input.terminal===undefined?{}:{businessTerminal:{taskId:binding.remoteTaskId,...input.terminal,isError:input.terminal.businessStatus==="failed"}}),
      ...(input.mission===undefined?{}:{missionRelation:{taskId:binding.remoteTaskId,externalExecutionId:input.externalExecutionId??"execution-a",
        relationStatus:input.mission,...(input.mission==="exact"?{deviceMissionId:"mission-a"}:{}),sourceRecordRefs:[],observedAt:occurredAt}})}};
}

function runtimeEvidence(rowId:string,recordType:ProviderRuntimeEvidence["recordType"],payload:Record<string,unknown>):ProviderRuntimeEvidence{
  return {rowId,sourceRecordId:`source-${rowId}`,recordType,payload,payloadHash:sha(payload),recordedAt:"2026-08-21T00:00:01.000Z",projectedAt:"2026-08-21T00:00:02.000Z"};
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
