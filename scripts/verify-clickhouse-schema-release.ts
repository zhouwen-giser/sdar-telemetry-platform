import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {
  ClickHouseClient,
  configFromEnv,
  type ClickHouseQueryOptions,
} from "../packages/telemetry-clickhouse/src/index.js";
import {
  deriveExpectedObjects,
  LEDGER_TABLE,
  loadReleasePackage,
  REQUIRED_DATABASES,
  ReleasePackageError,
  type LoadedReleasePackage,
} from "./sync-clickhouse-schema-release.js";

export interface ReadonlyClickHouse {
  query(sql: string, options?: ClickHouseQueryOptions): Promise<string>;
}

export interface ReleaseVerificationResult {
  readonly schemaVersion: "sdar-telemetry.clickhouse-schema-release-verify/v1";
  readonly releaseId: string;
  readonly releaseManifestContentAddress: string;
  readonly migrationSetContentAddress: string;
  readonly clickHouseVersion: string;
  readonly databases: 6;
  readonly physicalTables: 310;
  readonly views: 120;
  readonly totalObjects: 430;
  readonly ledgerRows: 22;
  readonly verified: true;
}

export class ReleaseVerificationError extends Error {
  readonly code = "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "ReleaseVerificationError";
  }
}

const MINIMUM_CLICKHOUSE_VERSION = "24.10.2.1";
const WRITABLE_PROJECTION_TABLES = Object.freeze([
  "sdar_meta.benchmark_contract_release",
  "sdar_meta.benchmark_dataset_definition",
  "sdar_meta.benchmark_dataset_version",
  "sdar_meta.benchmark_scenario_family_definition",
  "sdar_meta.benchmark_case_definition",
  "sdar_meta.benchmark_case_version",
  "sdar_meta.benchmark_expected_contract_definition",
  "sdar_meta.benchmark_case_evaluation_binding_definition",
  "sdar_meta.benchmark_operator_definition",
  "sdar_meta.benchmark_relation_definition",
  "sdar_meta.benchmark_invariant_definition",
  "sdar_meta.benchmark_golden_fixture_definition",
  "sdar_mart.evaluation_result_v15",
  "sdar_mart.evaluation_readiness_result",
  "sdar_mart.evaluation_evidence_grade_result",
  "sdar_mart.evaluation_metric_result_v15",
  "sdar_mart.evaluation_dimension_result",
  "sdar_mart.evaluation_gate_result_v15",
  "sdar_mart.evaluation_fatal_result",
  "sdar_mart.evaluation_operational_metric",
  "sdar_mart.benchmark_candidate_snapshot",
  "sdar_mart.benchmark_run",
  "sdar_mart.benchmark_case_execution",
  "sdar_mart.benchmark_case_repetition",
  "sdar_mart.benchmark_evidence_bundle_snapshot",
  "sdar_mart.benchmark_evidence_bundle_record",
  "sdar_mart.benchmark_case_result",
  "sdar_mart.benchmark_judge_result",
  "sdar_mart.benchmark_human_review_result",
  "sdar_mart.benchmark_calibration_result",
  "sdar_mart.benchmark_baseline",
  "sdar_mart.benchmark_comparison",
  "sdar_mart.benchmark_comparison_case_result",
  "sdar_mart.benchmark_candidate_summary",
  "sdar_mart.benchmark_track_summary",
  "sdar_mart.benchmark_scenario_family_summary",
  "sdar_mart.benchmark_risk_summary",
  "sdar_mart.benchmark_skill_version_summary",
  "sdar_mart.benchmark_provider_summary",
  "sdar_mart.benchmark_operational_summary",
]);
const REQUIRED_PROJECTION_VIEWS = Object.freeze([
  "sdar_meta.v_benchmark_case_latest",
  "sdar_meta.v_benchmark_binding_latest",
  "sdar_meta.v_benchmark_contract_release_current",
  "sdar_mart.v_evaluation_result_v15_current",
  "sdar_mart.v_evaluation_metric_result_v15_current",
  "sdar_mart.v_evaluation_gate_result_v15_current",
  "sdar_mart.v_evaluation_fatal_result_v15_current",
  "sdar_mart.v_legacy_evaluation_result_v141_normalized",
  "sdar_mart.v_source_evidence_readiness_v15",
  "sdar_mart.v_benchmark_run_current",
  "sdar_mart.v_benchmark_case_execution_current",
  "sdar_mart.v_benchmark_case_repetition_current",
  "sdar_mart.v_benchmark_case_result_current",
  "sdar_mart.v_benchmark_evidence_bundle_current",
  "sdar_mart.v_benchmark_release_gate_v15",
  "sdar_mart.v_benchmark_case_pair_comparison_v15",
  "sdar_mart.v_benchmark_source_vs_evaluation_readiness",
  "sdar_mart.v_legacy_dataset_release_gate_v141",
]);
const CANONICAL_EVIDENCE_COLUMNS = Object.freeze([
  "row_id",
  "contract_version",
  "evidence_sequence",
  "record_id",
  "record_family",
  "record_type",
  "schema_name",
  "schema_version",
  "source_system",
  "source_table",
  "source_record_id",
  "source_revision",
  "task_id",
  "context_id",
  "episode_id",
  "correlation_id",
  "evidence_refs",
  "artifact_refs",
  "payload_hash",
  "payload_json",
  "record_json",
  "occurred_at",
  "recorded_at",
  "projected_at",
]);
const CRITICAL_SEMANTIC_COLUMNS = Object.freeze([
  "sdar_mart.evaluation_result_v15.evaluation_origin",
  "sdar_mart.evaluation_result_v15.subject_type",
  "sdar_mart.evaluation_result_v15.readiness_status",
  "sdar_mart.evaluation_result_v15.score_status",
  "sdar_mart.evaluation_result_v15.quality_score",
  "sdar_mart.evaluation_result_v15.level",
  "sdar_mart.evaluation_result_v15.evaluation_binding_hash",
  "sdar_mart.evaluation_result_v15.candidate_snapshot_hash",
  "sdar_mart.evaluation_result_v15.evidence_bundle_snapshot_hash",
  "sdar_mart.evaluation_readiness_result.source_evidence_readiness",
  "sdar_mart.evaluation_evidence_grade_result.evidence_level",
  "sdar_mart.evaluation_fatal_result.proof_status",
  "sdar_mart.evaluation_fatal_result.evidence_level",
  "sdar_mart.evaluation_fatal_result.matched",
  "sdar_mart.benchmark_case_repetition.repeat_index",
  "sdar_mart.benchmark_case_repetition.episode_id",
  "sdar_mart.benchmark_case_repetition.evidence_bundle_snapshot_id",
  "sdar_mart.benchmark_case_repetition.evaluation_id",
  "sdar_mart.benchmark_evidence_bundle_snapshot.manifest_revision",
  "sdar_mart.benchmark_evidence_bundle_snapshot.record_index_hash",
  "sdar_mart.benchmark_evidence_bundle_snapshot.bundle_hash",
  "sdar_mart.v_source_evidence_readiness_v15.manifest_revision",
  "sdar_mart.v_source_evidence_readiness_v15.manifest_payload_hash",
  "sdar_mart.v_source_evidence_readiness_v15.readiness_projected_at",
]);

