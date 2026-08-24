import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

import {
  ClickHouseClient,
  configFromEnv,
  type ClickHouseQueryOptions,
} from "../packages/telemetry-clickhouse/src/index.js";
import {
  LEDGER_TABLE,
  loadReleasePackage,
  REQUIRED_DATABASES,
  ReleasePackageError,
  type LoadedMigration,
  type LoadedReleasePackage,
} from "./sync-clickhouse-schema-release.js";
import {
  publicVerificationDiagnostic,
  ReleaseVerificationError,
  verifyInstalledRelease,
  type ReleaseVerificationResult,
  type VerificationStage,
} from "./verify-clickhouse-schema-release.js";

export type InstallerErrorCode =
  | "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"
  | "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT"
  | "CLICKHOUSE_SCHEMA_RELEASE_MIGRATION_FAILED"
  | "CLICKHOUSE_SCHEMA_RELEASE_LEDGER_FAILED"
  | "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED"
  | "CLICKHOUSE_SCHEMA_RELEASE_FAILED";

export interface ReleaseLedgerRow {
  readonly release_id: string;
  readonly release_manifest_content_address: string;
  readonly migration_set_content_address: string;
  readonly ordinal: number;
  readonly file_name: string;
  readonly byte_size: number;
  readonly file_sha256: string;
  readonly applied_at?: string;
}

export interface ReleaseStateObservation {
  readonly databases: readonly string[];
  readonly ledgerLocations: readonly string[];
  readonly ledgerRows: readonly ReleaseLedgerRow[];
}

export interface ReleaseInstallerRuntime {
  observeState(): Promise<ReleaseStateObservation>;
  createLedger(): Promise<void>;
  executeStatement(sql: string, migration: LoadedMigration, statementIndex: number): Promise<void>;
  appendLedger(row: ReleaseLedgerRow): Promise<void>;
  verify(release: LoadedReleasePackage): Promise<ReleaseVerificationResult>;
}

export interface ReleaseInstallResult {
  readonly schemaVersion: "sdar-telemetry.clickhouse-schema-release-install/v1";
  readonly releaseId: string;
  readonly releaseManifestContentAddress: string;
  readonly migrationSetContentAddress: string;
  readonly status: "installed" | "idempotent";
  readonly appliedOrdinals: readonly number[];
  readonly verified: true;
}

export class ReleaseInstallerError extends Error {
  readonly code: InstallerErrorCode;
  readonly verificationError?: ReleaseVerificationError;
  readonly verificationStage?: VerificationStage;

  constructor(
    code: InstallerErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly verificationError?: ReleaseVerificationError;
      readonly verificationStage?: VerificationStage;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : {cause: options.cause});
    this.name = "ReleaseInstallerError";
    this.code = code;
    if (options.verificationError !== undefined) this.verificationError = options.verificationError;
    if (options.verificationStage !== undefined) this.verificationStage = options.verificationStage;
  }
}

export class ClickHouseReleaseInstallerRuntime implements ReleaseInstallerRuntime {
  constructor(private readonly client: ClickHouseClient) {}

  async observeState(): Promise<ReleaseStateObservation> {
    const inventory = await jsonRows(
      this.client,
      `SELECT kind,object_name AS name FROM (
        SELECT 'database' AS kind,name AS object_name FROM system.databases WHERE name LIKE 'sdar\\_%'
        UNION ALL
        SELECT 'ledger' AS kind,concat(database,'.',name) AS object_name FROM system.tables WHERE name='sdar_clickhouse_schema_release_ledger'
      ) ORDER BY kind,name FORMAT JSON`,
      30,
    );
    const databases = inventory
      .filter((row) => stringField(row, "kind") === "database")
      .map((row) => stringField(row, "name"));
    const ledgerLocations = inventory
      .filter((row) => stringField(row, "kind") === "ledger")
      .map((row) => stringField(row, "name"));
    const ledgerRows = ledgerLocations.includes(LEDGER_TABLE)
      ? await jsonRows(
          this.client,
          `SELECT release_id,release_manifest_content_address,migration_set_content_address,ordinal,file_name,byte_size,file_sha256 FROM ${LEDGER_TABLE} ORDER BY ordinal FORMAT JSON`,
          30,
        ).then((rows) => rows.map(parseLedgerRow))
      : [];
    return {databases,ledgerLocations,ledgerRows};
  }

