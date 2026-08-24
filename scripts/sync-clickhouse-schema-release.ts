import {createHash} from "node:crypto";
import type {Dirent} from "node:fs";
import {readdir,readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

export const RELEASE_ID =
  "sdar-clickhouse-schema/1.5.0-rc.3-benchmark-aligned-development" as const;
export const RELEASE_VERSION = "1.5.0-rc.3" as const;
export const MIGRATION_SET_CONTENT_ADDRESS =
  "sha256:36e9ccad01c075098b74307c4a9cf2b0aed8eb17ab1dc30c04722755af6016ee" as const;
export const LEDGER_TABLE = "default.sdar_clickhouse_schema_release_ledger" as const;
export const REQUIRED_DATABASES = Object.freeze([
  "sdar_meta",
  "sdar_core",
  "sdar_commander",
  "sdar_npc",
  "sdar_embodied",
  "sdar_mart",
] as const);

const TOP_LEVEL_FIELDS = Object.freeze([
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

export interface FrozenMigration {
  readonly ordinal: number;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly provenance: string;
}

export type ReleaseMigration = FrozenMigration;

export interface ReleaseManifest {
  readonly schemaVersion: "sdar-telemetry.clickhouse-schema-release/v1";
  readonly releaseId: typeof RELEASE_ID;
  readonly releaseVersion: typeof RELEASE_VERSION;
  readonly installMode: "fresh-only";
  readonly source: {
    readonly benchmarkCommit: "d58d4474b3ca393c47461956e6e45ff0aa3330fa";
    readonly benchmarkManifestByteSha256: "sha256:c3a253a75a0d0998806815cba791d96b04b50c6188b3a0cd9189aca327726950";
    readonly baseRestorationOrdinals: "00..17";
    readonly tailDirectCommitOrdinals: "18..21";
  };
  readonly requiredDatabases: readonly string[];
  readonly expectedObjects: {
    readonly physicalTables: 310;
    readonly views: 120;
    readonly total: 430;
  };
  readonly ledger: {
    readonly table: typeof LEDGER_TABLE;
    readonly columns: readonly string[];
    readonly engine: "MergeTree";
    readonly orderBy: readonly ["release_id", "ordinal"];
  };
  readonly migrations: readonly ReleaseMigration[];
  readonly migrationSetContentAddress: typeof MIGRATION_SET_CONTENT_ADDRESS;
  readonly contentAddress: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
}

export interface LoadedMigration extends ReleaseMigration {
  readonly path: string;
  readonly sql: string;
  readonly statements: readonly string[];
}

export interface LoadedReleasePackage {
  readonly root: string;
  readonly manifest: ReleaseManifest;
  readonly migrations: readonly LoadedMigration[];
}

export interface ExpectedObject {
  readonly database: string;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly engine: string;
  readonly migration: string;
}

export class ReleasePackageError extends Error {
  readonly code: "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT" | "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT";

  constructor(
    code: "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT" | "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
    message: string,
  ) {
    super(message);
    this.name = "ReleasePackageError";
    this.code = code;
  }
}

export const FROZEN_MIGRATIONS = Object.freeze([
  migration(0, "00_create_databases.sql", 642, "17c1cf772cdb0b61abf39153fa21b91a3fb205447524bc66423d4015ad29fd81"),
  migration(1, "01_sdar_meta.sql", 23140, "5a3db03dd8b477408ea0cb562bafa0db2253f4344455a4d67af06062bb31150a"),
  migration(2, "02_sdar_core.sql", 113198, "a6b4afd2bd380fcd194e6e37b71811d3cd9524c76362a4cc248d236a60b3310d"),
  migration(3, "03_sdar_commander.sql", 49422, "69b5f325b420731fd6c6dec27a240854fefeeebc3f5804c3468954006ff989da"),
  migration(4, "04_sdar_npc.sql", 53519, "59520e3ee3628476f2a96460a8cda8c61b69be78510026153bbb6dc24139fa0c"),
  migration(5, "05_sdar_embodied.sql", 87996, "3d4278a4a79100d4953ff325cada233b3a39c58f37af5aa8f6925146914d90bd"),
  migration(6, "06_sdar_mart.sql", 45676, "c92ff74eb7b85ef218d4e8fe755629457c9b6f0fcdbfc0f57a22a463a3cbdbab"),
  migration(7, "07_quality_views.sql", 54914, "a01c346fbe0b5a955cb64ffb43acaf27226ccdf93737d12ed7f98d1671fe366a"),
  migration(8, "08_seed_meta.sql", 48132, "732f05e948b8d20ee30f1dd34bec533a716d6cc6da89f465eb01a41af6108d2c"),
  migration(9, "09_smoke_test.sql", 13212, "44d64dcc05cad4f838f104c93b9028ada97745e5706e7497d4908b0ef9a2485e"),
  migration(10, "10_sdar_v1_3_skill_aware.sql", 50858, "560783ab1a26d70f3fd3fd997a2b72b46c20c86689b377fc5ee501deb7a79814"),
  migration(11, "11_sdar_v1_3_event_handling.sql", 3728, "4aa252a3245c83629ea5a0246a1b9033b91c43a5ba7044dab5e02142c34bcb94"),
  migration(12, "12_smpp_provider_ops_projection.sql", 20670, "ec13704b17230390cc1ceade0a53c4d4b19958f62444456ec575a03aadaa4db9"),
  migration(13, "13_sdar_v1_4_capability_chain.sql", 17745, "90f08b7e1cb7c46d5297ded17e7e543ed6cf5616f862a3f06b367dac3290b13c"),
  migration(14, "14_sdar_v1_4_1_canonical_evidence_foundation.sql", 78975, "e8f3eafc71f454c0407e9e2ce79c027a0274f43b31cd2cfbbb034cc4f282679a"),
  migration(15, "15_sdar_v1_4_1_node_control_facts.sql", 20173, "6ab72656aaa7c24516f08e642622fb38a0953caf7e85fb9639f1526239a30b7b"),
  migration(16, "16_sdar_v1_4_1_experience_replay_artifact.sql", 26148, "d74e037e5627443e085be33fd97c9197804f485be7484403825aab611db8d521"),
  migration(17, "17_sdar_v1_4_1_dataset_and_cross_chain.sql", 19021, "531b4bac24ff3a40a535c55baa11cad77e308123b38be5b34b4fd518f29f0aef"),
  migration(18, "18_benchmark_contract_projection.sql", 30952, "8c6157df213c156f411502eb1a449ee62686a859744e3543c040eae24ae2d26d"),
  migration(19, "19_evaluation_contract_v15.sql", 19060, "3f43dd80c423462f95779efc6c0a5786169b86a23e0c32333db538a916c3fc44"),
  migration(20, "20_benchmark_runtime_projection.sql", 18444, "58579305fe1407b031ca4495b3c7e1d2d54273920ab23d22ac817aee264cb264"),
  migration(21, "21_benchmark_comparison_and_marts.sql", 15412, "4c18d9bd36cc4bab2d0a93c3ce139f957bf7d35cc30aaa28393eda6668fa261b"),
]);

export function projectRootFromModule(moduleUrl = import.meta.url): string {
  const parent = dirname(dirname(fileURLToPath(moduleUrl)));
  return parent.endsWith("/dist") ? dirname(parent) : parent;
}

export function defaultReleaseRoot(moduleUrl = import.meta.url): string {
  return resolve(projectRootFromModule(moduleUrl), "integrations/sdar-clickhouse/1.5.0-rc.3");
}

export async function buildReleaseManifest(releaseRoot: string): Promise<ReleaseManifest> {
  const migrations = await readAndValidateMigrationFiles(releaseRoot);
  const migrationSetCanonical = stableJson(
    migrations.map(({file,bytes,sha256}) => ({path: `migrations/${file}`,size: bytes,sha256})),
  );
  const migrationSet = `sha256:${sha256(migrationSetCanonical)}`;
  if (migrationSet !== MIGRATION_SET_CONTENT_ADDRESS) {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
      "Migration-set content address does not match the accepted release.",
    );
  }

  const unsigned = {
    schemaVersion: "sdar-telemetry.clickhouse-schema-release/v1",
    releaseId: RELEASE_ID,
    releaseVersion: RELEASE_VERSION,
    installMode: "fresh-only",
    source: {
      benchmarkCommit: "d58d4474b3ca393c47461956e6e45ff0aa3330fa",
      benchmarkManifestByteSha256:
        "sha256:c3a253a75a0d0998806815cba791d96b04b50c6188b3a0cd9189aca327726950",
      baseRestorationOrdinals: "00..17",
      tailDirectCommitOrdinals: "18..21",
    },
    requiredDatabases: [...REQUIRED_DATABASES],
    expectedObjects: {physicalTables: 310,views: 120,total: 430},
    ledger: {
      table: LEDGER_TABLE,
      columns: [
        "release_id String",
        "release_manifest_content_address String",
        "migration_set_content_address String",
        "ordinal UInt8",
        "file_name String",
        "byte_size UInt64",
        "file_sha256 FixedString(64)",
        "applied_at DateTime64(3, 'UTC')",
      ],
      engine: "MergeTree",
      orderBy: ["release_id", "ordinal"] as const,
    },
    migrations,
    migrationSetContentAddress: MIGRATION_SET_CONTENT_ADDRESS,
    contentAddress: {
      algorithm: "sha256" as const,
    },
  } as const;
  const digest = `sha256:${sha256(stableJson(unsigned))}`;
  return {...unsigned,contentAddress: {...unsigned.contentAddress,digest}};
}

export async function loadReleasePackage(releaseRoot = defaultReleaseRoot()): Promise<LoadedReleasePackage> {
  await assertExactPackageEntries(releaseRoot);
  const expected = await buildReleaseManifest(releaseRoot);
  const manifestPath = resolve(releaseRoot, "release-manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT",
      "Release manifest is missing or unreadable.",
    );
  }
  const expectedBytes = `${JSON.stringify(expected, null, 2)}\n`;
  if (raw !== expectedBytes) {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT",
      "Release manifest bytes do not match deterministic product generation.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT",
      "Release manifest is not valid JSON.",
    );
  }
  assertManifestShape(parsed);
  const migrations = await Promise.all(
    expected.migrations.map(async (entry) => {
      const path = `migrations/${entry.file}`;
      const sql = await readFile(resolve(releaseRoot, path), "utf8");
      const statements = splitClickHouseStatements(sql);
      if (statements.length === 0) {
        throw new ReleasePackageError(
          "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
          `Migration ${entry.file} has no executable statement.`,
        );
      }
      return {...entry,path,sql,statements};
    }),
  );
  return {root: releaseRoot,manifest: expected,migrations};
}

