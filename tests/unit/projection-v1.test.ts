import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  EVIDENCE_V1_EXPLICIT_CANONICAL_ONLY_RECORD_TYPES,
  ProjectionRegistry,
  canonicalProjection,
  evidenceV1ProjectionCoverage,
  v14Projection,
} from "../../packages/telemetry-projection-registry/src/index.js";
import type {
  CanonicalFact,
  EvidenceV1JsonValue,
  EvidenceV1Record,
  EvidenceV1RecordFamily,
} from "../../packages/telemetry-types/src/index.js";

const repositoryRoot = process.cwd();
const canonicalMigrationPath = path.join(
  repositoryRoot,
  "migrations/clickhouse/014_sdar_evidence_v1_canonical.sql",
);
const v14MigrationPath = path.join(
  repositoryRoot,
  "vendor/sdar-clickhouse-schema/sdar_clickhouse_schema_v1_0/migrations/13_sdar_v1_4_capability_chain.sql",
);

test("Evidence v1 canonical and specialized rows match their ClickHouse DDL columns", async () => {
  const [canonicalDdl, v14Ddl] = await Promise.all([
    readFile(canonicalMigrationPath, "utf8"),
    readFile(v14MigrationPath, "utf8"),
  ]);
  const fixtures = specializedFixtures();
  const canonical = only(canonicalProjection.project(fixtures[0]?.fact as CanonicalFact));
  assert.equal(canonical.table, "sdar_core.sdar_evidence_v1_record");
  assert.deepEqual(
    Object.keys(canonical.row).sort(),
    ddlColumns(canonicalDdl, canonical.table).sort(),
  );

  for (const fixture of fixtures) {
    const specialized = only(v14Projection.project(fixture.fact));
    assert.equal(specialized.table, fixture.table);
    assert.deepEqual(
      Object.keys(specialized.row).sort(),
      ddlColumns(v14Ddl, specialized.table).sort(),
    );
  }
});

test("canonical landing preserves exact Evidence v1 identity and all lineage", () => {
  const {fact} = specializedFixtures()[0] as SpecializedFixture;
  const projection = only(canonicalProjection.project(fact));
  const row = projection.row;
  assert.equal(row.fact_id, fact.factId);
  assert.equal(row.record_id, fact.recordId);
  assert.match(String(row.record_id), /^evidence_[0-9a-f]{64}$/u);
  assert.match(String(row.row_id), /^[0-9a-f]{64}$/u);
  assert.equal(row.export_id, fact.exportId);
  assert.equal(row.export_revision, fact.exportRevision);
  assert.equal(row.source_id, fact.sourceId);
  assert.equal(row.batch_node_id, fact.batchNodeId);
  assert.equal(row.node_id, fact.evidenceRecord?.nodeId);
  assert.equal(row.batch_hash, fact.batchHash);
  assert.equal(row.first_sequence, fact.firstSequence);
  assert.equal(row.last_sequence, fact.lastSequence);
  assert.equal(row.evidence_sequence, fact.evidenceSequence);
  assert.equal(row.task_id, fact.taskId);
  assert.equal(row.episode_id, fact.episodeId);
  assert.equal(row.skill_execution_id, fact.skillExecutionId);
  assert.equal(row.capability_binding_id, fact.capabilityBindingId);
  assert.equal(row.remote_task_binding_id, fact.remoteTaskBindingId);
  assert.deepEqual(JSON.parse(String(row.payload_json)), fact.payload);
  assert.deepEqual(JSON.parse(String(row.record_json)), fact.evidenceRecord);
  assert.equal(row.wal_partition, fact.walPartition);
  assert.equal(row.wal_offset, fact.walOffset);
  assert.equal(row.wal_written_at, fact.walWrittenAt);
  assert.equal(row.wal_payload_hash, fact.walPayloadHash);
});

