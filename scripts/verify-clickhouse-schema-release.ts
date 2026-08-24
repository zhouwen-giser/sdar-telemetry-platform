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

export type VerificationStage =
  | "release-verifier"
  | "post-install-verifier"
  | "exact-replay-verifier"
  | "standalone-verifier";

export type VerificationAssertionId =
  | "migration-object-inventory"
  | "clickhouse-version"
  | "release-database-set"
  | "release-object-inventory"
  | "object-engine"
  | "writable-projection-table"
  | "required-projection-view"
  | "release-column-inventory"
  | "canonical-evidence-column"
  | "critical-semantic-column"
  | "ledger-columns"
  | "frozen-seed-catalog"
  | "ledger-table-descriptor"
  | "ledger-tuples"
  | "view-compilation"
  | "table-queryability";

export type VerificationQueryId =
  | "in-process-migration-object-derivation"
  | "clickhouse-version"
  | "system-databases-release-set"
  | "system-tables-release-inventory"
  | "system-columns-release-and-ledger"
  | "release-seed-aggregates"
  | "system-tables-ledger-descriptor"
  | "release-ledger-tuples"
  | "release-view-limit-zero"
  | "release-table-limit-zero";

export type VerificationSqlClass =
  | "in-process-no-sql"
  | "readonly-version"
  | "readonly-system-databases-inventory"
  | "readonly-system-tables-inventory"
  | "readonly-system-columns-inventory"
  | "readonly-release-seed-aggregates"
  | "readonly-ledger-descriptor"
  | "readonly-ledger-tuples"
  | "readonly-view-limit-zero"
  | "readonly-table-limit-zero";

export interface VerificationContext {
  readonly assertionId: VerificationAssertionId;
  readonly queryId: VerificationQueryId;
  readonly sqlClass: VerificationSqlClass;
  readonly relation?: string;
  readonly column?: string;
}

export interface PublicVerificationDiagnostic {
  readonly code: "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED";
  readonly stage: VerificationStage;
  readonly assertionId: VerificationAssertionId;
  readonly queryId: VerificationQueryId;
  readonly sqlClass: VerificationSqlClass;
  readonly relation?: string;
  readonly column?: string;
  readonly errorClass: "ReleaseVerificationError" | "ClickHouseClientError" | "Error" | "TypeError" | "SyntaxError";
  readonly causeCode?: string;
  readonly clickHouseCode?: number;
  readonly message: string;
}

export class ReleaseVerificationError extends Error {
  readonly code = "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED" as const;
  readonly stage = "release-verifier" as const;
  readonly assertionId: VerificationAssertionId;
  readonly queryId: VerificationQueryId;
  readonly sqlClass: VerificationSqlClass;
  readonly relation?: string;
  readonly column?: string;
  readonly errorClass: PublicVerificationDiagnostic["errorClass"];
  readonly causeCode?: string;
  readonly clickHouseCode?: number;
  readonly canonicalSql?: string;