export async function writeOrCheckReleaseManifest(
  releaseRoot: string,
  check: boolean,
): Promise<ReleaseManifest> {
  const manifest = await buildReleaseManifest(releaseRoot);
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const path = resolve(releaseRoot, "release-manifest.json");
  if (check) {
    await assertExactPackageEntries(releaseRoot);
    let actual: string;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      throw new ReleasePackageError(
        "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT",
        "Release manifest is missing or unreadable.",
      );
    }
    if (actual !== bytes) {
      throw new ReleasePackageError(
        "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT",
        "Release manifest bytes drifted from deterministic generation.",
      );
    }
    await loadReleasePackage(releaseRoot);
  } else {
    await assertMigrationDirectoryEntries(releaseRoot);
    await writeFile(path, bytes, {encoding: "utf8",flag: "w"});
  }
  return manifest;
}

export function deriveExpectedObjects(release: LoadedReleasePackage): readonly ExpectedObject[] {
  const objects = new Map<string, ExpectedObject>();
  const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(MATERIALIZED)\s+)?(TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/iu;
  for (const migration of release.migrations) {
    for (const statement of migration.statements) {
      const match = pattern.exec(statement);
      if (match === null) continue;
      const [,materialized,keyword,database,name] = match;
      if (!REQUIRED_DATABASES.includes(database as (typeof REQUIRED_DATABASES)[number])) continue;
      const kind = keyword.toUpperCase() === "VIEW" || materialized !== undefined ? "view" : "table";
      const engine =
        kind === "view"
          ? materialized === undefined
            ? "View"
            : "MaterializedView"
          : /\bENGINE\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/iu.exec(statement)?.[1];
      if (engine === undefined) {
        throw new ReleasePackageError(
          "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
          `Table ${database}.${name} has no declared engine.`,
        );
      }
      const key = `${database}.${name}`;
      if (!objects.has(key)) objects.set(key, {database,name,kind,engine,migration: migration.file});
    }
  }
  return [...objects.values()].sort((a, b) =>
    `${a.database}.${a.name}`.localeCompare(`${b.database}.${b.name}`),
  );
}