  async createLedger(): Promise<void> {
    await this.client.query(`CREATE TABLE ${LEDGER_TABLE}
    (
      release_id String,
      release_manifest_content_address String,
      migration_set_content_address String,
      ordinal UInt8,
      file_name String,
      byte_size UInt64,
      file_sha256 FixedString(64),
      applied_at DateTime64(3, 'UTC')
    )
    ENGINE = MergeTree
    ORDER BY (release_id, ordinal)`);
  }

  async executeStatement(
    sql: string,
    _migration: LoadedMigration,
    _statementIndex: number,
  ): Promise<void> {
    await this.client.query(sql);
  }

  async appendLedger(row: ReleaseLedgerRow): Promise<void> {
    await this.client.insert(LEDGER_TABLE, [{...row,applied_at: new Date().toISOString()}]);
  }

  async verify(release: LoadedReleasePackage): Promise<ReleaseVerificationResult> {
    return verifyInstalledRelease(this.client, release);
  }
}

export async function installFreshRelease(
  release: LoadedReleasePackage,
  runtime: ReleaseInstallerRuntime,
): Promise<ReleaseInstallResult> {
  let observation: ReleaseStateObservation;
  try {
    observation = await runtime.observeState();
  } catch {
    throw new ReleaseInstallerError(
      "CLICKHOUSE_SCHEMA_RELEASE_FAILED",
      "Unable to classify the ClickHouse schema release state.",
    );
  }
  const classification = classifyReleaseState(release, observation);
  if (classification === "idempotent") {
    try {
      await runtime.verify(release);
    } catch (cause: unknown) {
      if (cause instanceof ReleaseVerificationError) {
        throw verifierInstallerError(
          "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
          cause,
          "exact-replay-verifier",
        );
      }
      throw new ReleaseInstallerError(
        "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
        "Exact ledger replay failed schema pre-verification and requires an empty-volume reset.",
        {cause},
      );
    }
    return result(release, "idempotent", []);
  }

  try {
    await runtime.createLedger();
  } catch {
    throw new ReleaseInstallerError(
      "CLICKHOUSE_SCHEMA_RELEASE_LEDGER_FAILED",
      "Release ledger creation failed; the non-transactional target requires an empty-volume reset.",
    );
  }
  const appliedOrdinals: number[] = [];
  for (const migration of release.migrations) {
    for (let index = 0; index < migration.statements.length; index += 1) {
      try {
        await runtime.executeStatement(migration.statements[index]!, migration, index);
      } catch {
        throw new ReleaseInstallerError(
          "CLICKHOUSE_SCHEMA_RELEASE_MIGRATION_FAILED",
          `Migration ordinal ${migration.ordinal} failed; the partial target requires an empty-volume reset.`,
        );
      }
    }
    try {
      await runtime.appendLedger(expectedLedgerRow(release, migration));
    } catch {
      throw new ReleaseInstallerError(
        "CLICKHOUSE_SCHEMA_RELEASE_LEDGER_FAILED",
        `Ledger append after migration ordinal ${migration.ordinal} failed; the partial target requires an empty-volume reset.`,
      );
    }
    appliedOrdinals.push(migration.ordinal);
  }
  try {
    await runtime.verify(release);
  } catch (cause: unknown) {
    if (cause instanceof ReleaseVerificationError) {
      throw verifierInstallerError(
        "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED",
        cause,
        "post-install-verifier",
      );
    }
    throw new ReleaseInstallerError(
      "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED",
      "Installed release verification failed; the target requires an empty-volume reset.",
      {cause},
    );
  }
  return result(release, "installed", appliedOrdinals);
}

