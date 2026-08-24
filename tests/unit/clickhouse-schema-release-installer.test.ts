import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyReleaseState,
  installFreshRelease,
  ReleaseInstallerError,
  type ReleaseInstallerRuntime,
  type ReleaseLedgerRow,
  type ReleaseStateObservation,
} from "../../scripts/install-clickhouse-schema-release.js";
import {
  LEDGER_TABLE,
  loadReleasePackage,
  REQUIRED_DATABASES,
  type LoadedMigration,
  type LoadedReleasePackage,
} from "../../scripts/sync-clickhouse-schema-release.js";
import type {ReleaseVerificationResult} from "../../scripts/verify-clickhouse-schema-release.js";

test("fresh installer executes exact order and appends one ledger row after every migration", async () => {
  const release = await loadReleasePackage();
  const runtime = new FakeRuntime(freshState());
  const result = await installFreshRelease(release, runtime);

  assert.equal(result.status, "installed");
  assert.deepEqual(result.appliedOrdinals, Array.from({length: 22}, (_, ordinal) => ordinal));
  assert.equal(runtime.observeCalls, 1);
  assert.equal(runtime.createLedgerCalls, 1);
  assert.equal(runtime.verifyCalls, 1);
  assert.equal(runtime.ledgerRows.length, 22);
  assert.deepEqual(runtime.ledgerRows.map(({ordinal}) => ordinal), result.appliedOrdinals);
  assert.equal(
    runtime.statementCalls,
    release.migrations.reduce((total, migration) => total + migration.statements.length, 0),
  );
  assert.deepEqual(runtime.events, [
    "create-ledger",
    ...release.migrations.flatMap((migration) => [
      ...migration.statements.map((_, index) => `statement:${migration.ordinal}:${index}`),
      `ledger:${migration.ordinal}`,
    ]),
  ]);
  for (const migration of release.migrations) {
    const ledgerIndex = runtime.events.indexOf(`ledger:${migration.ordinal}`);
    assert.notEqual(ledgerIndex, -1);
    assert.equal(
      runtime.events.slice(0, ledgerIndex).filter((event) => event.startsWith(`statement:${migration.ordinal}:`)).length,
      migration.statements.length,
    );
  }
});

test("exact complete replay verifies with zero mutation", async () => {
  const release = await loadReleasePackage();
  const runtime = new FakeRuntime(completeState(release));
  const result = await installFreshRelease(release, runtime);
  assert.equal(result.status, "idempotent");
  assert.deepEqual(result.appliedOrdinals, []);
  assert.equal(runtime.observeCalls, 1);
  assert.equal(runtime.verifyCalls, 1);
  assert.equal(runtime.createLedgerCalls, 0);
  assert.equal(runtime.statementCalls, 0);
  assert.equal(runtime.ledgerRows.length, 0);
});

test("partial and conflict classifications fail closed before mutation", async () => {
  const release = await loadReleasePackage();
  const firstRow = ledgerRows(release).slice(0, 1);
  const cases: readonly [ReleaseStateObservation, string][] = [
    [{databases: [REQUIRED_DATABASES[0]],ledgerLocations: [],ledgerRows: []}, "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"],
    [{databases: [],ledgerLocations: [LEDGER_TABLE],ledgerRows: firstRow}, "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"],
    [{databases: [...REQUIRED_DATABASES],ledgerLocations: [LEDGER_TABLE],ledgerRows: firstRow}, "CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"],
    [{databases: ["sdar_unknown"],ledgerLocations: [],ledgerRows: []}, "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT"],
    [{databases: [],ledgerLocations: ["sdar_core.sdar_clickhouse_schema_release_ledger"],ledgerRows: []}, "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT"],
    [
      {
        databases: [...REQUIRED_DATABASES],
        ledgerLocations: [LEDGER_TABLE],
        ledgerRows: ledgerRows(release).map((row, index) =>
          index === 4 ? {...row,file_sha256: "0".repeat(64)} : row,
        ),
      },
      "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT",
    ],
  ];
  for (const [state, code] of cases) {
    const runtime = new FakeRuntime(state);
    await assert.rejects(
      () => installFreshRelease(release, runtime),
      (error: unknown) => error instanceof ReleaseInstallerError && error.code === code,
    );
    assert.equal(runtime.createLedgerCalls, 0);
    assert.equal(runtime.statementCalls, 0);
    assert.equal(runtime.ledgerRows.length, 0);
    assert.equal(runtime.verifyCalls, 0);
  }
});

test("injected mid-sequence failure is attempted once and requires reset", async () => {
  const release = await loadReleasePackage();
  const runtime = new FakeRuntime(freshState());
  runtime.failStatement = {ordinal: 3,index: 0};
  await assert.rejects(
    () => installFreshRelease(release, runtime),
    (error: unknown) =>
      error instanceof ReleaseInstallerError && error.code === "CLICKHOUSE_SCHEMA_RELEASE_MIGRATION_FAILED",
  );
  assert.equal(runtime.failedStatementCalls, 1);
  assert.deepEqual(runtime.ledgerRows.map(({ordinal}) => ordinal), [0, 1, 2]);
  assert.equal(runtime.verifyCalls, 0);
});