export async function verifyInstalledRelease(
  client: ReadonlyClickHouse,
  release: LoadedReleasePackage,
): Promise<ReleaseVerificationResult> {
  const expectedObjects = deriveExpectedObjects(release);
  const expectedTables = expectedObjects.filter(({kind}) => kind === "table");
  const expectedViews = expectedObjects.filter(({kind}) => kind === "view");
  requireCondition(
    expectedTables.length === 310 && expectedViews.length === 120 && expectedObjects.length === 430,
    "Migration-derived object inventory is not exactly 310 physical tables and 120 views.",
  );

  const versionRows = await jsonRows(client, "SELECT version() AS version FORMAT JSON", 1);
  const version = stringField(versionRows[0], "version");
  requireCondition(
    compareVersions(version, MINIMUM_CLICKHOUSE_VERSION) >= 0,
    `ClickHouse version must be at least ${MINIMUM_CLICKHOUSE_VERSION}.`,
  );

  const databaseRows = await jsonRows(
    client,
    "SELECT name FROM system.databases WHERE name LIKE 'sdar\\_%' ORDER BY name FORMAT JSON",
    20,
  );
  const databases = databaseRows.map((row) => stringField(row, "name"));
  assertExactSet(databases, REQUIRED_DATABASES, "release database inventory");

  const objectRows = await jsonRows(
    client,
    `SELECT database,name,engine FROM system.tables WHERE database IN (${sqlStrings(REQUIRED_DATABASES)}) ORDER BY database,name FORMAT JSON`,
    500,
  );
  const actualObjects = new Map<string, string>();
  for (const row of objectRows) {
    const key = `${stringField(row, "database")}.${stringField(row, "name")}`;
    requireCondition(!actualObjects.has(key), `Duplicate object inventory row for ${key}.`);
    actualObjects.set(key, stringField(row, "engine"));
  }
  requireCondition(actualObjects.size === 430, "Installed release object count is not exactly 430.");
  for (const expected of expectedObjects) {
    const key = `${expected.database}.${expected.name}`;
    const actualEngine = actualObjects.get(key);
    requireCondition(actualEngine !== undefined, `Required release object ${key} is missing.`);
    requireCondition(actualEngine === expected.engine, `Release object ${key} has an engine mismatch.`);
    actualObjects.delete(key);
  }
  requireCondition(Number(actualObjects.size) === 0, "Unexpected release object exists.");
  requireCondition(
    !objectRows.some(
      (row) =>
        stringField(row, "database") === "sdar_mart" &&
        stringField(row, "name") === "v_benchmark_release_gate",
    ),
    "Stale near-name sdar_mart.v_benchmark_release_gate is forbidden.",
  );
  for (const table of WRITABLE_PROJECTION_TABLES) {
    requireCondition(
      objectRows.some((row) => objectName(row) === table && !isViewEngine(stringField(row, "engine"))),
      `Required writable projection table ${table} is missing or is not physical.`,
    );
  }
  for (const view of REQUIRED_PROJECTION_VIEWS) {
    requireCondition(
      objectRows.some((row) => objectName(row) === view && isViewEngine(stringField(row, "engine"))),
      `Required projection view ${view} is missing or has the wrong engine kind.`,
    );
  }

  const columnRows = await jsonRows(
    client,
    `SELECT database,table,name,type,position FROM system.columns WHERE database IN (${sqlStrings(REQUIRED_DATABASES)}) OR (database='default' AND table='sdar_clickhouse_schema_release_ledger') ORDER BY database,table,position FORMAT JSON`,
    20_000,
  );
  const columnNames = new Set(
    columnRows.map(
      (row) => `${stringField(row, "database")}.${stringField(row, "table")}.${stringField(row, "name")}`,
    ),
  );
  for (const column of CANONICAL_EVIDENCE_COLUMNS) {
    requireCondition(
      columnNames.has(`sdar_core.sdar_evidence_v1_record.${column}`),
      `Canonical evidence column ${column} is missing.`,
    );
  }
  for (const column of CRITICAL_SEMANTIC_COLUMNS) {
    requireCondition(columnNames.has(column), `Critical semantic column ${column} is missing.`);
  }
  assertLedgerColumns(columnRows);

  const seedRows = await jsonRows(
    client,
    `SELECT
      (SELECT uniqExact(release_id) FROM sdar_meta.benchmark_contract_release WHERE release_id='sdar-benchmark-contracts/0.1.0-rc.1') AS releases,
      (SELECT uniqExact(record_type) FROM sdar_meta.record_type_definition WHERE contract_version='sdar.evidence/v1') AS record_types,
      (SELECT uniqExact(record_type) FROM sdar_meta.source_mapping_definition WHERE contract_version='sdar.evidence/v1') AS source_mappings,
      (SELECT uniqExact(operator_id) FROM sdar_meta.benchmark_operator_definition WHERE catalog_id='sdar-benchmark-operator-catalog' AND catalog_version=1) AS operators,
      (SELECT uniqExact(relation_id) FROM sdar_meta.benchmark_relation_definition WHERE catalog_id='sdar-benchmark-relation-catalog' AND catalog_version=1) AS relations,
      (SELECT uniqExact(invariant_id) FROM sdar_meta.benchmark_invariant_definition WHERE catalog_id='sdar-benchmark-invariant-catalog' AND catalog_version=1) AS invariants
    FORMAT JSON`,
    1,
  );
  const seeds = seedRows[0];
  requireCondition(numberField(seeds, "releases") >= 1, "Benchmark contract release seed is missing.");
  requireCondition(numberField(seeds, "record_types") === 100, "Evidence record-type catalog count is not 100.");
  requireCondition(numberField(seeds, "source_mappings") === 100, "Evidence source-mapping count is not 100.");
  requireCondition(numberField(seeds, "operators") === 16, "Benchmark operator catalog count is not 16.");
  requireCondition(numberField(seeds, "relations") === 8, "Benchmark relation catalog count is not 8.");
  requireCondition(numberField(seeds, "invariants") === 12, "Benchmark invariant catalog count is not 12.");

  const ledgerTableRows = await jsonRows(
    client,
    "SELECT database,name,engine,sorting_key FROM system.tables WHERE name='sdar_clickhouse_schema_release_ledger' ORDER BY database FORMAT JSON",
    10,
  );
  requireCondition(ledgerTableRows.length === 1, "Release ledger table must exist exactly once.");
  requireCondition(
    objectName(ledgerTableRows[0]) === LEDGER_TABLE &&
      stringField(ledgerTableRows[0], "engine") === "MergeTree" &&
      stringField(ledgerTableRows[0], "sorting_key").replaceAll(" ", "") === "release_id,ordinal",
    "Release ledger must be the exact default MergeTree ordered by release_id and ordinal.",
  );
  const ledgerRows = await jsonRows(
    client,
    `SELECT release_id,release_manifest_content_address,migration_set_content_address,ordinal,file_name,byte_size,file_sha256 FROM ${LEDGER_TABLE} ORDER BY ordinal FORMAT JSON`,
    30,
  );
  assertExactLedger(release, ledgerRows);

  for (const object of expectedViews) {
    try {
      await readonlyQuery(client, `SELECT * FROM ${object.database}.${object.name} LIMIT 0 FORMAT Null`);
    } catch {
      throw new ReleaseVerificationError(`Required view ${object.database}.${object.name} did not compile.`);
    }
  }
  for (const object of expectedTables) {
    try {
      await readonlyQuery(client, `SELECT * FROM ${object.database}.${object.name} LIMIT 0 FORMAT Null`);
    } catch {
      throw new ReleaseVerificationError(`Required table ${object.database}.${object.name} was not queryable.`);
    }
  }

  return {
    schemaVersion: "sdar-telemetry.clickhouse-schema-release-verify/v1",
    releaseId: release.manifest.releaseId,
    releaseManifestContentAddress: release.manifest.contentAddress.digest,
    migrationSetContentAddress: release.manifest.migrationSetContentAddress,
    clickHouseVersion: version,
    databases: 6,
    physicalTables: 310,
    views: 120,
    totalObjects: 430,
    ledgerRows: 22,
    verified: true,
  };
}

