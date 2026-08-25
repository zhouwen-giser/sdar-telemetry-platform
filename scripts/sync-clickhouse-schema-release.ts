import {createHash} from "node:crypto";
import type {Dirent} from "node:fs";
import {copyFile,mkdir,readdir,readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

export const RELEASE_ID =
  "sdar-clickhouse-schema/1.5.0-rc.3-development-domain-projection-v3" as const;
export const RELEASE_VERSION = "1.5.0-rc.3+canonical-evidence.domain-projection.1" as const;
export const MIGRATION_SET_CONTENT_ADDRESS =
  "sha256:a70e87e4457da8e75ce64bb8a3f1af4ec26d0ab6827b070a21614d897872f144" as const;
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
  readonly schemaVersion: "sdar-telemetry.clickhouse-schema-release/v3";
  readonly releaseId: typeof RELEASE_ID;
  readonly releaseVersion: typeof RELEASE_VERSION;
  readonly installMode: "fresh-only";
  readonly source: {
    readonly benchmarkCommit: "d58d4474b3ca393c47461956e6e45ff0aa3330fa";
    readonly benchmarkManifestByteSha256: "sha256:c3a253a75a0d0998806815cba791d96b04b50c6188b3a0cd9189aca327726950";
    readonly baseRestorationOrdinals: "00..17";
    readonly tailDirectCommitOrdinals: "18..21";
    readonly productAppendOrdinal: 22;
    readonly productAppendSourceCommit: "a09f179e1a402c59a99f67e96167696c1d9590ae";
    readonly productAppendSourcePath: "migrations/clickhouse/014_sdar_evidence_v1_canonical.sql";
    readonly productAppendSourceByteSha256: "sha256:fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9";
    readonly developmentClosureOrdinal: 23;
    readonly developmentClosureAuthority: "DEC-G02-CLICKHOUSE-SCHEMA-RELEASE-BOOTSTRAP-V3";
    readonly developmentClosureFile: "23_domain_projection_health_development.sql";
    readonly developmentClosureByteSha256: "sha256:35e89646a45e1a2e96c14b259a67044ad01b1670e87c890bff382f2a3b650867";
  };
  readonly requiredDatabases: readonly string[];
  readonly expectedObjects: {
    readonly physicalTables: 312;
    readonly views: 121;
    readonly total: 433;
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

export interface DeclaredColumn {
  readonly database: string;
  readonly table: string;
  readonly name: string;
  readonly type: string;
  readonly position: number;
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
  migration(22, "22_sdar_evidence_v1_canonical.sql", 2338, "fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9"),
  migration(23, "23_domain_projection_health_development.sql", 4209, "35e89646a45e1a2e96c14b259a67044ad01b1670e87c890bff382f2a3b650867"),
]);

export const ORDINAL_23_CANONICAL_STATEMENTS = Object.freeze([
  "CREATE TABLE IF NOT EXISTS sdar_meta.domain_projection_health_snapshot\n(\n    tenant_id String,\n    project_id String,\n    projection_id String,\n    projection_version String,\n    definition_status LowCardinality(String),\n    version_status LowCardinality(String),\n    last_run_status String,\n    last_run_updated_at DateTime64(3, 'UTC'),\n    schema_drift_status String,\n    checkpoint_watermark Nullable(DateTime64(3, 'UTC')),\n    last_source_sequence UInt64,\n    produced_count UInt64,\n    skipped_count UInt64,\n    failed_count UInt64,\n    unresolved_blocking_dlq_count UInt64,\n    lineage_issue_count UInt64,\n    health_status String,\n    reason_codes Array(String)\n)\nENGINE = ReplacingMergeTree(last_run_updated_at)\nORDER BY (tenant_id, project_id, projection_id, projection_version);",
  "INSERT INTO sdar_meta.domain_projection_health_snapshot\n(tenant_id, project_id, projection_id, projection_version, definition_status, version_status, last_run_status, last_run_updated_at, schema_drift_status, checkpoint_watermark, last_source_sequence, produced_count, skipped_count, failed_count, unresolved_blocking_dlq_count, lineage_issue_count, health_status, reason_codes) VALUES\n('global', 'global', 'application_to_embodied.dp-c01', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-c02', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-c03', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-c04', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-c05', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-n01', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-n02', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-n03', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-n04', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),\n('global', 'global', 'application_to_embodied.dp-n05', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']);",
  "CREATE VIEW IF NOT EXISTS sdar_meta.v_domain_projection_health AS\nSELECT\n    tenant_id,\n    project_id,\n    projection_id,\n    projection_version,\n    definition_status,\n    version_status,\n    last_run_status,\n    last_run_updated_at,\n    schema_drift_status,\n    checkpoint_watermark,\n    last_source_sequence,\n    produced_count,\n    skipped_count,\n    failed_count,\n    unresolved_blocking_dlq_count,\n    lineage_issue_count,\n    health_status,\n    reason_codes\nFROM sdar_meta.domain_projection_health_snapshot FINAL;"
] as const);

export function projectRootFromModule(moduleUrl = import.meta.url): string {
  const parent = dirname(dirname(fileURLToPath(moduleUrl)));
  return parent.endsWith("/dist") ? dirname(parent) : parent;
}

export function defaultReleaseRoot(moduleUrl = import.meta.url): string {
  return resolve(projectRootFromModule(moduleUrl), "integrations/sdar-clickhouse/1.5.0-rc.3-development-v3");
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
    schemaVersion: "sdar-telemetry.clickhouse-schema-release/v3",
    releaseId: RELEASE_ID,
    releaseVersion: RELEASE_VERSION,
    installMode: "fresh-only",
    source: {
      benchmarkCommit: "d58d4474b3ca393c47461956e6e45ff0aa3330fa",
      benchmarkManifestByteSha256:
        "sha256:c3a253a75a0d0998806815cba791d96b04b50c6188b3a0cd9189aca327726950",
      baseRestorationOrdinals: "00..17",
      tailDirectCommitOrdinals: "18..21",
      productAppendOrdinal: 22,
      productAppendSourceCommit: "a09f179e1a402c59a99f67e96167696c1d9590ae",
      productAppendSourcePath: "migrations/clickhouse/014_sdar_evidence_v1_canonical.sql",
      productAppendSourceByteSha256:
        "sha256:fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9",
      developmentClosureOrdinal: 23,
      developmentClosureAuthority: "DEC-G02-CLICKHOUSE-SCHEMA-RELEASE-BOOTSTRAP-V3",
      developmentClosureFile: "23_domain_projection_health_development.sql",
      developmentClosureByteSha256:
        "sha256:35e89646a45e1a2e96c14b259a67044ad01b1670e87c890bff382f2a3b650867",
    },
    requiredDatabases: [...REQUIRED_DATABASES],
    expectedObjects: {physicalTables: 312,views: 121,total: 433},
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
  if (!check) await materializeReleaseMigrations(releaseRoot);
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

async function materializeReleaseMigrations(releaseRoot: string): Promise<void> {
  const migrationRoot = resolve(releaseRoot, "migrations");
  const v2MigrationRoot = resolve(releaseRoot, "../1.5.0-rc.3/migrations");
  await mkdir(migrationRoot, {recursive: true});
  for (const migration of FROZEN_MIGRATIONS.slice(0, 23)) {
    await copyFile(resolve(v2MigrationRoot, migration.file), resolve(migrationRoot, migration.file));
  }
  await writeFile(
    resolve(migrationRoot, FROZEN_MIGRATIONS[23]!.file),
    `${ORDINAL_23_CANONICAL_STATEMENTS.join("\n\n")}\n`,
    {encoding: "utf8",flag: "w"},
  );
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

export function deriveDeclaredColumns(
  release: LoadedReleasePackage,
  relations: ReadonlySet<string>,
): readonly DeclaredColumn[] {
  const columns: DeclaredColumn[] = [];
  const objects = new Map(
    deriveExpectedObjects(release).map((entry) => [`${entry.database}.${entry.name}`,entry]),
  );
  for (const relation of [...relations].sort()) {
    const object = objects.get(relation);
    if (object === undefined) {
      throw new ReleasePackageError(
        "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
        `Required derived-schema relation ${relation} is not declared by the release migrations.`,
      );
    }
    const migration = release.migrations.find(({file}) => file === object.migration);
    const statement = migration?.statements.find((candidate) =>
      new RegExp(
        `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TABLE|VIEW)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${escapeRegExp(relation)}\\b`,
        "iu",
      ).test(candidate),
    );
    if (migration === undefined || statement === undefined) {
      throw new ReleasePackageError(
        "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
        `Required derived-schema relation ${relation} has no unique creating statement.`,
      );
    }
    const [database,table] = relation.split(".") as [string,string];
    const declarations =
      object.kind === "table"
        ? tableColumnDeclarations(statement, relation)
        : viewColumnDeclarations(statement, relation);
    if (declarations.length === 0) {
      throw new ReleasePackageError(
        "CLICKHOUSE_SCHEMA_RELEASE_FILE_DRIFT",
        `Required derived-schema relation ${relation} has no statically declared columns.`,
      );
    }
    declarations.forEach(({name,type}, index) => {
      columns.push({database,table,name,type,position: index + 1,migration: migration.file});
    });
  }
  return columns;
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

function tableColumnDeclarations(
  statement: string,
  relation: string,
): readonly {readonly name: string; readonly type: string}[] {
  const relationMatch = new RegExp(`${escapeRegExp(relation)}\\b`, "iu").exec(statement);
  const open = relationMatch === null ? -1 : statement.indexOf("(", relationMatch.index + relation.length);
  const close = open < 0 ? -1 : matchingParenthesis(statement, open);
  if (open < 0 || close < 0) return [];
  const ignored = new Set(["CONSTRAINT", "INDEX", "PROJECTION", "PRIMARY", "UNIQUE", "FOREIGN", "CHECK"]);
  return splitTopLevel(statement.slice(open + 1, close), ",").flatMap((part) => {
    const declaration = part
      .replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*/u, "")
      .trim();
    const match = /^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([\s\S]+)$/u.exec(declaration);
    if (match === null || ignored.has(match[1]!.toUpperCase())) return [];
    const type = leadingType(match[2]!);
    return type === "" ? [] : [{name: match[1]!,type}];
  });
}

function viewColumnDeclarations(
  statement: string,
  relation: string,
): readonly {readonly name: string; readonly type: string}[] {
  const relationMatch = new RegExp(`${escapeRegExp(relation)}\\b`, "iu").exec(statement);
  if (relationMatch === null) return [];
  const tail = statement.slice(relationMatch.index + relation.length);
  const selectMatch = /\bAS\s+SELECT\b/iu.exec(tail);
  if (selectMatch === null) return [];
  const selectList = tail.slice(selectMatch.index + selectMatch[0].length);
  const from = topLevelKeywordIndex(selectList, "FROM");
  if (from < 0) return [];
  return splitTopLevel(selectList.slice(0, from), ",").flatMap((part) => {
    const expression = part.trim();
    const alias = /\bAS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*$/iu.exec(expression)?.[1];
    const simple = /^(?:`?[A-Za-z_][A-Za-z0-9_]*`?\.)?`?([A-Za-z_][A-Za-z0-9_]*)`?$/u.exec(
      expression,
    )?.[1];
    const name = alias ?? simple;
    return name === undefined ? [] : [{name,type: "Derived"}];
  });
}

function leadingType(value: string): string {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]!;
    const next = value[index + 1];
    if (quote !== undefined) {
      if (current === "\\") index += 1;
      else if (current === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") quote = current;
    else if (current === "(") depth += 1;
    else if (current === ")") depth -= 1;
    else if (/\s/u.test(current) && depth === 0) return value.slice(0, index).trim();
  }
  return value.trim();
}

function matchingParenthesis(value: string, open: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  for (let index = open; index < value.length; index += 1) {
    const current = value[index]!;
    const next = value[index + 1];
    if (quote !== undefined) {
      if (current === "\\") index += 1;
      else if (current === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") quote = current;
    else if (current === "(") depth += 1;
    else if (current === ")" && --depth === 0) return index;
  }
  return -1;
}

function splitTopLevel(value: string, separator: string): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]!;
    const next = value[index + 1];
    if (quote !== undefined) {
      if (current === "\\") index += 1;
      else if (current === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") quote = current;
    else if (current === "(") depth += 1;
    else if (current === ")") depth -= 1;
    else if (current === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function topLevelKeywordIndex(value: string, keyword: string): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  for (let index = 0; index <= value.length - keyword.length; index += 1) {
    const current = value[index]!;
    const next = value[index + 1];
    if (quote !== undefined) {
      if (current === "\\") index += 1;
      else if (current === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") quote = current;
    else if (current === "(") depth += 1;
    else if (current === ")") depth -= 1;
    else if (
      depth === 0 &&
      value.slice(index, index + keyword.length).toUpperCase() === keyword &&
      !/[A-Za-z0-9_]/u.test(value[index - 1] ?? "") &&
      !/[A-Za-z0-9_]/u.test(value[index + keyword.length] ?? "")
    ) {
      return index;
    }
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
        : ordinal <= 21
          ? "exact-bytes-from-benchmark-d58d4474b3ca393c47461956e6e45ff0aa3330fa"
          : ordinal === 22
            ? "exact-bytes-from-sdar-telemetry-a09f179e1a402c59a99f67e96167696c1d9590ae:migrations/clickhouse/014_sdar_evidence_v1_canonical.sql"
            : "exact-rendering-of-DEC-G02-CLICKHOUSE-SCHEMA-RELEASE-BOOTSTRAP-V3.ordinal23.canonicalStatements",
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
      "Release migrations directory must contain exactly the accepted 24 SQL files.",
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
