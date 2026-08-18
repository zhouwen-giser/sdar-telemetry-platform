import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  DOMAIN_PROJECTION_CONTRACT_ERROR_CODES,
  DOMAIN_PROJECTION_MAX_ARRAY_ITEMS,
  DOMAIN_PROJECTION_MAX_CANONICAL_BYTES,
  DOMAIN_PROJECTION_MAX_JSON_DEPTH,
  DOMAIN_PROJECTION_MAX_OBJECT_FIELDS,
  DOMAIN_PROJECTION_TARGET_TABLES,
  PROJECTION_FAILURE_CLASS_BY_CODE,
  PROJECTION_FAILURE_CODES,
  canonicalizeDomainProjectionJson,
  createDomainProjectionDefinitionHash,
  createDomainProjectionSetHash,
  hashCanonicalDomainProjectionJson,
  loadDomainProjectionContractValidator,
  type DomainProjectionContractKind,
  type DomainProjectionContractValidator,
  type DomainProjectionDefinition,
  type DomainProjectionSet,
  type DomainProjectionSetUnsigned,
  type ProjectionCheckpoint,
  type ProjectionDeadLetter,
  type ProjectionFailureCode,
  type ProjectionLineage,
} from "../../packages/telemetry-contracts/src/index.js";

const contractRoot = path.join(
  process.cwd(),
  "integrations",
  "domain-projection",
  "contracts",
  "v1",
);
const fixtureRoot = path.join(contractRoot, "fixtures");
const validatorPromise = loadDomainProjectionContractValidator(path.join(contractRoot, "schemas"));

interface FixtureManifest {
  readonly contractVersion: string;
  readonly cases: readonly FixtureCase[];
}

interface FixtureCase {
  readonly path: string;
  readonly kind: DomainProjectionContractKind;
  readonly valid: boolean;
}

test("domain projection fixture manifest covers every frozen contract and rejects every invalid fixture", async () => {
  const validator = await validatorPromise;
  const manifest = await readJson<FixtureManifest>(path.join(fixtureRoot, "manifest.json"));
  const paths = manifest.cases.map((fixture) => fixture.path);
  const kinds = new Set(manifest.cases.map((fixture) => fixture.kind));

  assert.equal(manifest.contractVersion, validator.contractVersion);
  assert.equal(new Set(paths).size, paths.length, "fixture manifest paths must be unique");
  assert.deepEqual(
    [...kinds].sort(),
    ["checkpoint", "deadLetter", "definition", "lineage", "projectionSet"],
  );
  assert.ok(manifest.cases.every((fixture) => !path.isAbsolute(fixture.path)));

  for (const fixture of manifest.cases) {
    const value = await readJson(path.join(fixtureRoot, fixture.path));
    const before = structuredClone(value);
    if (fixture.valid) {
      const result = assertContract(validator, fixture.kind, value);
      assert.deepEqual(result, value, fixture.path);
      assertDeepFrozen(result, fixture.path);
    } else {
      assert.throws(
        () => assertContract(validator, fixture.kind, value),
        isDomainProjectionContractError,
        fixture.path,
      );
    }
    assert.deepEqual(value, before, `${fixture.path} must not be mutated by validation`);
  }
});

test("assertDefinition returns an independent deeply frozen clone and leaves caller input mutable", async () => {
  const validator = await validatorPromise;
  const caller = await validDefinitionInput();
  const before = structuredClone(caller);
  const result = validator.assertDefinition(caller);

  assert.notEqual(result, caller);
  assert.notEqual(result.source, caller.source);
  assert.notEqual(result.target, caller.target);
  assert.notEqual(result.cursorPolicy, caller.cursorPolicy);
  assert.notEqual(result.cursorPolicy.fields, caller.cursorPolicy.fields);
  assert.notEqual(
    result.cursorPolicy.uniqueTieBreakerFields,
    caller.cursorPolicy.uniqueTieBreakerFields,
  );
  assert.deepEqual(result, caller);
  assertDeepFrozen(result);

  assert.equal(Object.isFrozen(caller), false);
  assert.equal(Object.isFrozen(caller.source), false);
  assert.equal(Object.isFrozen(caller.cursorPolicy.fields), false);
  assert.deepEqual(caller, before);

  assert.throws(() => {
    (result as unknown as { enabled: boolean }).enabled = false;
  }, TypeError);
  assert.throws(() => {
    (result.cursorPolicy.fields as unknown as string[]).push("late_mutation");
  }, TypeError);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.cursorPolicy.fields, before.cursorPolicy.fields);

  caller.enabled = false;
  caller.cursorPolicy.fields.push("caller_remains_mutable");
  assert.equal(caller.enabled, false);
  assert.equal(result.enabled, true);
  assert.equal(result.cursorPolicy.fields.includes("caller_remains_mutable"), false);
});

