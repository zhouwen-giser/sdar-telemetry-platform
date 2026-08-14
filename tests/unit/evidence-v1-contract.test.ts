import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  EVIDENCE_V1_ERROR_CODES,
  canonicalizeEvidenceJson,
  hashCanonicalEvidenceJson,
  loadEvidenceV1Validator,
} from "../../packages/telemetry-contracts/src/index.js";
import type { EvidenceV1BatchRequest } from "../../packages/telemetry-types/src/index.js";

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

test("loads and compiles the complete 100-record sdar.evidence/v1 registry", async () => {
  const validator = await loadEvidenceV1Validator(schemaRoot);
  const registry = JSON.parse(await readFile(path.join(schemaRoot, "registry.json"), "utf8")) as {
    records: { recordType: string }[];
  };

  assert.equal(validator.recordSchemaCount, 100);
  assert.equal(validator.recordTypes.length, 100);
  assert.equal(new Set(validator.recordTypes).size, 100);
  for (const record of registry.records) assert.equal(validator.recognizesRecordType(record.recordType), true);
  assert.equal(validator.recognizesRecordType("legacy.task_started"), false);
});

test("accepts the imported deterministic runtime batch fixture", async () => {
  const validator = await loadEvidenceV1Validator(schemaRoot);
  const fixture = await validFixture();

  assert.equal(validator.assertBatch(fixture), fixture);
});

test("canonical Evidence JSON is stable for field order, Unicode, nested objects and arrays", () => {
  const first = {
    unicode: "遥测-🙂-e\u0301",
    nested: { z: [{ beta: 2, alpha: 1 }, true, null], a: -0 },
  };
  const second = {
    nested: { a: 0, z: [{ alpha: 1, beta: 2 }, true, null] },
    unicode: "遥测-🙂-e\u0301",
  };

  assert.equal(canonicalizeEvidenceJson(first), canonicalizeEvidenceJson(second));
  assert.equal(hashCanonicalEvidenceJson(first), hashCanonicalEvidenceJson(second));
  assert.match(hashCanonicalEvidenceJson(first), /^sha256:[0-9a-f]{64}$/u);
});

test("field insertion order does not invalidate the runtime batch hash", async () => {
  const validator = await loadEvidenceV1Validator(schemaRoot);
  const fixture = await validFixture();
  const reordered = reverseObjects(fixture) as EvidenceV1BatchRequest;

  assert.equal(reordered.batchHash, fixture.batchHash);
  assert.equal(validator.assertBatch(reordered), reordered);
});

test("rejects batch, payload and record identity hash mismatches with stable codes", async () => {
  const validator = await loadEvidenceV1Validator(schemaRoot);
  const fixture = await validFixture();

  const invalidBatch = clone(fixture);
  invalidBatch.batchHash = `sha256:${"0".repeat(64)}`;
  throwsCode(() => validator.assertBatch(invalidBatch), EVIDENCE_V1_ERROR_CODES.batchHashInvalid);

  const invalidPayload = clone(fixture);
  (invalidPayload.records[0].payload as Record<string, unknown>)["status"] = "tampered";
  resign(invalidPayload);
  throwsCode(() => validator.assertBatch(invalidPayload), EVIDENCE_V1_ERROR_CODES.payloadHashInvalid);

  const invalidRecordId = clone(fixture);
  invalidRecordId.records[0].sourceRevision = `${invalidRecordId.records[0].sourceRevision}-changed`;
  resign(invalidRecordId);
  throwsCode(() => validator.assertBatch(invalidRecordId), EVIDENCE_V1_ERROR_CODES.recordIdInvalid);
});

test("requires canonical, unique, strictly increasing record sequences and exact boundaries", async () => {
  const validator = await loadEvidenceV1Validator(schemaRoot);
  const fixture = await validFixture();

  const duplicate = clone(fixture);
  duplicate.records[1].evidenceSequence = duplicate.records[0].evidenceSequence;
  duplicate.lastSequence = duplicate.records[1].evidenceSequence;
  resign(duplicate);
  throwsCode(() => validator.assertBatch(duplicate), EVIDENCE_V1_ERROR_CODES.sequenceInvalid);

  const nonCanonical = clone(fixture);
  nonCanonical.records[0].evidenceSequence = "01";
  nonCanonical.firstSequence = "01";
  resign(nonCanonical);
  throwsCode(() => validator.assertBatch(nonCanonical), EVIDENCE_V1_ERROR_CODES.schemaInvalid);

  const wrongBoundary = clone(fixture);
  wrongBoundary.lastSequence = "3";
  resign(wrongBoundary);
  throwsCode(() => validator.assertBatch(wrongBoundary), EVIDENCE_V1_ERROR_CODES.sequenceInvalid);

  const legitimateGap = clone(fixture);
  legitimateGap.records[1].evidenceSequence = "10";
  legitimateGap.lastSequence = "10";
  resign(legitimateGap);
  assert.equal(validator.assertBatch(legitimateGap), legitimateGap);
});

test("canonicalization enforces plain JSON and Runtime forbidden-field policy", () => {
  assert.throws(
    () => canonicalizeEvidenceJson({ Authorization: "Bearer inline" }),
    (error: any) => error?.code === "EVIDENCE_FORBIDDEN_FIELD",
  );
  assert.doesNotThrow(() => canonicalizeEvidenceJson({ credentialRef: "secret://sink" }));
  assert.doesNotThrow(() => canonicalizeEvidenceJson({ secretStatus: "available" }));
  assert.throws(
    () => canonicalizeEvidenceJson(new (class NonJson { value = 1; })()),
    (error: any) => error?.code === "EVIDENCE_JSON_VALUE_INVALID",
  );
});

async function validFixture(): Promise<MutableBatch> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as MutableBatch;
}

type MutableBatch = {
  -readonly [K in keyof EvidenceV1BatchRequest]: K extends "records"
    ? Array<{
        -readonly [R in keyof EvidenceV1BatchRequest["records"][number]]: EvidenceV1BatchRequest["records"][number][R];
      }>
    : EvidenceV1BatchRequest[K];
};

function clone(batch: MutableBatch): MutableBatch {
  return JSON.parse(JSON.stringify(batch)) as MutableBatch;
}

function resign(batch: MutableBatch): void {
  const { batchHash: _ignored, ...unsigned } = batch;
  batch.batchHash = hashCanonicalEvidenceJson(unsigned);
}

function reverseObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjects);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).reverse();
  return Object.fromEntries(entries.map(([key, item]) => [key, reverseObjects(item)]));
}

function throwsCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: any) => error?.code === code);
}
