import {createHash} from "node:crypto";
import {appendFile,cp,mkdtemp,readFile,rm,unlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultReleaseRoot,
  deriveExpectedObjects,
  loadReleasePackage,
  MIGRATION_SET_CONTENT_ADDRESS,
  ReleasePackageError,
  stableJson,
  writeOrCheckReleaseManifest,
} from "../../scripts/sync-clickhouse-schema-release.js";

test("release package is the exact deterministic 22-file Decision release", async () => {
  const release = await loadReleasePackage();
  assert.equal(release.migrations.length, 22);
  assert.deepEqual(
    release.manifest.migrations.map(({ordinal}) => ordinal),
    Array.from({length: 22}, (_, ordinal) => ordinal),
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
  ]);
  for (const migration of release.manifest.migrations) {
    assert.deepEqual(Object.keys(migration), ["ordinal", "file", "bytes", "sha256", "provenance"]);
  }
  assert.equal(release.manifest.migrationSetContentAddress, MIGRATION_SET_CONTENT_ADDRESS);
  assert.equal(JSON.stringify(release.manifest).includes("/home/"), false);
  assert.equal(JSON.stringify(release.manifest).includes("all.sql"), false);

  const unsigned = structuredClone(release.manifest) as unknown as {
    contentAddress: {algorithm: string; digest?: string};
  };
  delete unsigned.contentAddress.digest;
  const digest = `sha256:${createHash("sha256").update(stableJson(unsigned)).digest("hex")}`;
  assert.equal(release.manifest.contentAddress.digest, digest);

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
});

test("release package check rejects missing base, altered bytes, extra files, source manifest, and address drift", async () => {
  await withFixture(async (root) => {
    await unlink(resolve(root, "migrations/00_create_databases.sql"));
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