export function classifyReleaseState(
  release: LoadedReleasePackage,
  observation: ReleaseStateObservation,
): "fresh" | "idempotent" {
  const databases = [...observation.databases].sort();
  const expectedDatabases = [...REQUIRED_DATABASES].sort();
  const unexpectedDatabases = databases.filter(
    (database) => !REQUIRED_DATABASES.includes(database as (typeof REQUIRED_DATABASES)[number]),
  );
  if (unexpectedDatabases.length > 0) {
    throw new ReleaseInstallerError(
      "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
      "Unexpected sdar_* database exists; an empty-volume reset is required.",
    );
  }
  if (
    observation.ledgerLocations.some((location) => location !== LEDGER_TABLE) ||
    observation.ledgerLocations.filter((location) => location === LEDGER_TABLE).length > 1
  ) {
    throw new ReleaseInstallerError(
      "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
      "Release ledger exists outside its exact default location.",
    );
  }
  const ledgerPresent = observation.ledgerLocations.length === 1;
  if (!ledgerPresent) {
    if (observation.ledgerRows.length > 0) {
      throw new ReleaseInstallerError(
        "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
        "Ledger rows were observed without the exact ledger table.",
      );
    }
    if (databases.length === 0) return "fresh";
    throw new ReleaseInstallerError(
      "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL",
      "A release database exists without a complete exact ledger; reset the empty volume.",
    );
  }

  assertLedgerTupleIntegrity(release, observation.ledgerRows);
  const exactDatabases =
    databases.length === expectedDatabases.length &&
    databases.every((database, index) => database === expectedDatabases[index]);
  if (observation.ledgerRows.length === release.migrations.length && exactDatabases) {
    return "idempotent";
  }
  throw new ReleaseInstallerError(
    "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL",
    "Release ledger/database state is partial; reset the empty volume instead of resuming.",
  );
}

function assertLedgerTupleIntegrity(
  release: LoadedReleasePackage,
  rows: readonly ReleaseLedgerRow[],
): void {
  const ordinals = new Set<number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.ordinal) || row.ordinal < 0 || row.ordinal >= release.migrations.length) {
      throw new ReleaseInstallerError(
        "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
        "Release ledger contains an extra ordinal.",
      );
    }
    if (ordinals.has(row.ordinal)) {
      throw new ReleaseInstallerError(
        "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL",
        "Release ledger contains a duplicate ordinal and cannot be resumed.",
      );
    }
    ordinals.add(row.ordinal);
    const expected = expectedLedgerRow(release, release.migrations[row.ordinal]!);
    if (
      row.release_id !== expected.release_id ||
      row.release_manifest_content_address !== expected.release_manifest_content_address ||
      row.migration_set_content_address !== expected.migration_set_content_address ||
      row.file_name !== expected.file_name ||
      row.byte_size !== expected.byte_size ||
      row.file_sha256 !== expected.file_sha256
    ) {
      throw new ReleaseInstallerError(
        "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
        `Release ledger tuple at ordinal ${row.ordinal} conflicts with the accepted manifest.`,
      );
    }
  }
  if (rows.length < release.migrations.length) {
    const sorted = [...ordinals].sort((a, b) => a - b);
    const isPrefix = sorted.every((ordinal, index) => ordinal === index);
    throw new ReleaseInstallerError(
      "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL",
      isPrefix
        ? "Release ledger is a strict prefix and cannot be resumed."
        : "Release ledger contains a gap and cannot be resumed.",
    );
  }
}

function expectedLedgerRow(
  release: LoadedReleasePackage,
  migration: LoadedMigration,
): ReleaseLedgerRow {
  return {
    release_id: release.manifest.releaseId,
    release_manifest_content_address: release.manifest.contentAddress.digest,
    migration_set_content_address: release.manifest.migrationSetContentAddress,
    ordinal: migration.ordinal,
    file_name: migration.file,
    byte_size: migration.bytes,
    file_sha256: migration.sha256,
  };
}