test("canonical projection JSON has a frozen golden representation and field-order-independent hash", () => {
  const first = {
    z: [3, { "β": "遥测", a: -0 }],
    a: { y: true, x: null },
  };
  const reordered = {
    a: { x: null, y: true },
    z: [3, { a: 0, "β": "遥测" }],
  };
  const golden = '{"a":{"x":null,"y":true},"z":[3,{"a":0,"β":"遥测"}]}';
  const goldenHash =
    "sha256:e0123eede64cf0ca9a4a1eb0b1c318588f589950ffd39d2c719fcf1f7a754166";

  assert.equal(canonicalizeDomainProjectionJson(first), golden);
  assert.equal(canonicalizeDomainProjectionJson(reordered), golden);
  assert.equal(hashCanonicalDomainProjectionJson(first), goldenHash);
  assert.equal(hashCanonicalDomainProjectionJson(reordered), goldenHash);
  assert.notEqual(
    hashCanonicalDomainProjectionJson({ ...reordered, z: [...reordered.z].reverse() }),
    goldenHash,
    "array order is semantic and must affect the hash",
  );
  assert.equal(canonicalizeDomainProjectionJson(-0), "0");
});

test("canonical projection JSON enforces byte, depth, array and object boundaries", () => {
  const emptyDataBytes = Buffer.byteLength('{"data":""}', "utf8");
  const atByteLimit = { data: "x".repeat(DOMAIN_PROJECTION_MAX_CANONICAL_BYTES - emptyDataBytes) };
  assert.equal(
    Buffer.byteLength(canonicalizeDomainProjectionJson(atByteLimit), "utf8"),
    DOMAIN_PROJECTION_MAX_CANONICAL_BYTES,
  );
  throwsCode(
    () => canonicalizeDomainProjectionJson({ data: `${atByteLimit.data}x` }),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.finiteJsonRequired,
  );

  assert.doesNotThrow(() => canonicalizeDomainProjectionJson(nestedArrays(DOMAIN_PROJECTION_MAX_JSON_DEPTH)));
  throwsCode(
    () => canonicalizeDomainProjectionJson(nestedArrays(DOMAIN_PROJECTION_MAX_JSON_DEPTH + 1)),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.finiteJsonRequired,
  );

  assert.doesNotThrow(() =>
    canonicalizeDomainProjectionJson(Array.from({ length: DOMAIN_PROJECTION_MAX_ARRAY_ITEMS }, () => null)),
  );
  throwsCode(
    () =>
      canonicalizeDomainProjectionJson(
        Array.from({ length: DOMAIN_PROJECTION_MAX_ARRAY_ITEMS + 1 }, () => null),
      ),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.finiteJsonRequired,
  );

  assert.doesNotThrow(() =>
    canonicalizeDomainProjectionJson(numberedObject(DOMAIN_PROJECTION_MAX_OBJECT_FIELDS)),
  );
  throwsCode(
    () => canonicalizeDomainProjectionJson(numberedObject(DOMAIN_PROJECTION_MAX_OBJECT_FIELDS + 1)),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.finiteJsonRequired,
  );
});