export function splitClickHouseStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (current === "\\") {
        index += 1;
      } else if (current === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else if (current === "'" || current === '"' || current === "`") {
      quote = current;
    } else if (current === ";") {
      const statement = sql.slice(start, index).trim();
      if (hasExecutableSql(statement)) statements.push(statement);
      start = index + 1;
    }
  }
  if (quote !== undefined || blockComment) {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
      "Migration contains an unterminated quoted string or block comment.",
    );
  }
  const finalStatement = sql.slice(start).trim();
  if (hasExecutableSql(finalStatement)) statements.push(finalStatement);
  return statements;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Unsupported JSON value.");
}

function migration(ordinal: number, file: string, bytes: number, hash: string): FrozenMigration {
  return Object.freeze({
    ordinal,
    file,
    bytes,
    sha256: hash,
    provenance:
      ordinal <= 17
        ? "committed-rc3-manifest-authenticated-restoration"
        : "exact-bytes-from-benchmark-d58d4474b3ca393c47461956e6e45ff0aa3330fa",
  });
}

async function readAndValidateMigrationFiles(releaseRoot: string): Promise<readonly ReleaseMigration[]> {
  await assertMigrationDirectoryEntries(releaseRoot);
  return Promise.all(
    FROZEN_MIGRATIONS.map(async (entry) => {
      const path = `migrations/${entry.file}`;
      let bytes: Buffer;
      try {
        bytes = await readFile(resolve(releaseRoot, path));
      } catch {
        throw new ReleasePackageError(
          "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
          `Required migration ${entry.file} is missing or unreadable.`,
        );
      }
      if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) {
        throw new ReleasePackageError(
          "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
          `Required migration ${entry.file} failed byte-size or SHA-256 validation.`,
        );
      }
      return entry;
    }),
  );
}