function result(
  release: LoadedReleasePackage,
  status: "installed" | "idempotent",
  appliedOrdinals: readonly number[],
): ReleaseInstallResult {
  return {
    schemaVersion: "sdar-telemetry.clickhouse-schema-release-install/v1",
    releaseId: release.manifest.releaseId,
    releaseManifestContentAddress: release.manifest.contentAddress.digest,
    migrationSetContentAddress: release.manifest.migrationSetContentAddress,
    status,
    appliedOrdinals,
    verified: true,
  };
}

async function jsonRows(
  client: ClickHouseClient,
  sql: string,
  maxResultRows: number,
): Promise<readonly Record<string, unknown>[]> {
  const text = await client.query(sql, {readonly: 2,maxResultRows});
  const parsed = JSON.parse(text) as {data?: unknown};
  if (
    !Array.isArray(parsed.data) ||
    !parsed.data.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))
  ) {
    throw new Error("invalid ClickHouse JSON");
  }
  return parsed.data as Record<string, unknown>[];
}

function parseLedgerRow(row: Record<string, unknown>): ReleaseLedgerRow {
  return {
    release_id: stringField(row, "release_id"),
    release_manifest_content_address: stringField(row, "release_manifest_content_address"),
    migration_set_content_address: stringField(row, "migration_set_content_address"),
    ordinal: numberField(row, "ordinal"),
    file_name: stringField(row, "file_name"),
    byte_size: numberField(row, "byte_size"),
    file_sha256: stringField(row, "file_sha256"),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`invalid ${key}`);
  return value;
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`invalid ${key}`);
  return number;
}

function verifierInstallerError(
  code: "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED" | "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
  verificationError: ReleaseVerificationError,
  stage: "post-install-verifier" | "exact-replay-verifier",
): ReleaseInstallerError {
  return new ReleaseInstallerError(
    code,
    `${verificationError.message} Empty-volume reset is required.`,
    {cause: verificationError,verificationError,verificationStage: stage},
  );
}

export function installerFailureDocument(error: unknown): object {
  if (error instanceof ReleaseInstallerError) {
    if (error.verificationError !== undefined && error.verificationStage !== undefined) {
      const diagnostic = publicVerificationDiagnostic(
        error.verificationError,
        error.verificationStage,
      );
      const {code: _verificationCode,...details} = diagnostic;
      return {code: error.code,...details,message: boundedInstallerMessage(error.message)};
    }
    return {code: error.code,message: boundedInstallerMessage(error.message)};
  }
  if (error instanceof ReleasePackageError) {
    return {code: error.code,message: "ClickHouse schema release package validation failed."};
  }
  if (error instanceof ReleaseVerificationError) {
    return publicVerificationDiagnostic(error, "post-install-verifier");
  }
  return {
    code: "CLICKHOUSE_SCHEMA_RELEASE_FAILED",
    message: "ClickHouse schema release installation failed; underlying details were redacted.",
  };
}

function boundedInstallerMessage(message: string): string {
  return message.replace(/[\r\n\t]+/gu, " ").replace(/\s{2,}/gu, " ").trim().slice(0, 400);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--fresh") {
    process.stderr.write(
      `${JSON.stringify({code: "CLICKHOUSE_SCHEMA_RELEASE_INVOCATION_INVALID",message: "Installer requires exactly one --fresh argument."})}\n`,
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
    const resultDocument = await installFreshRelease(
      release,
      new ClickHouseReleaseInstallerRuntime(client),
    );
    process.stdout.write(`${JSON.stringify(resultDocument)}\n`);
  } catch (error: unknown) {
    process.stderr.write(`${JSON.stringify(installerFailureDocument(error))}\n`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (entry === import.meta.url) void main();
