import {createHash} from "node:crypto";
import {appendFile,cp,mkdtemp,readFile,rm,unlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultReleaseRoot,
  deriveDeclaredColumns,
  deriveExpectedObjects,
  loadReleasePackage,
  MIGRATION_SET_CONTENT_ADDRESS,
  ReleasePackageError,
  stableJson,
  writeOrCheckReleaseManifest,
} from "../../scripts/sync-clickhouse-schema-release.js";
import {
  CANONICAL_EVIDENCE_COLUMNS,
  CRITICAL_SEMANTIC_COLUMNS,
} from "../../scripts/verify-clickhouse-schema-release.js";

test("release package is the exact deterministic 24-file Decision V3 release", async () => {
  const release = await loadReleasePackage();
  assert.equal(release.migrations.length, 24);
  assert.deepEqual(
    release.manifest.migrations.map(({ordinal}) => ordinal),
    Array.from({length: 24}, (_, ordinal) => ordinal),
  );
  assert.deepEqual(Object.keys(release.manifest), [
    "schemaVersion",
    "releaseId",
    "releaseVersion",
    "installMode",
    "source",
    "requiredDatabases",
    "expectedObjects",
    "ledger",
    "migrations",
    "migrationSetContentAddress",
    "contentAddress",
  ]);
  assert.deepEqual(Object.keys(release.manifest.source), [
    "benchmarkCommit",
    "benchmarkManifestByteSha256",
    "baseRestorationOrdinals",
    "tailDirectCommitOrdinals",
    "productAppendOrdinal",
    "productAppendSourceCommit",
    "productAppendSourcePath",
    "productAppendSourceByteSha256",
    "developmentClosureOrdinal",
    "developmentClosureAuthority",
    "developmentClosureFile",
    "developmentClosureByteSha256",
  ]);
  for (const migration of release.manifest.migrations) {
    assert.deepEqual(Object.keys(migration), ["ordinal", "file", "bytes", "sha256", "provenance"]);
  }
  assert.equal(release.manifest.migrationSetContentAddress, MIGRATION_SET_CONTENT_ADDRESS);
  assert.equal(release.manifest.schemaVersion, "sdar-telemetry.clickhouse-schema-release/v3");
  assert.equal(
    release.manifest.releaseId,
    "sdar-clickhouse-schema/1.5.0-rc.3-development-domain-projection-v3",
  );
  assert.equal(release.manifest.releaseVersion, "1.5.0-rc.3+canonical-evidence.domain-projection.1");
  assert.deepEqual(release.manifest.expectedObjects, {physicalTables: 312,views: 121,total: 433});
  assert.deepEqual(release.manifest.migrations[22], {
    ordinal: 22,
    file: "22_sdar_evidence_v1_canonical.sql",
    bytes: 2338,
    sha256: "fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9",
    provenance:
      "exact-bytes-from-sdar-telemetry-a09f179e1a402c59a99f67e96167696c1d9590ae:migrations/clickhouse/014_sdar_evidence_v1_canonical.sql",
  });
  assert.deepEqual(release.manifest.migrations[23], {
    ordinal: 23,
    file: "23_domain_projection_health_development.sql",
    bytes: 4209,
    sha256: "35e89646a45e1a2e96c14b259a67044ad01b1670e87c890bff382f2a3b650867",
    provenance:
      "exact-rendering-of-DEC-G02-CLICKHOUSE-SCHEMA-RELEASE-BOOTSTRAP-V3.ordinal23.canonicalStatements",
  });
  assert.equal(JSON.stringify(release.manifest).includes("/home/"), false);
  assert.equal(JSON.stringify(release.manifest).includes("all.sql"), false);

  const unsigned = structuredClone(release.manifest) as unknown as {
    contentAddress: {algorithm: string; digest?: string};
  };
  delete unsigned.contentAddress.digest;
  const digest = `sha256:${createHash("sha256").update(stableJson(unsigned)).digest("hex")}`;
  assert.equal(release.manifest.contentAddress.digest, digest);
  assert.equal(
    digest,
    "sha256:4f2d19ad546576e07e6e0d37165286b21172f7fc15357fa89225ec83946fb9a5",
  );
  const manifestBytes = await readFile(resolve(defaultReleaseRoot(), "release-manifest.json"));
  assert.equal(
    createHash("sha256").update(manifestBytes).digest("hex"),
    "386b8aa189c5279226a7ceaa8a9af90774d5bd904df16e587df3a9f5d891e735",
  );
  assert.deepEqual(
    await readFile(resolve(defaultReleaseRoot(), "migrations/22_sdar_evidence_v1_canonical.sql")),
    await readFile(resolve(defaultReleaseRoot(), "../../../migrations/clickhouse/014_sdar_evidence_v1_canonical.sql")),
  );
  const v2Root = resolve(defaultReleaseRoot(), "../1.5.0-rc.3");
  for (const migration of release.migrations.slice(0, 23)) {
    assert.deepEqual(
      await readFile(resolve(defaultReleaseRoot(), "migrations", migration.file)),
      await readFile(resolve(v2Root, "migrations", migration.file)),
      migration.file,
    );
  }
  const developmentClosure = release.migrations[23]!;
  assert.equal(developmentClosure.statements.length, 3);
  assert.equal(Buffer.byteLength(developmentClosure.sql), 4209);
  assert.equal(createHash("sha256").update(developmentClosure.sql).digest("hex"), developmentClosure.sha256);

  const objects = deriveExpectedObjects(release);
  assert.deepEqual(
    {
      physicalTables: objects.filter(({kind}) => kind === "table").length,
      views: objects.filter(({kind}) => kind === "view").length,
      total: objects.length,
    },
    release.manifest.expectedObjects,
  );
  assert.equal(objects.some(({database,name}) => `${database}.${name}` === "sdar_mart.v_benchmark_release_gate"), false);
  assert.equal(objects.some(({database,name}) => `${database}.${name}` === "sdar_mart.v_benchmark_release_gate_v15"), true);

  const canonicalRelation = "sdar_core.sdar_evidence_v1_record";
  const targetRelations = new Set([
    canonicalRelation,
    ...CRITICAL_SEMANTIC_COLUMNS.map((identity) => identity.split(".").slice(0, 2).join(".")),
  ]);
  const derivedColumnIdentities = new Set(
    deriveDeclaredColumns(release, targetRelations).map(
      ({database,table,name}) => `${database}.${table}.${name}`,
    ),
  );
  for (const column of CANONICAL_EVIDENCE_COLUMNS) {
    assert.equal(derivedColumnIdentities.has(`${canonicalRelation}.${column}`), true, column);
  }
  for (const identity of CRITICAL_SEMANTIC_COLUMNS) {
    assert.equal(derivedColumnIdentities.has(identity), true, identity);
  }
});