  constructor(
    context: VerificationContext,
    message: string,
    options: {readonly cause?: unknown; readonly canonicalSql?: string} = {},
  ) {
    const causeCode = safeCauseCode(options.cause);
    const clickHouseCode = extractClickHouseCode(options.cause);
    const errorClass = safeErrorClass(options.cause, causeCode);
    const safeMessage = options.cause === undefined ? boundedOwnedMessage(message) : safeCauseMessage(options.cause, causeCode, clickHouseCode);
    super(safeMessage, options.cause === undefined ? undefined : {cause: options.cause});
    this.name = "ReleaseVerificationError";
    this.assertionId = context.assertionId;
    this.queryId = context.queryId;
    this.sqlClass = context.sqlClass;
    if (context.relation !== undefined) this.relation = context.relation;
    if (context.column !== undefined) this.column = context.column;
    this.errorClass = errorClass;
    if (causeCode !== undefined) this.causeCode = causeCode;
    if (clickHouseCode !== undefined) this.clickHouseCode = clickHouseCode;
    if (options.canonicalSql !== undefined) {
      Object.defineProperty(this, "canonicalSql", {
        value: options.canonicalSql,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  }
}

export function publicVerificationDiagnostic(
  error: ReleaseVerificationError,
  stage: VerificationStage,
): PublicVerificationDiagnostic {
  return {
    code: error.code,
    stage,
    assertionId: error.assertionId,
    queryId: error.queryId,
    sqlClass: error.sqlClass,
    ...(error.relation === undefined ? {} : {relation: error.relation}),
    ...(error.column === undefined ? {} : {column: error.column}),
    errorClass: error.errorClass,
    ...(error.causeCode === undefined ? {} : {causeCode: error.causeCode}),
    ...(error.clickHouseCode === undefined ? {} : {clickHouseCode: error.clickHouseCode}),
    message: error.message,
  };
}

const MINIMUM_CLICKHOUSE_VERSION = "24.10.2.1";
export const WRITABLE_PROJECTION_TABLES = Object.freeze([
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
export const REQUIRED_PROJECTION_VIEWS = Object.freeze([
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
export const CANONICAL_EVIDENCE_COLUMNS = Object.freeze([
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
export const CRITICAL_SEMANTIC_COLUMNS = Object.freeze([
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
  const derivationContext = verificationContext(
    "migration-object-inventory",
    "in-process-migration-object-derivation",
    "in-process-no-sql",
  );
  const expectedObjects = deriveExpectedObjects(release);
  const expectedTables = expectedObjects.filter(({kind}) => kind === "table");
  const expectedViews = expectedObjects.filter(({kind}) => kind === "view");
  requireCondition(
    expectedTables.length === 310 && expectedViews.length === 120 && expectedObjects.length === 430,
    derivationContext,
    "Migration-derived object inventory is not exactly 310 physical tables and 120 views.",
  );

  const versionContext = verificationContext(
    "clickhouse-version",
    "clickhouse-version",
    "readonly-version",
  );
  const versionRows = await jsonRows(
    client,
    "SELECT version() AS version FORMAT JSON",
    1,
    versionContext,
  );
  const version = stringField(versionRows[0], "version", versionContext);
  requireCondition(
    compareVersions(version, MINIMUM_CLICKHOUSE_VERSION, versionContext) >= 0,
    versionContext,
    `ClickHouse version must be at least ${MINIMUM_CLICKHOUSE_VERSION}.`,
  );

  const databaseContext = verificationContext(
    "release-database-set",
    "system-databases-release-set",
    "readonly-system-databases-inventory",
  );
  const databaseRows = await jsonRows(
    client,
    "SELECT name FROM system.databases WHERE name LIKE 'sdar\\_%' ORDER BY name FORMAT JSON",
    20,
    databaseContext,
  );
  const databases = databaseRows.map((row) => stringField(row, "name", databaseContext));
  assertExactSet(databases, REQUIRED_DATABASES, databaseContext, "release database inventory");

  const objectQueryContext = verificationContext(
    "release-object-inventory",
    "system-tables-release-inventory",
    "readonly-system-tables-inventory",
  );
  const objectRows = await jsonRows(
    client,
    `SELECT database,name,engine FROM system.tables WHERE database IN (${sqlStrings(REQUIRED_DATABASES)}) ORDER BY database,name FORMAT JSON`,
    500,
    objectQueryContext,
  );
  const actualObjects = new Map<string, string>();
  for (const row of objectRows) {
    const key = `${stringField(row, "database", objectQueryContext)}.${stringField(row, "name", objectQueryContext)}`;
    requireCondition(!actualObjects.has(key), objectQueryContext, "Duplicate release object inventory row exists.");
    actualObjects.set(key, stringField(row, "engine", objectQueryContext));
  }
  for (const table of WRITABLE_PROJECTION_TABLES) {
    const context = {...objectQueryContext,assertionId: "writable-projection-table" as const,relation: table};
    requireCondition(
      objectRows.some(
        (row) =>
          objectName(row, objectQueryContext) === table &&
          !isViewEngine(stringField(row, "engine", objectQueryContext)),
      ),
      context,
      `Required writable projection table ${table} is missing or is not physical.`,
    );
  }
  for (const view of REQUIRED_PROJECTION_VIEWS) {
    const context = {...objectQueryContext,assertionId: "required-projection-view" as const,relation: view};
    requireCondition(
      objectRows.some(
        (row) =>
          objectName(row, objectQueryContext) === view &&
          isViewEngine(stringField(row, "engine", objectQueryContext)),
      ),
      context,
      `Required projection view ${view} is missing or has the wrong engine kind.`,
    );
  }
  requireCondition(
    actualObjects.size === 430,
    objectQueryContext,
    "Installed release object count is not exactly 430.",
  );
  for (const expected of expectedObjects) {
    const key = `${expected.database}.${expected.name}`;
    const actualEngine = actualObjects.get(key);
    const relationContext = {...objectQueryContext,relation: key};
    requireCondition(actualEngine !== undefined, relationContext, `Required release object ${key} is missing.`);
    requireCondition(
      actualEngine === expected.engine,
      {...relationContext,assertionId: "object-engine"},
      `Release object ${key} has an engine mismatch.`,
    );
    actualObjects.delete(key);
  }
  requireCondition(
    Number(actualObjects.size) === 0,
    objectQueryContext,
    "Unexpected release object exists.",
  );
  const staleContext = {
    ...objectQueryContext,
    assertionId: "required-projection-view" as const,
    relation: "sdar_mart.v_benchmark_release_gate",
  };
  requireCondition(
    !objectRows.some(
      (row) =>
        stringField(row, "database", objectQueryContext) === "sdar_mart" &&
        stringField(row, "name", objectQueryContext) === "v_benchmark_release_gate",
    ),
    staleContext,
    "Stale near-name sdar_mart.v_benchmark_release_gate is forbidden.",
  );

  const columnsQueryContext = verificationContext(
    "release-column-inventory",
    "system-columns-release-and-ledger",
    "readonly-system-columns-inventory",
  );
  const columnRows = await jsonRows(
    client,
    `SELECT database,table,name,type,position FROM system.columns WHERE database IN (${sqlStrings(REQUIRED_DATABASES)}) OR (database='default' AND table='sdar_clickhouse_schema_release_ledger') ORDER BY database,table,position FORMAT JSON`,
    20_000,
    columnsQueryContext,
  );
  const columnNames = new Set(
    columnRows.map(
      (row) =>
        `${stringField(row, "database", columnsQueryContext)}.${stringField(row, "table", columnsQueryContext)}.${stringField(row, "name", columnsQueryContext)}`,
    ),
  );
  for (const column of CANONICAL_EVIDENCE_COLUMNS) {
    const context = {
      ...columnsQueryContext,
      assertionId: "canonical-evidence-column" as const,
      relation: "sdar_core.sdar_evidence_v1_record",
      column,
    };
    requireCondition(
      columnNames.has(`sdar_core.sdar_evidence_v1_record.${column}`),
      context,
      `Canonical evidence column ${column} is missing.`,
    );
  }
  for (const identity of CRITICAL_SEMANTIC_COLUMNS) {
    const {relation,column} = splitColumnIdentity(identity);
    const context = {
      ...columnsQueryContext,
      assertionId: "critical-semantic-column" as const,
      relation,
      column,
    };
    requireCondition(columnNames.has(identity), context, `Critical semantic column ${identity} is missing.`);
  }
  assertLedgerColumns(columnRows, {
    ...columnsQueryContext,
    assertionId: "ledger-columns",
    relation: LEDGER_TABLE,
  });

  const seedsContext = verificationContext(
    "frozen-seed-catalog",
    "release-seed-aggregates",
    "readonly-release-seed-aggregates",
  );
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
    seedsContext,
  );
  const seeds = seedRows[0];
  requireCondition(numberField(seeds, "releases", seedsContext) >= 1, seedsContext, "Benchmark contract release seed is missing.");
  requireCondition(numberField(seeds, "record_types", seedsContext) === 100, seedsContext, "Evidence record-type catalog count is not 100.");
  requireCondition(numberField(seeds, "source_mappings", seedsContext) === 100, seedsContext, "Evidence source-mapping count is not 100.");
  requireCondition(numberField(seeds, "operators", seedsContext) === 16, seedsContext, "Benchmark operator catalog count is not 16.");
  requireCondition(numberField(seeds, "relations", seedsContext) === 8, seedsContext, "Benchmark relation catalog count is not 8.");
  requireCondition(numberField(seeds, "invariants", seedsContext) === 12, seedsContext, "Benchmark invariant catalog count is not 12.");

  const ledgerDescriptorContext = verificationContext(
    "ledger-table-descriptor",
    "system-tables-ledger-descriptor",
    "readonly-ledger-descriptor",
    {relation: LEDGER_TABLE},
  );
  const ledgerTableRows = await jsonRows(
    client,
    "SELECT database,name,engine,sorting_key FROM system.tables WHERE name='sdar_clickhouse_schema_release_ledger' ORDER BY database FORMAT JSON",
    10,
    ledgerDescriptorContext,
  );
  requireCondition(
    ledgerTableRows.length === 1,
    ledgerDescriptorContext,
    "Release ledger table must exist exactly once.",
  );
  requireCondition(
    objectName(ledgerTableRows[0], ledgerDescriptorContext) === LEDGER_TABLE &&
      stringField(ledgerTableRows[0], "engine", ledgerDescriptorContext) === "MergeTree" &&
      stringField(ledgerTableRows[0], "sorting_key", ledgerDescriptorContext).replaceAll(" ", "") ===
        "release_id,ordinal",
    ledgerDescriptorContext,
    "Release ledger must be the exact default MergeTree ordered by release_id and ordinal.",
  );
  const ledgerTupleContext = verificationContext(
    "ledger-tuples",
    "release-ledger-tuples",
    "readonly-ledger-tuples",
    {relation: LEDGER_TABLE},
  );
  const ledgerRows = await jsonRows(
    client,
    `SELECT release_id,release_manifest_content_address,migration_set_content_address,ordinal,file_name,byte_size,file_sha256 FROM ${LEDGER_TABLE} ORDER BY ordinal FORMAT JSON`,
    30,
    ledgerTupleContext,
  );
  assertExactLedger(release, ledgerRows, ledgerTupleContext);

  for (const object of expectedViews) {
    const relation = `${object.database}.${object.name}`;
    const context = verificationContext(
      "view-compilation",
      "release-view-limit-zero",
      "readonly-view-limit-zero",
      {relation},
    );
    await checkedReadonlyQuery(
      client,
      `SELECT * FROM ${relation} LIMIT 0 FORMAT Null`,
      context,
      `Required view ${relation} did not compile.`,
    );
  }
  for (const object of expectedTables) {
    const relation = `${object.database}.${object.name}`;
    const context = verificationContext(
      "table-queryability",
      "release-table-limit-zero",
      "readonly-table-limit-zero",
      {relation},
    );
    await checkedReadonlyQuery(
      client,
      `SELECT * FROM ${relation} LIMIT 0 FORMAT Null`,
      context,
      `Required table ${relation} was not queryable.`,
    );
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

function assertLedgerColumns(
  rows: readonly Record<string, unknown>[],
  context: VerificationContext,
): void {
  const actual = rows
    .filter(
      (row) =>
        stringField(row, "database", context) === "default" &&
        stringField(row, "table", context) === "sdar_clickhouse_schema_release_ledger",
    )
    .map((row) => `${stringField(row, "name", context)} ${stringField(row, "type", context)}`);
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
    context,
    "Release ledger columns or order drifted.",
  );
}

function assertExactLedger(
  release: LoadedReleasePackage,
  rows: readonly Record<string, unknown>[],
  context: VerificationContext,
): void {
  requireCondition(rows.length === 22, context, "Release ledger must contain exactly 22 rows.");
  for (const migration of release.manifest.migrations) {
    const row = rows[migration.ordinal];
    requireCondition(
      row !== undefined,
      context,
      `Release ledger ordinal ${migration.ordinal} is missing.`,
    );
    requireCondition(
      stringField(row, "release_id", context) === release.manifest.releaseId &&
        stringField(row, "release_manifest_content_address", context) ===
          release.manifest.contentAddress.digest &&
        stringField(row, "migration_set_content_address", context) ===
          release.manifest.migrationSetContentAddress &&
        numberField(row, "ordinal", context) === migration.ordinal &&
        stringField(row, "file_name", context) === migration.file &&
        numberField(row, "byte_size", context) === migration.bytes &&
        stringField(row, "file_sha256", context) === migration.sha256,
      context,
      `Release ledger ordinal ${migration.ordinal} does not match the accepted manifest.`,
    );
  }
}

async function jsonRows(
  client: ReadonlyClickHouse,
  sql: string,
  maxResultRows: number,
  context: VerificationContext,
): Promise<readonly Record<string, unknown>[]> {
  let text: string;
  try {
    text = await readonlyQuery(client, sql, maxResultRows);
  } catch (cause: unknown) {
    throw new ReleaseVerificationError(context, "A readonly ClickHouse verification query failed.", {
      cause,
      canonicalSql: sql,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause: unknown) {
    throw new ReleaseVerificationError(context, "ClickHouse returned invalid verification JSON.", {
      cause: safeJsonParseCause(cause),
      canonicalSql: sql,
    });
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as {data?: unknown}).data) ||
    !(parsed as {data: unknown[]}).data.every(
      (row) => row !== null && typeof row === "object" && !Array.isArray(row),
    )
  ) {
    throw new ReleaseVerificationError(
      context,
      "ClickHouse verification JSON has an invalid shape.",
      {canonicalSql: sql},
    );
  }
  return (parsed as {data: Record<string, unknown>[]}).data;
}

async function checkedReadonlyQuery(
  client: ReadonlyClickHouse,
  sql: string,
  context: VerificationContext,
  failureMessage: string,
): Promise<void> {
  try {
    await readonlyQuery(client, sql);
  } catch (cause: unknown) {
    throw new ReleaseVerificationError(context, failureMessage, {cause,canonicalSql: sql});
  }
}

async function readonlyQuery(
  client: ReadonlyClickHouse,
  sql: string,
  maxResultRows?: number,
): Promise<string> {
  return client.query(sql, {readonly: 2,...(maxResultRows === undefined ? {} : {maxResultRows})});
}

function assertExactSet(
  actual: readonly string[],
  expected: readonly string[],
  context: VerificationContext,
  label: string,
): void {
  const a = [...actual].sort();
  const e = [...expected].sort();
  requireCondition(
    a.length === e.length && a.every((value, index) => value === e[index]),
    context,
    `${label} drifted.`,
  );
}

function objectName(row: Record<string, unknown> | undefined, context: VerificationContext): string {
  return `${stringField(row, "database", context)}.${stringField(row, "name", context)}`;
}

function stringField(
  row: Record<string, unknown> | undefined,
  field: string,
  context: VerificationContext,
): string {
  const value = row?.[field];
  if (typeof value !== "string") {
    throw new ReleaseVerificationError(context, `Verification field ${field} is invalid.`);
  }
  return value;
}

function numberField(
  row: Record<string, unknown> | undefined,
  field: string,
  context: VerificationContext,
): number {
  const value = row?.[field];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ReleaseVerificationError(context, `Verification field ${field} is invalid.`);
  }
  return number;
}

function requireCondition(
  condition: boolean,
  context: VerificationContext,
  message: string,
): asserts condition {
  if (!condition) throw new ReleaseVerificationError(context, message);
}

function isViewEngine(engine: string): boolean {
  return engine === "View" || engine === "MaterializedView";
}

function sqlStrings(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
}

function compareVersions(left: string, right: string, context: VerificationContext): number {
  const parse = (value: string): number[] => value.split(".").map((part) => (/^[0-9]+$/u.test(part) ? Number(part) : -1));
  const a = parse(left);
  const b = parse(right);
  if (a.includes(-1)) throw new ReleaseVerificationError(context, "ClickHouse version is invalid.");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function verificationContext(
  assertionId: VerificationAssertionId,
  queryId: VerificationQueryId,
  sqlClass: VerificationSqlClass,
  details: {readonly relation?: string; readonly column?: string} = {},
): VerificationContext {
  return {assertionId,queryId,sqlClass,...details};
}

function splitColumnIdentity(identity: string): {relation: string; column: string} {
  const parts = identity.split(".");
  return {relation: `${parts[0]}.${parts[1]}`,column: parts[2]!};
}

function safeCauseCode(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  const code = (cause as {code?: unknown}).code;
  return typeof code === "string" && SAFE_CLICKHOUSE_CAUSE_CODES.has(code) ? code : undefined;
}

const SAFE_CLICKHOUSE_CAUSE_CODES: ReadonlySet<string> = new Set([
  "CLICKHOUSE_CREDENTIAL_UNAVAILABLE",
  "CLICKHOUSE_QUERY_INVALID",
  "CLICKHOUSE_CONNECT_TIMEOUT",
  "CLICKHOUSE_REQUEST_TIMEOUT",
  "CLICKHOUSE_REQUEST_FAILED",
  "CLICKHOUSE_RESPONSE_INVALID",
  "CLICKHOUSE_RESPONSE_ERROR",
  "CLICKHOUSE_READONLY_INVALID",
  "CLICKHOUSE_MAX_RESULT_ROWS_INVALID",
]);

function extractClickHouseCode(cause: unknown): number | undefined {
  if (!(cause instanceof Error)) return undefined;
  const match = /\bCode:\s*([0-9]{1,6})\b/u.exec(cause.message);
  if (match === null) return undefined;
  const code = Number(match[1]);
  return Number.isSafeInteger(code) ? code : undefined;
}

function safeErrorClass(
  cause: unknown,
  causeCode: string | undefined,
): PublicVerificationDiagnostic["errorClass"] {
  if (causeCode !== undefined) return "ClickHouseClientError";
  if (cause instanceof SyntaxError) return "SyntaxError";
  if (cause instanceof TypeError) return "TypeError";
  if (cause instanceof Error) return "Error";
  return "ReleaseVerificationError";
}

function safeCauseMessage(
  cause: unknown,
  causeCode: string | undefined,
  clickHouseCode: number | undefined,
): string {
  if (causeCode === "CLICKHOUSE_RESPONSE_ERROR" && cause instanceof Error) {
    const httpStatus = /\bHTTP\s+([0-9]{3})\b/u.exec(cause.message)?.[1];
    const parts = [
      httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
      clickHouseCode === undefined ? undefined : `ClickHouse code ${clickHouseCode}`,
    ].filter((part): part is string => part !== undefined);
    return boundedOwnedMessage(
      parts.length === 0
        ? "ClickHouse rejected the verification query; response details were redacted."
        : `ClickHouse rejected the verification query (${parts.join(", ")}); response details were redacted.`,
    );
  }
  const messages: Readonly<Record<string, string>> = Object.freeze({
    CLICKHOUSE_CONNECT_TIMEOUT: "ClickHouse connection timed out before response headers were received.",
    CLICKHOUSE_REQUEST_TIMEOUT: "ClickHouse verification request timed out.",
    CLICKHOUSE_REQUEST_FAILED: "ClickHouse verification request failed.",
    CLICKHOUSE_RESPONSE_INVALID: "ClickHouse verification response could not be read.",
    CLICKHOUSE_CREDENTIAL_UNAVAILABLE: "ClickHouse credential was unavailable.",
    CLICKHOUSE_QUERY_INVALID: "ClickHouse verification query was rejected before transport.",
    CLICKHOUSE_READONLY_INVALID: "ClickHouse readonly verification option was invalid.",
    CLICKHOUSE_MAX_RESULT_ROWS_INVALID: "ClickHouse result-bound verification option was invalid.",
  });
  if (causeCode !== undefined && messages[causeCode] !== undefined) return messages[causeCode];
  return "Verification operation failed; underlying details were redacted.";
}

function boundedOwnedMessage(message: string): string {
  return message.replace(/[\r\n\t]+/gu, " ").replace(/\s{2,}/gu, " ").trim().slice(0, 320);
}

function safeJsonParseCause(cause: unknown): Error {
  const error = new SyntaxError("ClickHouse returned invalid JSON; response content was redacted.");
  if (cause instanceof Error && cause.name === "TypeError") error.name = "TypeError";
  return error;
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
    process.stderr.write(`${JSON.stringify(standaloneVerificationFailureDocument(error))}\n`);
    process.exitCode = 1;
  }
}

export function standaloneVerificationFailureDocument(error: unknown): object {
  if (error instanceof ReleaseVerificationError) {
    return publicVerificationDiagnostic(error, "standalone-verifier");
  }
  if (error instanceof ReleasePackageError) {
    return {code: error.code,message: "ClickHouse schema release package validation failed."};
  }
  return {
    code: "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED",
    stage: "standalone-verifier",
    assertionId: "migration-object-inventory",
    queryId: "in-process-migration-object-derivation",
    sqlClass: "in-process-no-sql",
    errorClass: "Error",
    message: "ClickHouse schema release verification failed; underlying details were redacted.",
  };
}

const entry = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (entry === import.meta.url) void main();