test("canonical and specialized projection identities are stable under replay", () => {
  for (const {fact} of specializedFixtures()) {
    assert.deepEqual(canonicalProjection.project(fact), canonicalProjection.project(fact));
    const first = only(v14Projection.project(fact));
    const replay = only(v14Projection.project(fact));
    assert.deepEqual(first, replay);
    assert.match(
      String(first.row.record_id),
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  }
});

test("canonical row identity is stable across new export and WAL delivery lineage", () => {
  const originalFact = (specializedFixtures()[0] as SpecializedFixture).fact;
  const redeliveredFact = structuredClone(originalFact);
  redeliveredFact.exportId = "export-2";
  redeliveredFact.exportRevision = 8;
  redeliveredFact.batchHash = `sha256:${"8".repeat(64)}`;
  redeliveredFact.firstSequence = "142";
  redeliveredFact.lastSequence = "142";
  redeliveredFact.walPartition = "source-1";
  redeliveredFact.walOffset = 202;
  redeliveredFact.walWrittenAt = "2026-08-14T03:00:02.000Z";
  redeliveredFact.walPayloadHash = `sha256:${"7".repeat(64)}`;
  redeliveredFact.receivedAt = "2026-08-14T03:00:03.000Z";
  redeliveredFact.ingestedAt = "2026-08-14T03:00:03.000Z";

  const original = only(canonicalProjection.project(originalFact)).row;
  const redelivered = only(canonicalProjection.project(redeliveredFact)).row;
  assert.equal(redelivered.record_id, original.record_id);
  assert.equal(redelivered.fact_id, original.fact_id);
  assert.equal(redelivered.row_id, original.row_id);
  assert.notEqual(redelivered.export_id, original.export_id);
  assert.notEqual(redelivered.export_revision, original.export_revision);
  assert.notEqual(redelivered.batch_hash, original.batch_hash);
  assert.notEqual(redelivered.wal_partition, original.wal_partition);
  assert.notEqual(redelivered.wal_offset, original.wal_offset);
  assert.notEqual(redelivered.projected_at, original.projected_at);
});

test("capability, readiness and task attempt records remain explicitly canonical-only", () => {
  const registry = new ProjectionRegistry();
  registry.register(canonicalProjection);
  registry.register(v14Projection);

  for (const [index, recordType] of EVIDENCE_V1_EXPLICIT_CANONICAL_ONLY_RECORD_TYPES.entries()) {
    const fact = evidenceFact(recordType, {identity: recordType}, "456789ab"[index] as string);
    const rows = registry.project(fact);
    assert.deepEqual(rows.map((row) => row.table), ["sdar_core.sdar_evidence_v1_record"]);
    assert.equal(evidenceV1ProjectionCoverage(fact).mode, "canonical-only");
  }

  const incompleteSpecialized = evidenceFact(
    "node_control.capability_revision",
    {capabilityId: "capability-incomplete"},
    "d",
  );
  assert.deepEqual(v14Projection.project(incompleteSpecialized), []);
  assert.equal(evidenceV1ProjectionCoverage(incompleteSpecialized).mode, "canonical-only");
});

test("recordType routing has no generic specialized fallback or obsolete table names", async () => {
  const legacyCases = [
    ["sdar.node_capability.version", "sdar_core.node_capability_version_fact"],
    [
      "sdar.node_capability.implementation_binding",
      "sdar_core.capability_implementation_binding_fact",
    ],
    ["sdar.node_capability.readiness", "sdar_core.capability_readiness_fact"],
    ["sdar.a2a.exposure_revision", "sdar_core.a2a_exposure_revision_fact"],
    ["sdar.a2a.agent_card_revision", "sdar_core.agent_card_revision_fact"],
    ["sdar.task.capability_binding", "sdar_core.task_capability_binding_fact"],
    ["sdar.task.capability_attempt", "sdar_core.task_capability_attempt_fact"],
  ] as const;
  for (const [recordFamily, table] of legacyCases) {
    assert.equal(only(v14Projection.project(legacyFact(recordFamily))).table, table);
  }
  assert.deepEqual(v14Projection.project(legacyFact("sdar.node_control.configuration_revision")), []);
  assert.deepEqual(
    v14Projection.project(evidenceFact("node_control.profile_revision", {profileId: "p-1"}, "e")),
    [],
  );

  const source = await readFile(
    path.join(repositoryRoot, "packages/telemetry-projection-registry/src/index.ts"),
    "utf8",
  );
  for (const obsolete of [
    "sdar_core.node_capability_implementation_binding_fact",
    "sdar_core.node_capability_readiness_fact",
    "sdar_core.a2a_agent_card_revision_fact",
    "sdar_core.node_control_configuration_revision_fact",
  ]) {
    assert.equal(source.includes(obsolete), false, obsolete);
  }
});

test("canonical migration is additive and keeps evidence record_id as String", async () => {
  const ddl = await readFile(canonicalMigrationPath, "utf8");
  assert.match(ddl, /CREATE DATABASE IF NOT EXISTS sdar_core;/u);
  assert.deepEqual(
    [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS ([A-Za-z0-9_.]+)/gu)].map((match) => match[1]),
    ["sdar_core.sdar_evidence_v1_record"],
  );
  assert.match(ddl, /\brecord_id String,/u);
  assert.match(ddl, /ENGINE = ReplacingMergeTree\(projected_at\)/u);
  assert.doesNotMatch(ddl, /\b(?:DROP|ALTER|DELETE|TRUNCATE|INSERT|UPDATE)\b/iu);
});