test("release package check rejects missing base, altered bytes, extra files, source manifest, and address drift", async () => {
  await withFixture(async (root) => {
    await unlink(resolve(root, "migrations/00_create_databases.sql"));
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT");
  });
  await withFixture(async (root) => {
    await unlink(resolve(root, "migrations/22_sdar_evidence_v1_canonical.sql"));
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT");
  });
  await withFixture(async (root) => {
    await unlink(resolve(root, "migrations/23_domain_projection_health_development.sql"));
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT");
  });
  await withFixture(async (root) => {
    const path = resolve(root, "migrations/22_sdar_evidence_v1_canonical.sql");
    const sql = await readFile(path, "utf8");
    await writeFile(path, sql.replace("    row_id FixedString(64),\n", ""));
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT");
  });
  await withFixture(async (root) => {
    await appendFile(resolve(root, "migrations/17_sdar_v1_4_1_dataset_and_cross_chain.sql"), "\n-- drift\n");
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT");
  });
  await withFixture(async (root) => {
    await writeFile(resolve(root, "migrations/all.sql"), "SELECT 1;\n");
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT");
  });
  await withFixture(async (root) => {
    await writeFile(
      resolve(root, "release-manifest.json"),
      `${JSON.stringify({name: "sdar-clickhouse-schema",version: "1.5.0-rc.3",files: []}, null, 2)}\n`,
    );
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT");
  });
  await withFixture(async (root) => {
    const path = resolve(root, "release-manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {contentAddress: {digest: string}};
    manifest.contentAddress.digest = "sha256:" + "0".repeat(64);
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    await assertPackageError(root, "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT");
  });
});

async function withFixture(run: (root: string) => Promise<void>): Promise<void> {
  const temporary = await mkdtemp(resolve(tmpdir(), "sdar-clickhouse-release-test-"));
  const root = resolve(temporary, "release");
  try {
    await cp(defaultReleaseRoot(), root, {recursive: true,errorOnExist: true});
    await run(root);
  } finally {
    await rm(temporary, {recursive: true,force: true});
  }
}

async function assertPackageError(root: string, code: ReleasePackageError["code"]): Promise<void> {
  await assert.rejects(
    () => writeOrCheckReleaseManifest(root, true),
    (error: unknown) => error instanceof ReleasePackageError && error.code === code,
  );
}
