import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  DOMAIN_SOURCE_V1_CONTRACT,
  DOMAIN_SOURCE_V1_CONTRACT_IDS,
  DOMAIN_SOURCE_V1_ERROR_CODES,
  DomainSourceContractError,
  canonicalizeDomainSourceJson,
  createDomainSourceBatchHash,
  createDomainSourcePayloadHash,
  createDomainSourceRecordIdentityHash,
  hashCanonicalDomainSourceJson,
  loadDomainSourceV1Validator,
  type DomainSourceBatchRequest,
  type DomainSourceContractKind,
} from "../../packages/telemetry-contracts/src/index.js";

const contractRoot = path.join(
  process.cwd(),
  "integrations",
  "domain-source",
  "contracts",
  "v1",
);
const fixtureRoot = path.join(contractRoot, "fixtures");
const validatorPromise = loadDomainSourceV1Validator(path.join(contractRoot, "schemas"));

interface FixtureManifest {
  readonly contractVersion: string;
  readonly cases: readonly Readonly<{
    path: string;
    kind: DomainSourceContractKind;
    valid: boolean;
  }>[];
}

test("Domain Source v1 freezes exactly ten RC2 source contracts", async () => {
  const validator = await validatorPromise;
  assert.equal(validator.contractVersion, DOMAIN_SOURCE_V1_CONTRACT);
  assert.equal(validator.sourceContractIds.length, 10);
  assert.deepEqual(validator.sourceContractIds, DOMAIN_SOURCE_V1_CONTRACT_IDS);
  assert.ok(validator.sourceContractIds.every((id) => id.startsWith("sdar.domain-source/")));
  assert.ok(validator.sourceContractIds.every((id) => !id.includes("_source_v1")));
});

test("all Golden fixtures have the declared acceptance result and valid values are deep frozen clones", async () => {
  const validator = await validatorPromise;
  const manifest = await readJson<FixtureManifest>(path.join(fixtureRoot, "manifest.json"));
  assert.equal(manifest.contractVersion, DOMAIN_SOURCE_V1_CONTRACT);
  assert.equal(manifest.cases.length, 16);
  assert.deepEqual(
    [...new Set(manifest.cases.map((fixture) => fixture.kind))].sort(),
    ["batch", "batchAck", "seal", "sealAck"],
  );

  for (const fixture of manifest.cases) {
    const input = await readJson<unknown>(path.join(fixtureRoot, fixture.path));
    const before = structuredClone(input);
    if (fixture.valid) {
      const result = validator.assert(fixture.kind, input);
      assert.notEqual(result, input, fixture.path);
      assert.deepEqual(result, input, fixture.path);
      assertDeepFrozen(result, fixture.path);
    } else {
      assert.throws(
        () => validator.assert(fixture.kind, input),
        (error) => error instanceof DomainSourceContractError,
        fixture.path,
      );
    }
    assert.deepEqual(input, before, `${fixture.path} was mutated`);
  }
});

test("canonical payload and batch hashes are stable while array order remains semantic", () => {
  const first = { z: [{ beta: "遥测", alpha: 1 }], a: true };
  const reordered = { a: true, z: [{ alpha: 1, beta: "遥测" }] };
  assert.equal(canonicalizeDomainSourceJson(first), canonicalizeDomainSourceJson(reordered));
  assert.equal(hashCanonicalDomainSourceJson(first), hashCanonicalDomainSourceJson(reordered));
  assert.notEqual(hashCanonicalDomainSourceJson([1, 2]), hashCanonicalDomainSourceJson([2, 1]));
  assert.equal(createDomainSourcePayloadHash(first), hashCanonicalDomainSourceJson(first));
});

test("record identity excludes batch and payload but includes every frozen identity axis", async () => {
  const batch = await validCommanderBatch();
  const record = batch.records[0]!;
  const identity = createDomainSourceRecordIdentityHash(record);
  assert.equal(
    identity,
    createDomainSourceRecordIdentityHash({
      tenantId: record.tenantId,
      projectId: record.projectId,
      sourceContractId: record.sourceContractId,
      recordId: record.recordId,
      sourceRevision: record.sourceRevision,
    }),
  );
  assert.notEqual(identity, createDomainSourceRecordIdentityHash({ ...record, sourceRevision: "2" }));
  assert.notEqual(identity, createDomainSourceRecordIdentityHash({ ...record, projectId: "other" }));
});

test("semantic validation rejects UInt64 overflow and accepts sequence gaps", async () => {
  const validator = await validatorPromise;
  const batch = await validCommanderBatch();
  const records = batch.records.map((record, index) => ({
    ...record,
    sequence: index === 0 ? "100" : String(100 + index * 10),
  }));
  const unsigned = {
    ...batch,
    firstSequence: records[0]!.sequence,
    lastSequence: records.at(-1)!.sequence,
    records,
  };
  const { batchHash: _oldHash, ...unsignedWithoutHash } = unsigned;
  assert.doesNotThrow(() =>
    validator.assertBatch({
      ...unsignedWithoutHash,
      batchHash: createDomainSourceBatchHash(unsignedWithoutHash),
    }),
  );

  const overflowRecords = batch.records.map((record, index) =>
    index === 0 ? { ...record, sourceRevision: "18446744073709551616" } : record,
  );
  const overflowUnsigned = { ...batch, records: overflowRecords };
  const { batchHash: _overflowHash, ...overflowWithoutHash } = overflowUnsigned;
  assert.throws(
    () =>
      validator.assertBatch({
        ...overflowWithoutHash,
        batchHash: createDomainSourceBatchHash(overflowWithoutHash),
      }),
    (error) =>
      error instanceof DomainSourceContractError &&
      error.code === DOMAIN_SOURCE_V1_ERROR_CODES.sequenceInvalid,
  );
});

test("near-name aliases, arbitrary table fields, mixed applications, and hash tampering are rejected", async () => {
  const validator = await validatorPromise;
  const manifest = await readJson<FixtureManifest>(path.join(fixtureRoot, "manifest.json"));
  const adversarial = manifest.cases.filter((fixture) =>
    /near-name|arbitrary-table|mixed-application|tampered/u.test(fixture.path),
  );
  assert.equal(adversarial.length, 5);
  for (const fixture of adversarial) {
    const value = await readJson(path.join(fixtureRoot, fixture.path));
    assert.throws(() => validator.assert(fixture.kind, value), DomainSourceContractError);
  }
});

async function validCommanderBatch(): Promise<DomainSourceBatchRequest> {
  return readJson<DomainSourceBatchRequest>(
    path.join(fixtureRoot, "valid", "commander-five-records.batch.json"),
  );
}

async function readJson<T = unknown>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

function assertDeepFrozen(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null) return;
  assert.equal(Object.isFrozen(value), true, label);
  for (const nested of Object.values(value)) assertDeepFrozen(nested, label);
}