test("canonical projection JSON rejects cycles, non-JSON values and hostile object shapes without invoking getters", () => {
  const cycle: Record<string, unknown> = {};
  cycle["self"] = cycle;
  const invalidScalars: readonly unknown[] = [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1n,
    Symbol("not-json"),
    () => undefined,
  ];

  throwsFinite(() => canonicalizeDomainProjectionJson(cycle));
  for (const value of invalidScalars) throwsFinite(() => canonicalizeDomainProjectionJson(value));
  throwsFinite(() => canonicalizeDomainProjectionJson({ missing: undefined }));
  throwsFinite(() => canonicalizeDomainProjectionJson([undefined]));
  throwsFinite(() => canonicalizeDomainProjectionJson(new Date("2026-08-14T00:00:00Z")));
  throwsFinite(() => canonicalizeDomainProjectionJson(new Map([["a", 1]])));
  throwsFinite(() => canonicalizeDomainProjectionJson(new (class NonJson { value = 1; })()));

  const sparse = new Array<unknown>(1);
  throwsFinite(() => canonicalizeDomainProjectionJson(sparse));

  const arrayWithExtra = Object.assign([1], { extra: 2 });
  throwsFinite(() => canonicalizeDomainProjectionJson(arrayWithExtra));

  const arrayWithSymbol = [1];
  Object.defineProperty(arrayWithSymbol, Symbol("extra"), { enumerable: true, value: 2 });
  throwsFinite(() => canonicalizeDomainProjectionJson(arrayWithSymbol));

  let arrayGetterCalled = false;
  const arrayWithAccessor = [1];
  Object.defineProperty(arrayWithAccessor, "0", {
    enumerable: true,
    get() {
      arrayGetterCalled = true;
      return 2;
    },
  });
  throwsFinite(() => canonicalizeDomainProjectionJson(arrayWithAccessor));
  assert.equal(arrayGetterCalled, false, "contract inspection must never execute array accessors");

  const objectWithSymbol = { value: 1 };
  Object.defineProperty(objectWithSymbol, Symbol("extra"), { enumerable: true, value: 2 });
  throwsFinite(() => canonicalizeDomainProjectionJson(objectWithSymbol));

  const nonEnumerable: Record<string, unknown> = {};
  Object.defineProperty(nonEnumerable, "hidden", { enumerable: false, value: 1 });
  throwsFinite(() => canonicalizeDomainProjectionJson(nonEnumerable));

  let getterCalled = false;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, "payload", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "executed";
    },
  });
  throwsFinite(() => canonicalizeDomainProjectionJson(accessor));
  assert.equal(getterCalled, false, "contract inspection must never execute caller accessors");

  let proxyTrapCalled = false;
  const proxy = new Proxy(
    { value: 1 },
    {
      ownKeys() {
        proxyTrapCalled = true;
        throw new Error("untrusted proxy trap");
      },
    },
  );
  throwsFinite(() => canonicalizeDomainProjectionJson(proxy));
  assert.equal(proxyTrapCalled, false, "contract inspection must reject a Proxy before any trap");
});

test("executable-code-like keys are rejected recursively with a stable error code", () => {
  for (const value of [
    { code: "return source" },
    { nested: { "mapper-code": "return source" } },
    { nested: { source_code: "compiled" } },
    { nested: [{ SQL: "SELECT 1" }] },
  ]) {
    throwsCode(
      () => canonicalizeDomainProjectionJson(value),
      DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.executableFieldForbidden,
    );
  }
});

test("projection definitions freeze six targets, strict semantic versions and explicit unique tie breakers", async () => {
  const validator = await validatorPromise;
  const baseline = await validDefinitionInput();

  assert.equal(DOMAIN_PROJECTION_TARGET_TABLES.length, 6);
  for (const table of DOMAIN_PROJECTION_TARGET_TABLES) {
    const value = clone(baseline);
    value.target.table = table;
    assert.equal(validator.assertDefinition(value).target.table, table);
  }
  for (const sourceDatabase of ["sdar_commander", "sdar_npc"] as const) {
    const value = clone(baseline);
    value.source.database = sourceDatabase;
    assert.equal(validator.assertDefinition(value).source.database, sourceDatabase);
  }
  for (const invalidTarget of [
    { database: "sdar_core", table: "control_action" },
    { database: "sdar_embodied", table: "verification" },
    { database: "sdar_embodied", table: "sdar_embodied.control_action" },
  ]) {
    const value = clone(baseline) as unknown as Record<string, unknown>;
    value["target"] = invalidTarget;
    throwsSchema(() => validator.assertDefinition(value));
  }

  for (const validSemver of ["0.0.0", "1.0.0-alpha", "1.0.0-alpha.1+build.5"]) {
    const value = clone(baseline);
    value.mapperVersion = validSemver;
    assert.equal(validator.assertDefinition(value).mapperVersion, validSemver);
  }
  for (const invalidSemver of [
    "1.0",
    "01.0.0",
    "1.0.0-01",
    "1.0.0-alpha..1",
    "1.0.0-",
    "1.0.0+",
    "1.0.0+build..1",
  ]) {
    const value = clone(baseline);
    value.mapperVersion = invalidSemver;
    throwsSchema(() => validator.assertDefinition(value));
  }

  const missing = clone(baseline);
  delete (missing.cursorPolicy as { uniqueTieBreakerFields?: string[] }).uniqueTieBreakerFields;
  throwsSchema(() => validator.assertDefinition(missing));

  const empty = clone(baseline);
  empty.cursorPolicy.uniqueTieBreakerFields = [];
  throwsSchema(() => validator.assertDefinition(empty));

  const outside = clone(baseline);
  outside.cursorPolicy.uniqueTieBreakerFields = ["not_in_cursor"];
  throwsSchema(() => validator.assertDefinition(outside));

  const accepted = validator.assertDefinition(baseline);
  assert.ok(accepted.cursorPolicy.uniqueTieBreakerFields.length > 0);
  assert.ok(
    accepted.cursorPolicy.uniqueTieBreakerFields.every((field) =>
      accepted.cursorPolicy.fields.includes(field),
    ),
  );
  assert.equal(Object.isFrozen(accepted.cursorPolicy.uniqueTieBreakerFields), true);
});