function assertLedgerColumns(rows: readonly Record<string, unknown>[]): void {
  const actual = rows
    .filter(
      (row) =>
        stringField(row, "database") === "default" &&
        stringField(row, "table") === "sdar_clickhouse_schema_release_ledger",
    )
    .map((row) => `${stringField(row, "name")} ${stringField(row, "type")}`);
  const expected = [
    "release_id String",
    "release_manifest_content_address String",
    "migration_set_content_address String",
    "ordinal UInt8",
    "file_name String",
    "byte_size UInt64",
    "file_sha256 FixedString(64)",
    "applied_at DateTime64(3, 'UTC')",
  ];
  requireCondition(
    actual.length === expected.length && actual.every((value, index) => value === expected[index]),
    "Release ledger columns or order drifted.",
  );
}

function assertExactLedger(
  release: LoadedReleasePackage,
  rows: readonly Record<string, unknown>[],
): void {
  requireCondition(rows.length === 22, "Release ledger must contain exactly 22 rows.");
  for (const migration of release.manifest.migrations) {
    const row = rows[migration.ordinal];
    requireCondition(row !== undefined, `Release ledger ordinal ${migration.ordinal} is missing.`);
    requireCondition(
      stringField(row, "release_id") === release.manifest.releaseId &&
        stringField(row, "release_manifest_content_address") === release.manifest.contentAddress.digest &&
        stringField(row, "migration_set_content_address") === release.manifest.migrationSetContentAddress &&
        numberField(row, "ordinal") === migration.ordinal &&
        stringField(row, "file_name") === migration.file &&
        numberField(row, "byte_size") === migration.bytes &&
        stringField(row, "file_sha256") === migration.sha256,
      `Release ledger ordinal ${migration.ordinal} does not match the accepted manifest.`,
    );
  }
}