test("ledger and verifier failures are typed non-retryable failures", async () => {
  const release = await loadReleasePackage();
  const ledgerFailure = new FakeRuntime(freshState());
  ledgerFailure.failLedgerOrdinal = 2;
  await assert.rejects(
    () => installFreshRelease(release, ledgerFailure),
    hasInstallerCode("CLICKHOUSE_SCHEMA_RELEASE_LEDGER_FAILED"),
  );
  assert.equal(ledgerFailure.ledgerAttempts.filter((ordinal) => ordinal === 2).length, 1);

  const verifyFailure = new FakeRuntime(freshState());
  verifyFailure.failVerify = true;
  await assert.rejects(
    () => installFreshRelease(release, verifyFailure),
    hasInstallerCode("CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED"),
  );
  assert.equal(verifyFailure.verifyCalls, 1);
});

test("classifyReleaseState rejects a gap and duplicate without resume", async () => {
  const release = await loadReleasePackage();
  const exact = ledgerRows(release);
  assert.throws(
    () =>
      classifyReleaseState(release, {
        databases: [...REQUIRED_DATABASES],
        ledgerLocations: [LEDGER_TABLE],
        ledgerRows: [exact[0]!,exact[2]!],
      }),
    hasInstallerCode("CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"),
  );
  assert.throws(
    () =>
      classifyReleaseState(release, {
        databases: [...REQUIRED_DATABASES],
        ledgerLocations: [LEDGER_TABLE],
        ledgerRows: [exact[0]!,exact[0]!],
      }),
    hasInstallerCode("CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"),
  );
});

class FakeRuntime implements ReleaseInstallerRuntime {
  readonly events: string[] = [];
  readonly ledgerRows: ReleaseLedgerRow[] = [];
  readonly ledgerAttempts: number[] = [];
  observeCalls = 0;
  createLedgerCalls = 0;
  statementCalls = 0;
  failedStatementCalls = 0;
  verifyCalls = 0;
  failStatement?: {ordinal: number; index: number};
  failLedgerOrdinal?: number;
  failVerify = false;

  constructor(private readonly state: ReleaseStateObservation) {}

  async observeState(): Promise<ReleaseStateObservation> {
    this.observeCalls += 1;
    return this.state;
  }

  async createLedger(): Promise<void> {
    this.createLedgerCalls += 1;
    this.events.push("create-ledger");
  }

  async executeStatement(_sql: string, migration: LoadedMigration, statementIndex: number): Promise<void> {
    this.statementCalls += 1;
    this.events.push(`statement:${migration.ordinal}:${statementIndex}`);
    if (
      this.failStatement?.ordinal === migration.ordinal &&
      this.failStatement.index === statementIndex
    ) {
      this.failedStatementCalls += 1;
      throw new Error("injected failure");
    }
  }

  async appendLedger(row: ReleaseLedgerRow): Promise<void> {
    this.ledgerAttempts.push(row.ordinal);
    if (this.failLedgerOrdinal === row.ordinal) throw new Error("injected ledger failure");
    this.ledgerRows.push(row);
    this.events.push(`ledger:${row.ordinal}`);
  }

  async verify(release: LoadedReleasePackage): Promise<ReleaseVerificationResult> {
    this.verifyCalls += 1;
    if (this.failVerify) throw new Error("injected verifier failure");
    return {
      schemaVersion: "sdar-telemetry.clickhouse-schema-release-verify/v1",
      releaseId: release.manifest.releaseId,
      releaseManifestContentAddress: release.manifest.contentAddress.digest,
      migrationSetContentAddress: release.manifest.migrationSetContentAddress,
      clickHouseVersion: "24.10.2.1",
      databases: 6,
      physicalTables: 310,
      views: 120,
      totalObjects: 430,
      ledgerRows: 22,
      verified: true,
    };
  }
}

function freshState(): ReleaseStateObservation {
  return {databases: [],ledgerLocations: [],ledgerRows: []};
}

function completeState(release: LoadedReleasePackage): ReleaseStateObservation {
  return {
    databases: [...REQUIRED_DATABASES],
    ledgerLocations: [LEDGER_TABLE],
    ledgerRows: ledgerRows(release),
  };
}

function ledgerRows(release: LoadedReleasePackage): ReleaseLedgerRow[] {
  return release.migrations.map((migration) => ({
    release_id: release.manifest.releaseId,
    release_manifest_content_address: release.manifest.contentAddress.digest,
    migration_set_content_address: release.manifest.migrationSetContentAddress,
    ordinal: migration.ordinal,
    file_name: migration.file,
    byte_size: migration.bytes,
    file_sha256: migration.sha256,
  }));
}

function hasInstallerCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ReleaseInstallerError && error.code === code;
}