interface SpecializedFixture {
  fact: CanonicalFact;
  table: string;
}

function specializedFixtures(): SpecializedFixture[] {
  return [
    {
      fact: evidenceFact(
        "node_control.capability_revision",
        {
          capabilityId: "capability.navigate",
          version: 3,
          domain: "navigation",
          name: "Navigate",
          description: "Navigate to the requested location.",
          inputSchema: {type: "object"},
          outputSchema: {type: "object"},
          successCriteria: [{criterion: "arrived"}],
          requiredEvidence: [{recordType: "runtime.outcome"}],
          effects: ["location.changed"],
          artifacts: [],
          constraints: [{kind: "safety"}],
          supportedModes: ["execute"],
          riskLevel: "medium",
          status: "published",
          definitionHash: `sha256:${"a".repeat(64)}`,
          previousVersion: 2,
          createdBy: "operator-1",
          createdAt: "2026-08-14T01:00:00.000Z",
          updatedAt: "2026-08-14T02:00:00.000Z",
        },
        "1",
      ),
      table: "sdar_core.node_capability_version_fact",
    },
    {
      fact: evidenceFact(
        "node_control.a2a_exposure",
        {
          exposureId: "exposure.navigate",
          version: 4,
          capabilityId: "capability.navigate",
          capabilityVersion: 3,
          agentSkillId: "agent-skill.navigate",
          name: "Navigate",
          description: "Public navigation capability.",
          tags: ["navigation"],
          examples: ["Move to waypoint alpha"],
          inputModes: ["application/json"],
          outputModes: ["application/json"],
          requestSchema: {type: "object"},
          resultSchema: {type: "object"},
          visibility: "organization",
          requesterPolicy: null,
          readinessPublicationPolicy: "publish_when_available",
          status: "published",
          exposureHash: `sha256:${"b".repeat(64)}`,
          createdAt: "2026-08-14T01:00:00.000Z",
          updatedAt: "2026-08-14T02:00:00.000Z",
        },
        "2",
      ),
      table: "sdar_core.a2a_exposure_revision_fact",
    },
    {
      fact: evidenceFact(
        "node_control.agent_card_revision",
        {
          revision: 5,
          nodeId: "node-record-1",
          exposureRefs: ["exposure.navigate@4"],
          contentHash: `sha256:${"c".repeat(64)}`,
          capabilityCatalogHash: `sha256:${"d".repeat(64)}`,
          status: "active",
          card: {name: "SDAR node"},
          generatedAt: "2026-08-14T02:00:00.000Z",
          activatedAt: "2026-08-14T02:01:00.000Z",
          rejectionCode: null,
        },
        "3",
      ),
      table: "sdar_core.agent_card_revision_fact",
    },
  ];
}