async function jsonRows(
  client: ReadonlyClickHouse,
  sql: string,
  maxResultRows: number,
): Promise<readonly Record<string, unknown>[]> {
  let text: string;
  try {
    text = await readonlyQuery(client, sql, maxResultRows);
  } catch {
    throw new ReleaseVerificationError("A readonly ClickHouse verification query failed.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ReleaseVerificationError("ClickHouse returned invalid verification JSON.");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as {data?: unknown}).data) ||
    !(parsed as {data: unknown[]}).data.every(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row),
    )
  ) {
    throw new ReleaseVerificationError("ClickHouse verification JSON has an invalid shape.");
  }
  return (parsed as {data: Record<string, unknown>[]}).data;
}

async function readonlyQuery(
  client: ReadonlyClickHouse,
  sql: string,
  maxResultRows?: number,
): Promise<string> {
  return client.query(sql, {readonly: 2,...(maxResultRows === undefined ? {} : {maxResultRows})});
}

function assertExactSet(actual: readonly string[], expected: readonly string[], label: string): void {
  const a = [...actual].sort();
  const e = [...expected].sort();
  requireCondition(a.length === e.length && a.every((value, index) => value === e[index]), `${label} drifted.`);
}

function objectName(row: Record<string, unknown>): string {
  return `${stringField(row, "database")}.${stringField(row, "name")}`;
}