test("checkpoint cursor is all-null or all-positioned and counters obey finite source accounting", async () => {
  const validator = await validatorPromise;
  const baseline = await validCheckpointInput();
  const cursorKeys = [
    "lastOccurredAt",
    "lastSourceRecordId",
    "lastSourceRevision",
  ] as const satisfies readonly (keyof ProjectionCheckpoint)[];
  const positioned = {
    lastOccurredAt: "2026-08-14T00:01:00.000Z",
    lastSourceRecordId: "source-record-1",
    lastSourceRevision: "1",
  } as const;

  for (let mask = 0; mask < 8; mask += 1) {
    const value = clone(baseline) as unknown as MutableCheckpoint;
    value.updatedAt = "2026-08-14T00:01:01.000Z";
    cursorKeys.forEach((key, index) => {
      value[key] = (mask & (1 << index)) === 0 ? null : positioned[key];
    });
    if (mask === 0 || mask === 7) assert.doesNotThrow(() => validator.assertCheckpoint(value));
    else throwsSchema(() => validator.assertCheckpoint(value));
  }

  for (const count of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const value = clone(baseline);
    value.processedSourceCount = count;
    throwsSchema(() => validator.assertCheckpoint(value));
  }

  const impossibleAccounting = clone(baseline);
  impossibleAccounting.processedSourceCount = 1;
  impossibleAccounting.skippedSourceCount = 1;
  impossibleAccounting.failedSourceCount = 1;
  throwsSchema(() => validator.assertCheckpoint(impossibleAccounting));

  const oneToMany = clone(baseline);
  oneToMany.processedSourceCount = 1;
  oneToMany.producedTargetCount = 3;
  assert.equal(validator.assertCheckpoint(oneToMany).producedTargetCount, 3);
});

test("all domain contract timestamps use strict real UTC dates and enforce semantic time order", async () => {
  const validator = await validatorPromise;
  const baseline = await validCheckpointInput();

  for (const validTimestamp of [
    "2026-08-14T00:00:00Z",
    "2026-08-14T00:00:00.1Z",
    "2026-08-14T00:00:00.123456789Z",
    "2024-02-29T23:59:59.999Z",
  ]) {
    const value = clone(baseline);
    value.updatedAt = validTimestamp;
    assert.equal(validator.assertCheckpoint(value).updatedAt, validTimestamp);
  }
  for (const invalidTimestamp of [
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-08-14 00:00:00Z",
    "2026-08-14T00:00:00+00:00",
    "2026-08-14T00:00:00",
  ]) {
    const value = clone(baseline);
    value.updatedAt = invalidTimestamp;
    throwsSchema(() => validator.assertCheckpoint(value));
  }

  const timestampOrder = clone(baseline);
  timestampOrder.lastOccurredAt = "2026-08-14T00:01:00.000Z";
  timestampOrder.lastSourceRecordId = "source-record-1";
  timestampOrder.lastSourceRevision = "1";
  timestampOrder.updatedAt = "2026-08-14T00:00:59.999Z";
  throwsCode(
    () => validator.assertCheckpoint(timestampOrder),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.timestampOrderInvalid,
  );
});