function evidenceFact(recordType: string, payload: Record<string, unknown>, idDigit: string): CanonicalFact {
  const family = recordType.split(".")[0] as EvidenceV1RecordFamily;
  const recordId = `evidence_${idDigit.repeat(64)}` as `evidence_${string}`;
  const payloadHash = `sha256:${idDigit.repeat(64)}` as `sha256:${string}`;
  const record: EvidenceV1Record = {
    contractVersion: "sdar.evidence/v1",
    schemaName: `sdar.evidence.${recordType}`,
    schemaVersion: 1,
    recordFamily: family,
    recordType,
    recordId,
    sourceSystem: "node_control",
    sourceTable: `source.${recordType.replaceAll(".", "_")}`,
    sourceRecordId: `${recordType}:source-record-1`,
    sourceRevision: `${recordType}:revision-1`,
    tenantId: "tenant-1",
    userScopeId: "user-scope-1",
    projectId: "project-1",
    environment: "integration",
    taskId: "task-1",
    contextId: "context-1",
    episodeId: "episode-1",
    runId: "run-1",
    goalId: "goal-1",
    goalVersion: 2,
    planId: "plan-1",
    planVersion: 3,
    skillExecutionId: "skill-execution-1",
    capabilityBindingId: "capability-binding-1",
    remoteTaskBindingId: "remote-task-binding-1",
    nodeId: "node-record-1",
    correlationId: "correlation-1",
    causationId: "causation-1",
    occurredAt: "2026-08-14T02:00:00.000Z",
    recordedAt: "2026-08-14T02:00:01.000Z",
    deliveryGuarantee: "durable_projection",
    evaluationRole: "required",
    observationGeneration: 0,
    evidenceSequence: "42",
    evidenceRefs: ["evidence-ref-1"],
    artifactRefs: ["artifact-ref-1"],
    payloadHash,
    payload: payload as EvidenceV1JsonValue,
  };
  return {
    factId: recordId,
    sourceId: "sdar-runtime-local",
    sourceType: "sdar-evidence-v1",
    sourceRecordId: record.sourceRecordId,
    recordFamily: family,
    tenantId: record.tenantId,
    occurredAt: record.occurredAt,
    ingestedAt: "2026-08-14T02:00:03.000Z",
    payload: record.payload,
    payloadHash,
    correlationId: record.correlationId,
    projectionVersion: "1.0.0",
    contractVersion: "sdar.evidence/v1",
    exportId: "export-1",
    nodeId: "node-batch-1",
    exportRevision: 7,
    batchHash: `sha256:${"f".repeat(64)}`,
    batchNodeId: "node-batch-1",
    firstSequence: "40",
    lastSequence: "45",
    evidenceSequence: record.evidenceSequence,
    recordId,
    recordType,
    schemaName: record.schemaName,
    schemaVersion: record.schemaVersion,
    sourceSystem: record.sourceSystem,
    sourceTable: record.sourceTable,
    sourceRevision: record.sourceRevision,
    userScopeId: record.userScopeId,
    projectId: record.projectId,
    environment: record.environment,
    taskId: record.taskId,
    contextId: record.contextId,
    episodeId: record.episodeId,
    runId: record.runId,
    goalId: record.goalId,
    goalVersion: record.goalVersion,
    planId: record.planId,
    planVersion: record.planVersion,
    skillExecutionId: record.skillExecutionId,
    capabilityBindingId: record.capabilityBindingId,
    remoteTaskBindingId: record.remoteTaskBindingId,
    causationId: record.causationId,
    recordedAt: record.recordedAt,
    deliveryGuarantee: record.deliveryGuarantee,
    evaluationRole: record.evaluationRole,
    observationGeneration: record.observationGeneration,
    evidenceRefs: record.evidenceRefs,
    artifactRefs: record.artifactRefs,
    evidenceRecord: record,
    walPartition: "source-0",
    walOffset: 101,
    walWrittenAt: "2026-08-14T02:00:02.000Z",
    walPayloadHash: `sha256:${"9".repeat(64)}`,
    receivedAt: "2026-08-14T02:00:03.000Z",
  };
}

function legacyFact(recordFamily: string): CanonicalFact {
  return {
    factId: "legacy-fact-1",
    sourceId: "legacy-source",
    sourceType: "sdar-v1.4-node-control",
    sourceRecordId: "legacy-record-1",
    recordFamily,
    tenantId: "tenant-1",
    occurredAt: "2026-08-14T02:00:00.000Z",
    ingestedAt: "2026-08-14T02:00:01.000Z",
    payload: {legacy: true},
    payloadHash: "legacy-hash",
    projectionVersion: "1.0.0",
  };
}

function ddlColumns(ddl: string, table: string): string[] {
  const marker = `CREATE TABLE IF NOT EXISTS ${table}`;
  const tableStart = ddl.indexOf(marker);
  assert.notEqual(tableStart, -1, table);
  const bodyStart = ddl.indexOf("(", tableStart);
  const bodyEnd = ddl.indexOf("\n)", bodyStart);
  assert.notEqual(bodyStart, -1, table);
  assert.notEqual(bodyEnd, -1, table);
  return ddl
    .slice(bodyStart + 1, bodyEnd)
    .split("\n")
    .map((line) => /^\s*([a-z][a-z0-9_]*)\s+/u.exec(line)?.[1])
    .filter((column): column is string => column !== undefined);
}

function only<T>(values: readonly T[]): T {
  assert.equal(values.length, 1);
  return values[0] as T;
}
