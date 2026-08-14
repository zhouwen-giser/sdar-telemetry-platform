import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertIntegrationRunId,
  assertTraceRows,
  createSdarE2eEvidenceReport,
  deriveEvidenceBatch,
  evidenceBatchMetadata,
} from "../../scripts/run-sdar-e2e.js";
import {
  canonicalizeEvidenceJson,
  createEvidenceRecordId,
  hashCanonicalEvidenceJson,
  loadEvidenceV1Validator,
} from "../../packages/telemetry-contracts/src/index.js";
import type {
  EvidenceV1BatchRequest,
  EvidenceV1Record,
} from "../../packages/telemetry-types/src/index.js";

const runId = "codex_it_20260814_runtime123_telemetry456_unit";
const integrationRoot = path.join(
  process.cwd(),
  "integrations",
  "skill-driven-agent-runtime",
  "v1.4.1",
);
const fixturePath = path.join(
  integrationRoot,
  "reports",
  "v1.4.1-evidence",
  "clickhouse-handoff",
  "sample-batches",
  "valid-batch.json",
);
const validatorPromise = loadEvidenceV1Validator(path.join(integrationRoot, "schemas", "evidence", "v1"));

test("integration run IDs are explicit, bounded and path-safe", () => {
  assert.equal(assertIntegrationRunId(runId), runId);
  for (const invalid of [
    undefined,
    "",
    "not_codex_it",
    "codex_it_../escape",
    "codex_it_contains space",
    `codex_it_${"a".repeat(181)}`,
  ]) {
    assert.throws(() => assertIntegrationRunId(invalid), /SDAR_E2E_RUN_ID_INVALID/u);
  }
});

test("derives a valid unique batch while preserving the Runtime fixture payloads", async () => {
  const validator = await validatorPromise;
  const fixture = await loadFixture();
  const fixtureBefore = canonicalizeEvidenceJson(fixture);
  const derived = validator.assertBatch(deriveEvidenceBatch(fixture, runId));

  assert.equal(canonicalizeEvidenceJson(fixture), fixtureBefore, "fixture must not be mutated");
  assert.equal(derived.exportId, `${runId}:export`);
  assert.equal(derived.sourceId, `${runId}:source`);
  assert.equal(derived.nodeId, `${runId}:node`);
  assert.equal(derived.records.length, fixture.records.length);
  assert.equal(new Set(derived.records.map((record) => record.recordId)).size, derived.records.length);
  for (const [index, record] of derived.records.entries()) {
    const original = fixture.records[index] as EvidenceV1Record;
    assert.equal(record.runId, runId);
    assert.equal(record.taskId, `${runId}:task:${String(index + 1)}`);
    assert.equal(record.episodeId, `${runId}:episode:${String(index + 1)}`);
    assert.equal(record.nodeId, `${runId}:node`);
    assert.equal(record.correlationId, `${runId}:correlation:${String(index + 1)}`);
    assert.notEqual(record.sourceRecordId, original.sourceRecordId);
    assert.notEqual(record.sourceRevision, original.sourceRevision);
    assert.equal(record.recordId, createEvidenceRecordId(record));
    assert.equal(record.payloadHash, original.payloadHash);
    assert.equal(
      canonicalizeEvidenceJson(record.payload),
      canonicalizeEvidenceJson(original.payload),
      "the harness must not synthesize or rewrite Runtime payload facts",
    );
  }
  const { batchHash: _ignored, ...unsigned } = derived;
  assert.equal(derived.batchHash, hashCanonicalEvidenceJson(unsigned));
});

test("trace validation requires exact record IDs, hashes and durable lineage", async () => {
  const fixture = await loadFixture();
  const batch = deriveEvidenceBatch(fixture, runId);
  const wal = { partition: "c".repeat(64), payloadHash: "d".repeat(64) };
  const rows = batch.records.map((record) => projectedRow(batch, record, wal));
  const summary = assertTraceRows(batch, rows, wal);
  assert.equal(summary.rowCount, batch.records.length);
  assert.deepEqual(summary.recordIds, batch.records.map((record) => record.recordId).sort());

  const corrupted = rows.map((row) => ({ ...row }));
  corrupted[0]!["payload_hash"] = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => assertTraceRows(batch, corrupted, wal),
    /SDAR_E2E_TRACE_LINEAGE_MISMATCH/u,
  );
});