test("lineage requires deterministic identity, mapping rule and lowercase prefixed content hashes", async () => {
  const validator = await validatorPromise;
  const baseline = await validLineageInput();
  for (const required of ["lineageId", "mappingRuleId", "mappingRuleVersion"] as const) {
    const value = clone(baseline) as unknown as Record<string, unknown>;
    delete value[required];
    throwsSchema(() => validator.assertLineage(value));
  }
  for (const invalidHash of [
    "0".repeat(64),
    `sha256:${"0".repeat(63)}`,
    `sha256:${"0".repeat(65)}`,
    `sha256:${"A".repeat(64)}`,
  ]) {
    const value = clone(baseline);
    value.sourceContentHash = invalidHash;
    throwsSchema(() => validator.assertLineage(value));
  }
  for (const invalidSemver of ["1.0.0-01", "1.0.0-alpha..1"]) {
    const value = clone(baseline);
    value.mappingRuleVersion = invalidSemver;
    throwsSchema(() => validator.assertLineage(value));
  }
});

test("dead letters freeze failure taxonomy, conditional source identity and management-only terminal states", async () => {
  const validator = await validatorPromise;
  const baseline = await openDeadLetterInput();
  const taxonomyEntries = Object.entries(PROJECTION_FAILURE_CLASS_BY_CODE) as readonly (
    readonly [ProjectionFailureCode, ProjectionDeadLetter["failureClass"]]
  )[];

  assert.equal(taxonomyEntries.length, Object.keys(PROJECTION_FAILURE_CODES).length);
  for (const [failureCode, failureClass] of taxonomyEntries) {
    const value = clone(baseline);
    value.failureCode = failureCode;
    value.failureClass = failureClass;
    if (failureCode === PROJECTION_FAILURE_CODES.sourceIdentityMissing) {
      value.sourceRecordId = null;
      value.sourceRevision = null;
    } else if (failureCode === PROJECTION_FAILURE_CODES.sourceRevisionInvalid) {
      value.sourceRecordId = "known-source-record";
      value.sourceRevision = null;
    }
    const accepted = validator.assertDeadLetter(value);
    assert.equal(accepted.failureCode, failureCode);
    assert.equal(accepted.failureClass, failureClass);
  }

  const nullIdForUnrelatedFailure = clone(baseline);
  nullIdForUnrelatedFailure.sourceRecordId = null;
  throwsSchema(() => validator.assertDeadLetter(nullIdForUnrelatedFailure));
  const nullRevisionForUnrelatedFailure = clone(baseline);
  nullRevisionForUnrelatedFailure.sourceRevision = null;
  throwsSchema(() => validator.assertDeadLetter(nullRevisionForUnrelatedFailure));

  const wrongClass = clone(baseline);
  wrongClass.failureClass = "blocking";
  throwsSchema(() => validator.assertDeadLetter(wrongClass));

  const unknownCode = clone(baseline) as unknown as Record<string, unknown>;
  unknownCode["failureCode"] = "UNKNOWN_FAILURE";
  throwsSchema(() => validator.assertDeadLetter(unknownCode));

  const retrying = clone(baseline);
  retrying.status = "retrying";
  retrying.attemptCount = 2;
  assert.equal(validator.assertDeadLetter(retrying).status, "retrying");

  const ignored = clone(baseline);
  ignored.status = "ignored";
  ignored.resolution = {
    managementActionId: "management-action-ignore",
    action: "ignore",
    resolvedAt: "2026-08-14T00:03:00.000Z",
  };
  assert.equal(validator.assertDeadLetter(ignored).resolution?.action, "ignore");

  const resolved = clone(baseline);
  resolved.status = "resolved";
  resolved.resolution = {
    managementActionId: "management-action-resolve",
    action: "resolve",
    resolvedAt: "2026-08-14T00:03:00.000Z",
  };
  assert.equal(validator.assertDeadLetter(resolved).resolution?.action, "resolve");

  const ignoredWrongAction = clone(resolved);
  ignoredWrongAction.status = "ignored";
  throwsSchema(() => validator.assertDeadLetter(ignoredWrongAction));

  const resolvedWrongAction = clone(ignored);
  resolvedWrongAction.status = "resolved";
  throwsSchema(() => validator.assertDeadLetter(resolvedWrongAction));

  const openWithResolution = clone(ignored);
  openWithResolution.status = "open";
  throwsSchema(() => validator.assertDeadLetter(openWithResolution));

  for (const status of ["ignored", "resolved"] as const) {
    const missingResolution = clone(baseline) as unknown as Record<string, unknown>;
    missingResolution["status"] = status;
    throwsSchema(() => validator.assertDeadLetter(missingResolution));
  }
});

