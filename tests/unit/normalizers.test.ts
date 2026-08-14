import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEvidenceV1Validator } from "../../packages/telemetry-contracts/src/index.js";
import { normalizeBatch } from "../../packages/telemetry-normalizers/src/index.js";
import type {
  EvidenceBatch,
  EvidenceV1BatchRequest,
  EvidenceV1WalPayload,
} from "../../packages/telemetry-types/src/index.js";

const integrationRoot = path.join(
  process.cwd(),
  "integrations",
  "skill-driven-agent-runtime",
  "v1.4.1",
);
const schemaRoot = path.join(integrationRoot, "schemas", "evidence", "v1");
const fixturePath = path.join(
  integrationRoot,
  "reports",
  "v1.4.1-evidence",
  "clickhouse-handoff",
  "sample-batches",
  "valid-batch.json",
);

test("normalizes an Evidence v1 batch with stable identity and lossless lineage", async () => {
  const validator = await loadEvidenceV1Validator(schemaRoot);
  const candidate = JSON.parse(await readFile(fixturePath, "utf8"));
  const batch = validator.assertBatch(candidate);
  const context = {
    receivedAt: "2026-08-14T01:02:03.000Z",
    walPartition: "sdar-v1-deadbeef",
    walOffset: 42,
    walWrittenAt: "2026-08-14T01:02:03.001Z",
    walPayloadHash: "sha256:wal-frame",
  };

  const facts = normalizeBatch(batch, context);
  assert.equal(facts.length, batch.records.length);
  const fact = facts[0];
  const record = batch.records[0];
  assert.ok(fact);
  assert.ok(record);
  assert.equal(fact.factId, record.recordId);
  assert.equal(fact.sourceType, "sdar-evidence-v1");
  assert.equal(fact.contractVersion, "sdar.evidence/v1");
  assert.equal(fact.exportId, batch.exportId);
  assert.equal(fact.batchNodeId, batch.nodeId);
  assert.equal(fact.exportRevision, batch.revision);
  assert.equal(fact.batchHash, batch.batchHash);
  assert.equal(fact.recordId, record.recordId);
  assert.equal(fact.recordType, record.recordType);
  assert.equal(fact.evidenceSequence, record.evidenceSequence);
  assert.equal(fact.payloadHash, record.payloadHash);
  assert.strictEqual(fact.payload, record.payload);
  assert.strictEqual(fact.evidenceRecord, record);
  assert.equal(fact.walPartition, context.walPartition);
  assert.equal(fact.walOffset, context.walOffset);
  assert.equal(fact.receivedAt, context.receivedAt);

  assert.deepEqual(normalizeBatch(batch, context), facts);
});

test("normalizes an EvidenceV1WalPayload and keeps its durable receive time", async () => {
  const batch = await fixture();
  const payload: EvidenceV1WalPayload = {
    kind: "sdar-evidence-v1",
    receivedAt: "2026-08-14T02:03:04.000Z",
    batch,
  };

  const [fact] = normalizeBatch(payload, { walPartition: "partition-1", walOffset: 7 });
  assert.ok(fact);
  assert.equal(fact.ingestedAt, payload.receivedAt);
  assert.equal(fact.receivedAt, payload.receivedAt);
  assert.equal(fact.walPartition, "partition-1");
  assert.equal(fact.walOffset, 7);
  assert.strictEqual(fact.evidenceRecord, batch.records[0]);
});

test("keeps legacy normalization usable while making retry identity stable", () => {
  const legacy: EvidenceBatch = {
    schemaVersion: "1.0",
    sourceId: "legacy-source",
    sourceType: "sdar-v1.3-outbox",
    batchId: "attempt-only-batch-id",
    records: [
      {
        sourceRecordId: "record-1",
        recordFamily: "sdar.runtime.task",
        occurredAt: "2026-08-14T03:04:05.000Z",
        tenantId: "tenant-1",
        payload: { status: "completed" },
      },
    ],
  };
  const context = { receivedAt: "2026-08-14T03:04:06.000Z" };

  const first = normalizeBatch(legacy, context);
  const retry = normalizeBatch({ ...legacy, batchId: "different-retry-batch-id" }, context);
  assert.equal(first[0]?.factId, retry[0]?.factId);
  assert.deepEqual(first, retry);
  assert.equal(first[0]?.sourceType, "sdar-v1.3-outbox");
});

async function fixture(): Promise<EvidenceV1BatchRequest> {
  const validator = await loadEvidenceV1Validator(schemaRoot);
  return validator.assertBatch(JSON.parse(await readFile(fixturePath, "utf8")));
}