function stringField(row: Record<string, unknown> | undefined, field: string): string {
  const value = row?.[field];
  if (typeof value !== "string") throw new ReleaseVerificationError(`Verification field ${field} is invalid.`);
  return value;
}

function numberField(row: Record<string, unknown> | undefined, field: string): number {
  const value = row?.[field];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ReleaseVerificationError(`Verification field ${field} is invalid.`);
  }
  return number;
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ReleaseVerificationError(message);
}

function isViewEngine(engine: string): boolean {
  return engine === "View" || engine === "MaterializedView";
}

function sqlStrings(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.split(".").map((part) => (/^[0-9]+$/u.test(part) ? Number(part) : -1));
  const a = parse(left);
  const b = parse(right);
  if (a.includes(-1)) throw new ReleaseVerificationError("ClickHouse version is invalid.");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    process.stderr.write(
      `${JSON.stringify({code: "CLICKHOUSE_SCHEMA_RELEASE_INVOCATION_INVALID",message: "Standalone verifier accepts no arguments."})}\n`,
    );
    process.exitCode = 2;
    return;
  }
  let client: ClickHouseClient;
  try {
    client = new ClickHouseClient(configFromEnv());
  } catch {
    process.stderr.write(
      `${JSON.stringify({code: "CLICKHOUSE_SCHEMA_RELEASE_CONFIGURATION_INVALID",message: "ClickHouse endpoint configuration is invalid."})}\n`,
    );
    process.exitCode = 2;
    return;
  }
  try {
    const release = await loadReleasePackage();
    const result = await verifyInstalledRelease(client, release);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error: unknown) {
    const code =
      error instanceof ReleasePackageError
        ? error.code
        : "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED";
    process.stderr.write(`${JSON.stringify({code,message: "ClickHouse schema release verification failed."})}\n`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (entry === import.meta.url) void main();