test("dead-letter failure and resolution timestamps are monotonic", async () => {
  const validator = await validatorPromise;
  const baseline = await openDeadLetterInput();

  const reversedFailure = clone(baseline);
  reversedFailure.firstFailedAt = "2026-08-14T00:03:00.000Z";
  reversedFailure.lastFailedAt = "2026-08-14T00:02:59.999Z";
  throwsCode(
    () => validator.assertDeadLetter(reversedFailure),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.timestampOrderInvalid,
  );

  const earlyResolution = clone(baseline);
  earlyResolution.status = "ignored";
  earlyResolution.resolution = {
    managementActionId: "management-action-early",
    action: "ignore",
    resolvedAt: "2026-08-14T00:01:59.999Z",
  };
  throwsCode(
    () => validator.assertDeadLetter(earlyResolution),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.timestampOrderInvalid,
  );
});

test("projection sets pin definition and mapper identity with deterministic ordering, uniqueness and hash", async () => {
  const validator = await validatorPromise;
  const definition = validator.assertDefinition(await validDefinitionInput());
  const baseline = await validProjectionSetInput();
  const accepted = validator.assertProjectionSet(baseline);

  assert.equal(accepted.projections[0]?.definitionHash, createDomainProjectionDefinitionHash(definition));
  assertDeepFrozen(accepted);

  const exactDuplicate = clone(baseline);
  exactDuplicate.projections[1] = clone(exactDuplicate.projections[0]!);
  throwsCode(
    () => validator.assertProjectionSet(resignProjectionSet(exactDuplicate)),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.projectionSetDuplicate,
  );

  const secondVersion = clone(baseline);
  secondVersion.projections[1] = {
    ...secondVersion.projections[0]!,
    projectionVersion: secondVersion.projections[0]!.projectionVersion + 1,
  };
  throwsCode(
    () => validator.assertProjectionSet(resignProjectionSet(secondVersion)),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.projectionSetDuplicate,
  );

  const reversed = clone(baseline);
  reversed.projections.reverse();
  reversed.projectionSetHash = createDomainProjectionSetHash(unsignedSet(reversed));
  throwsCode(
    () => validator.assertProjectionSet(reversed),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.projectionSetOrderInvalid,
  );

  const tampered = clone(baseline);
  tampered.projections[0]!.mapperVersion = "1.0.1";
  throwsCode(
    () => validator.assertProjectionSet(tampered),
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.projectionSetHashInvalid,
  );

  const invalidDefinitionHash = clone(baseline);
  invalidDefinitionHash.projections[0]!.definitionHash = "sha256:INVALID";
  throwsSchema(() => validator.assertProjectionSet(invalidDefinitionHash));

  const unsigned = unsignedSet(baseline);
  const reorderedUnsigned = {
    projections: unsigned.projections.map((entry) => ({
      definitionHash: entry.definitionHash,
      mapperVersion: entry.mapperVersion,
      mapperId: entry.mapperId,
      projectionVersion: entry.projectionVersion,
      projectionId: entry.projectionId,
    })),
    projectionSetVersion: unsigned.projectionSetVersion,
    projectionSetId: unsigned.projectionSetId,
    contractVersion: unsigned.contractVersion,
  } satisfies DomainProjectionSetUnsigned;
  assert.equal(createDomainProjectionSetHash(unsigned), createDomainProjectionSetHash(reorderedUnsigned));
  assert.deepEqual(baseline, await validProjectionSetInput(), "hash calculation must not sort caller arrays in place");
});

function assertContract(
  validator: DomainProjectionContractValidator,
  kind: DomainProjectionContractKind,
  value: unknown,
): unknown {
  switch (kind) {
    case "definition":
      return validator.assertDefinition(value);
    case "checkpoint":
      return validator.assertCheckpoint(value);
    case "lineage":
      return validator.assertLineage(value);
    case "deadLetter":
      return validator.assertDeadLetter(value);
    case "projectionSet":
      return validator.assertProjectionSet(value);
  }
}