async function assertMigrationDirectoryEntries(releaseRoot: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(resolve(releaseRoot, "migrations"), {withFileTypes: true});
  } catch {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
      "Release migrations directory is missing or unreadable.",
    );
  }
  const expected = FROZEN_MIGRATIONS.map(({file}) => file).sort();
  const actual = entries.map(({name}) => name).sort();
  if (
    entries.some((entry) => !entry.isFile()) ||
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index])
  ) {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
      "Release migrations directory must contain exactly the accepted 22 SQL files.",
    );
  }
}

async function assertExactPackageEntries(releaseRoot: string): Promise<void> {
  await assertMigrationDirectoryEntries(releaseRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(releaseRoot, {withFileTypes: true});
  } catch {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
      "Release package root is missing or unreadable.",
    );
  }
  const actual = entries.map(({name}) => name).sort();
  if (
    entries.some((entry) =>
      entry.name === "migrations" ? !entry.isDirectory() : !entry.isFile(),
    ) ||
    actual.length !== 2 ||
    actual[0] !== "migrations" ||
    actual[1] !== "release-manifest.json"
  ) {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
      "Release package must contain only release-manifest.json and the migrations directory.",
    );
  }
}

function assertManifestShape(value: unknown): asserts value is ReleaseManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT",
      "Release manifest must be an object.",
    );
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const expectedKeys = [...TOP_LEVEL_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new ReleasePackageError(
      "CLICKHOUSE_SCHEMA_RELEASE_MANIFEST_DRIFT",
      "Release manifest top-level fields are not exact.",
    );
  }
}

function hasExecutableSql(value: string): boolean {
  return value.replace(/--[^\n]*(?:\n|$)/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "").trim() !== "";
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
    throw new Error("usage: sync-clickhouse-schema-release.ts [--check]");
  }
  const check = args[0] === "--check";
  const manifest = await writeOrCheckReleaseManifest(defaultReleaseRoot(), check);
  process.stdout.write(
    `${JSON.stringify({releaseId: manifest.releaseId,contentAddress: manifest.contentAddress.digest,mode: check ? "checked" : "written"})}\n`,
  );
}

const entry = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (entry === import.meta.url) {
  main().catch((error: unknown) => {
    const code = error instanceof ReleasePackageError ? error.code : "CLICKHOUSE_SCHEMA_RELEASE_FAILED";
    const message = error instanceof Error ? error.message : "Release package operation failed.";
    process.stderr.write(`${JSON.stringify({code,message})}\n`);
    process.exitCode = 1;
  });
}
