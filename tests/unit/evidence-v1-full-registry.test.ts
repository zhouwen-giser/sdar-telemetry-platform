import assert from "node:assert/strict";
import test from "node:test";

import {
  EVIDENCE_V1_ERROR_CODES,
  EVIDENCE_V1_MAX_CANONICAL_BYTES,
  canonicalizeEvidenceJson,
  createEvidenceRecordId,
  hashCanonicalEvidenceJson,
  loadEvidenceV1Validator,
} from "../../packages/telemetry-contracts/src/index.js";
import type { EvidenceV1BatchRequest } from "../../packages/telemetry-types/src/index.js";
import { loadFrozenEvidenceFixtureCorpus } from "../helpers/frozen-evidence-fixtures.js";

test("E2E-18 validates one real canonical record for every frozen Evidence v1 type in one batch", async () => {
  const corpus = await loadFrozenEvidenceFixtureCorpus();
  const validator = await loadEvidenceV1Validator(corpus.schemaRoot);
  const batch = corpus.buildBatch();

  const validated = validator.assertBatch(batch);
  const actualTypes = validated.records.map((record) => record.recordType);
  const expectedTypes = corpus.registry.records.map((entry) => entry.recordType);
  const roleCounts = corpus.registry.records.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.evaluationRole] = (counts[entry.evaluationRole] ?? 0) + 1;
    return counts;
  }, {});

  assert.equal(validated.records.length, 100);
  assert.deepEqual(actualTypes, expectedTypes);
  assert.equal(new Set(actualTypes).size, 100);
  assert.deepEqual(roleCounts, { required: 95, diagnostic: 5 });
  assert.equal(validated.records.filter((record) => record.evaluationRole === "required").length, 95);
  assert.equal(validated.records.filter((record) => record.evaluationRole === "diagnostic").length, 5);
  for (const record of validated.records) {
    assert.equal(record.payloadHash, hashCanonicalEvidenceJson(record.payload));
    assert.equal(record.recordId, createEvidenceRecordId(record));
  }
  const { batchHash: _ignored, ...unsigned } = validated;
  assert.equal(validated.batchHash, hashCanonicalEvidenceJson(unsigned));
});

test("E2E-18 distinguishes the 1000-record request boundary from canonical object size", async () => {
  const corpus = await loadFrozenEvidenceFixtureCorpus();
  const validator = await loadEvidenceV1Validator(corpus.schemaRoot);
  const episode = corpus.registry.records.find((entry) => entry.recordType === "runtime.episode");
  assert.ok(episode);
  const records = Array.from({ length: 1_001 }, (_, index) => corpus.buildRecord(episode, index + 1));

  const atCountLimit = unsignedBatch(records.slice(0, 1_000));
  assert.throws(
    () => validator.assertBatch({ ...atCountLimit, batchHash: zeroHash() }),
    hasCode("EVIDENCE_JSON_SIZE_EXCEEDED"),
    "1000 records satisfy maxItems, then hit the independent canonical-object byte limit",
  );

  const beyondCountLimit = unsignedBatch(records);
  assert.throws(
    () => validator.assertBatch({ ...beyondCountLimit, batchHash: zeroHash() }),
    hasCode(EVIDENCE_V1_ERROR_CODES.schemaInvalid),
    "1001 records must fail batch-request maxItems before integrity hashing",
  );
});

test("E2E-18 accepts exactly 262144 canonical bytes and rejects one byte more", () => {
  const emptyObjectBytes = Buffer.byteLength('{"data":""}', "utf8");
  const atLimit = { data: "x".repeat(EVIDENCE_V1_MAX_CANONICAL_BYTES - emptyObjectBytes) };
  const canonical = canonicalizeEvidenceJson(atLimit);

  assert.equal(Buffer.byteLength(canonical, "utf8"), EVIDENCE_V1_MAX_CANONICAL_BYTES);
  assert.throws(
    () => canonicalizeEvidenceJson({ data: `${atLimit.data}x` }),
    hasCode("EVIDENCE_JSON_SIZE_EXCEEDED"),
  );
});

function unsignedBatch(records: EvidenceV1BatchRequest["records"]): Omit<EvidenceV1BatchRequest, "batchHash"> {
  const first = records[0];
  const last = records.at(-1);
  assert.ok(first);
  assert.ok(last);
  return {
    contractVersion: "sdar.evidence/v1",
    exportId: "fixture:boundary",
    sourceId: "fixture:source",
    nodeId: "fixture:node",
    revision: 1,
    firstSequence: first.evidenceSequence,
    lastSequence: last.evidenceSequence,
    records,
  };
}

function zeroHash(): `sha256:${string}` {
  return `sha256:${"0".repeat(64)}`;
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code;
}