type MutableDefinition = {
  -readonly [K in keyof DomainProjectionDefinition]: K extends "source" | "target" | "identityPolicy"
    ? { -readonly [P in keyof DomainProjectionDefinition[K]]: DomainProjectionDefinition[K][P] }
    : K extends "cursorPolicy"
      ? {
          -readonly [P in keyof DomainProjectionDefinition["cursorPolicy"]]: P extends
            | "fields"
            | "uniqueTieBreakerFields"
            ? string[]
            : DomainProjectionDefinition["cursorPolicy"][P];
        }
      : DomainProjectionDefinition[K];
};

type MutableCheckpoint = {
  -readonly [K in keyof ProjectionCheckpoint]: ProjectionCheckpoint[K];
};

type MutableLineage = {
  -readonly [K in keyof ProjectionLineage]: ProjectionLineage[K] extends string
    ? string
    : ProjectionLineage[K];
};

type MutableDeadLetter = {
  -readonly [K in keyof ProjectionDeadLetter]: K extends "resolution"
    ?
        | {
            -readonly [P in keyof NonNullable<ProjectionDeadLetter["resolution"]>]: NonNullable<
              ProjectionDeadLetter["resolution"]
            >[P];
          }
        | undefined
    : ProjectionDeadLetter[K];
};

type MutableProjectionSet = {
  -readonly [K in keyof DomainProjectionSet]: K extends "projections"
    ? Array<{
        -readonly [P in keyof DomainProjectionSet["projections"][number]]: DomainProjectionSet["projections"][number][P];
      }>
    : DomainProjectionSet[K];
};

async function validDefinitionInput(): Promise<MutableDefinition> {
  return readJson<MutableDefinition>(path.join(fixtureRoot, "valid/domain-projection-definition.json"));
}

async function validCheckpointInput(): Promise<MutableCheckpoint> {
  return readJson<MutableCheckpoint>(path.join(fixtureRoot, "valid/projection-checkpoint.json"));
}

async function validLineageInput(): Promise<MutableLineage> {
  return readJson<MutableLineage>(path.join(fixtureRoot, "valid/projection-lineage.json"));
}

async function openDeadLetterInput(): Promise<MutableDeadLetter> {
  const value = await readJson<MutableDeadLetter>(
    path.join(fixtureRoot, "valid/projection-dead-letter.json"),
  );
  value.status = "open";
  delete value.resolution;
  return value;
}

async function validProjectionSetInput(): Promise<MutableProjectionSet> {
  return readJson<MutableProjectionSet>(path.join(fixtureRoot, "valid/domain-projection-set.json"));
}

function unsignedSet(value: MutableProjectionSet): DomainProjectionSetUnsigned {
  const { projectionSetHash: _ignored, ...unsigned } = value;
  return unsigned as DomainProjectionSetUnsigned;
}

function resignProjectionSet(value: MutableProjectionSet): MutableProjectionSet {
  value.projectionSetHash = createDomainProjectionSetHash(unsignedSet(value));
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nestedArrays(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function numberedObject(size: number): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: size }, (_, index) => [`field_${String(index).padStart(3, "0")}`, index]),
  );
}

function assertDeepFrozen(value: unknown, message = "value"): void {
  const visited = new Set<object>();
  const visit = (current: unknown, currentPath: string): void => {
    if (typeof current !== "object" || current === null || visited.has(current)) return;
    visited.add(current);
    assert.equal(Object.isFrozen(current), true, `${currentPath} must be frozen`);
    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      visit(nested, `${currentPath}.${key}`);
    }
  };
  visit(value, message);
}

function throwsSchema(operation: () => unknown): void {
  throwsCode(operation, DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.schemaInvalid);
}

function throwsFinite(operation: () => unknown): void {
  throwsCode(operation, DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.finiteJsonRequired);
}

function throwsCode(operation: () => unknown, code: string): void {
  assert.throws(
    operation,
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === code,
  );
}

function isDomainProjectionContractError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "DomainProjectionContractError" &&
    "code" in error &&
    typeof error.code === "string"
  );
}

async function readJson<T = unknown>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