test("evidence metadata is payload-free, secret-free and records replay stability", async () => {
  const fixture = await loadFixture();
  const batch = deriveEvidenceBatch(fixture, runId);
  const wal = { partition: "c".repeat(64), payloadHash: "d".repeat(64) };
  const trace = assertTraceRows(
    batch,
    batch.records.map((record) => projectedRow(batch, record, wal)),
    wal,
  );
  const report = createSdarE2eEvidenceReport({
    runId,
    generatedAt: "2026-08-14T06:00:00.000Z",
    fixtureSha256: "e".repeat(64),
    fixture,
    batch,
    tableEngine: "ReplacingMergeTree",
    gateway: {
      headStatus: 204,
      postStatus: 202,
      acknowledgement: { lastAcknowledgedSequence: batch.lastSequence },
      restartPostStatus: 202,
      restartAcknowledgement: { lastAcknowledgedSequence: batch.lastSequence },
    },
    wal: {
      partition: wal.partition,
      bytesAfterPost: 4096,
      bytesAfterRestartDuplicate: 4096,
      frameCount: 1,
      payloadHash: wal.payloadHash,
    },
    worker: {
      initial: { partitionsVisited: 1, framesCompleted: 1, writesCompleted: 1 },
      replayFromFreshState: { partitionsVisited: 1, framesCompleted: 1, writesCompleted: 1 },
    },
    clickHouseOutage: {
      targetHost: "192.168.1.7",
      unreachablePort: 1,
      unauthenticatedPortPreflight: "unreachable",
      connectionErrorCode: "CLICKHOUSE_REQUEST_FAILED",
      checkpointBeforeFailure: -1,
      checkpointAfterFailure: -1,
      walFramesBeforeFailure: 1,
      walFramesAfterFailure: 1,
      walBytesBeforeFailure: 4096,
      walBytesAfterFailure: 4096,
      recovery: { partitionsVisited: 1, framesCompleted: 1, writesCompleted: 1 },
      checkpointAfterRecovery: 0,
    },
    workerProcessCrash: {
      isolation: "independent-os-process",
      injectedTermination: "SIGKILL",
      exitCode: null,
      signal: "SIGKILL",
      checkpointBeforeRestart: -1,
      completedWritesBeforeCrash: 1,
      pendingTableAtCrash: "sdar_core.b_projection",
      restartWrites: 1,
      resumedTables: ["sdar_core.b_projection"],
      checkpointAfterRestart: 0,
      persistedTables: ["sdar_core.a_projection", "sdar_core.b_projection"],
      stablePendingWriteIdentity: true,
      stableRecordIdentity: true,
      skippedCompletedProjectionOnRestart: true,
    },
    query: {
      watermarkBeforeReplay: "2026-08-14T06:00:00.000Z",
      watermarkAfterReplay: "2026-08-14T06:00:00.000Z",
      beforeReplay: trace,
      afterReplay: trace,
    },
  });

  assert.equal(report["status"], "passed");
  assert.equal(report["schemaVersion"], 2);
  assert.equal(hasForbiddenMetadataKey(report), false);
  assert.equal(JSON.stringify(report).includes("test-bearer-credential"), false);
  const metadata = evidenceBatchMetadata(batch) as unknown as Record<string, unknown>;
  assert.equal(Object.hasOwn(metadata, "payload"), false);
  assert.equal(JSON.stringify(metadata).includes(JSON.stringify(batch.records[0]?.payload)), false);
  const checks = report["checks"] as Record<string, unknown>;
  assert.equal(Object.values(checks).every((value) => value === true), true);
});

async function loadFixture(): Promise<EvidenceV1BatchRequest> {
  const value = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
  return (await validatorPromise).assertBatch(value);
}

function projectedRow(
  batch: EvidenceV1BatchRequest,
  record: EvidenceV1Record,
  wal: Readonly<{ partition: string; payloadHash: string }>,
): Record<string, unknown> {
  return {
    row_id: createHash("sha256").update(record.recordId).digest("hex"),
    fact_id: record.recordId,
    contract_version: batch.contractVersion,
    export_id: batch.exportId,
    export_revision: batch.revision,
    source_id: batch.sourceId,
    source_type: "sdar-evidence-v1",
    batch_node_id: batch.nodeId,
    batch_hash: batch.batchHash,
    first_sequence: batch.firstSequence,
    last_sequence: batch.lastSequence,
    evidence_sequence: record.evidenceSequence,
    record_id: record.recordId,
    payload_hash: record.payloadHash,
    source_record_id: record.sourceRecordId,
    source_revision: record.sourceRevision,
    task_id: record.taskId ?? null,
    episode_id: record.episodeId ?? null,
    run_id: record.runId ?? null,
    node_id: record.nodeId ?? null,
    correlation_id: record.correlationId,
    wal_partition: wal.partition,
    wal_offset: 0,
    wal_payload_hash: wal.payloadHash,
    payload_json: JSON.stringify(record.payload),
    record_json: JSON.stringify(record),
  };
}

function hasForbiddenMetadataKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenMetadataKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, candidate]) =>
      /(?:password|secret|credential|authorization|bearer|token)/iu.test(key) ||
      hasForbiddenMetadataKey(candidate),
  );
}
