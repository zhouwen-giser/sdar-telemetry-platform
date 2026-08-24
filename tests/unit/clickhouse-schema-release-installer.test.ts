import test from "node:test";
import assert from "node:assert/strict";

import {
  ClickHouseClient,
  type ClickHouseQueryOptions,
} from "../../packages/telemetry-clickhouse/src/index.js";
import {
  ClickHouseReleaseInstallerRuntime,
  classifyReleaseState,
  installerFailureDocument,
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
import {
  ReleaseVerificationError,
  type ReleaseVerificationResult,
} from "../../scripts/verify-clickhouse-schema-release.js";

test("fresh installer executes exact order and appends one ledger row after every migration", async () => {
  const release = await loadReleasePackage();
  const runtime = new FakeRuntime(freshState());
  const result = await installFreshRelease(release, runtime);

  assert.equal(result.status, "installed");
  assert.deepEqual(result.appliedOrdinals, Array.from({length: 23}, (_, ordinal) => ordinal));
  assert.equal(runtime.observeCalls, 1);
  assert.equal(runtime.createLedgerCalls, 1);
  assert.equal(runtime.verifyCalls, 1);
  assert.equal(runtime.ledgerRows.length, 23);
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
  const client = new ObserveStateTranscriptClient(release);
  const observedRuntime = new ClickHouseReleaseInstallerRuntime(
    client as unknown as ClickHouseClient,
  );
  let createLedgerCalls = 0;
  let statementCalls = 0;
  let appendCalls = 0;
  let verifyCalls = 0;
  let observation: ReleaseStateObservation | undefined;
  const runtime: ReleaseInstallerRuntime = {
    observeState: async () => {
      observation = await observedRuntime.observeState();
      return observation;
    },
    createLedger: async () => {
      createLedgerCalls += 1;
    },
    executeStatement: async () => {
      statementCalls += 1;
    },
    appendLedger: async () => {
      appendCalls += 1;
    },
    verify: async (loaded) => {
      verifyCalls += 1;
      return successfulVerification(loaded);
    },
  };
  const result = await installFreshRelease(release, runtime);

  assert.equal(result.status, "idempotent");
  assert.deepEqual(result.appliedOrdinals, []);
  assert.equal(verifyCalls, 1);
  assert.equal(createLedgerCalls, 0);
  assert.equal(statementCalls, 0);
  assert.equal(appendCalls, 0);
  assert.equal(client.insertCalls, 0);
  assert.equal(client.calls.length, 2);
  assert.equal(
    client.rawRows.every(
      (row) => typeof row["ordinal"] === "number" && typeof row["byte_size"] === "string",
    ),
    true,
  );
  assert.deepEqual(client.calls.map(({options}) => options), [
    {readonly: 2,maxResultRows: 30},
    {readonly: 2,maxResultRows: 30},
  ]);

  const inventorySql = client.calls[0]!.sql;
  assert.match(inventorySql, /SELECT kind,object_name AS name FROM \(/u);
  assert.match(
    inventorySql,
    /SELECT 'database' AS kind,name AS object_name FROM system\.databases WHERE name LIKE/u,
  );
  assert.match(
    inventorySql,
    /SELECT 'ledger' AS kind,concat\(database,'\.',name\) AS object_name FROM system\.tables WHERE name='sdar_clickhouse_schema_release_ledger'/u,
  );
  assert.doesNotMatch(
    inventorySql,
    /concat\(database,'\.',name\) AS name FROM system\.tables WHERE name=/u,
  );
  assert.doesNotMatch(inventorySql, /database\s*=\s*'default'/u);

  assert.ok(observation);
  assert.deepEqual(observation.databases, [...REQUIRED_DATABASES]);
  assert.deepEqual(observation.ledgerLocations, [LEDGER_TABLE]);
  assert.equal(observation.ledgerRows.length, 23);
  assert.deepEqual(
    observation.ledgerRows.map(({ordinal}) => ordinal),
    Array.from({length: 23}, (_, ordinal) => ordinal),
  );
  assert.equal(
    observation.ledgerRows.every(
      (row, ordinal) =>
        row.release_id === release.manifest.releaseId &&
        row.release_manifest_content_address === release.manifest.contentAddress.digest &&
        row.migration_set_content_address === release.manifest.migrationSetContentAddress &&
        row.byte_size === release.migrations[ordinal]!.bytes,
    ),
    true,
  );
  assert.equal(classifyReleaseState(release, observation), "idempotent");
});

test("observeState rejects invalid and unsafe ClickHouse numeric strings", async () => {
  const release = await loadReleasePackage();
  for (const byteSize of ["not-a-number",String(Number.MAX_SAFE_INTEGER + 1)]) {
    const rows = rawLedgerRows(release).map((row, index) =>
      index === 0 ? {...row,byte_size: byteSize} : row,
    );
    const client = new ObserveStateTranscriptClient(release, rows);
    const runtime = new ClickHouseReleaseInstallerRuntime(client as unknown as ClickHouseClient);
    await assert.rejects(() => runtime.observeState(), /invalid byte_size/u);
    assert.equal(client.calls.length, 2);
    assert.equal(client.insertCalls, 0);
  }
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

test("typed verifier cause survives post-install and replay installer serialization without SQL or secrets", async () => {
  const release = await loadReleasePackage();
  const cause = Object.assign(
    new Error(
      "ClickHouse request failed with HTTP 500: Code: 47. DB::Exception: SELECT 'installer-secret' password=hunter2 https://user:pw@clickhouse:8123/ (UNKNOWN_IDENTIFIER)",
    ),
    {code: "CLICKHOUSE_RESPONSE_ERROR"},
  );
  const verificationError = new ReleaseVerificationError(
    {
      assertionId: "critical-semantic-column",
      queryId: "system-columns-release-and-ledger",
      sqlClass: "readonly-system-columns-inventory",
      relation: "sdar_mart.evaluation_result_v15",
      column: "evaluation_origin",
    },
    "Critical semantic column is missing.",
    {cause,canonicalSql: "SELECT secret_sql_body FROM system.columns"},
  );

  for (const [state,stage,code] of [
    [freshState(), "post-install-verifier", "CLICKHOUSE_SCHEMA_RELEASE_VERIFY_FAILED"],
    [completeState(release), "exact-replay-verifier", "CLICKHOUSE_SCHEMA_RELEASE_CONFLICT"],
  ] as const) {
    const runtime = new FakeRuntime(state);
    runtime.verificationError = verificationError;
    let installerError: ReleaseInstallerError;
    try {
      await installFreshRelease(release, runtime);
      assert.fail("expected typed verifier failure");
    } catch (error: unknown) {
      assert.ok(error instanceof ReleaseInstallerError);
      installerError = error;
    }
    assert.equal(installerError.code, code);
    assert.equal(installerError.verificationError, verificationError);
    assert.equal(installerError.verificationStage, stage);
    assert.equal(installerError.cause, verificationError);
    assert.equal(runtime.verifyCalls, 1);

    const document = installerFailureDocument(installerError) as Record<string, unknown>;
    assert.equal(document["stage"], stage);
    assert.equal(document["assertionId"], "critical-semantic-column");
    assert.equal(document["queryId"], "system-columns-release-and-ledger");
    assert.equal(document["sqlClass"], "readonly-system-columns-inventory");
    assert.equal(document["relation"], "sdar_mart.evaluation_result_v15");
    assert.equal(document["column"], "evaluation_origin");
    assert.equal(document["errorClass"], "ClickHouseClientError");
    assert.equal(document["causeCode"], "CLICKHOUSE_RESPONSE_ERROR");
    assert.equal(document["clickHouseCode"], 47);
    const serialized = JSON.stringify(document);
    assert.match(serialized, /response details were redacted/u);
    for (const forbidden of [
      "secret_sql_body",
      "installer-secret",
      "hunter2",
      "clickhouse:8123",
      "user:pw",
      "password=",
      "UNKNOWN_IDENTIFIER",
      "canonicalSql",
      "stack",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  }
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
  assert.throws(
    () =>
      classifyReleaseState(release, {
        databases: [...REQUIRED_DATABASES],
        ledgerLocations: [LEDGER_TABLE,LEDGER_TABLE],
        ledgerRows: exact,
      }),
    hasInstallerCode("CLICKHOUSE_SCHEMA_RELEASE_CONFLICT"),
  );
  assert.throws(
    () =>
      classifyReleaseState(release, {
        databases: [...REQUIRED_DATABASES],
        ledgerLocations: [LEDGER_TABLE],
        ledgerRows: [...exact,{...exact[0]!,ordinal: release.migrations.length}],
      }),
    hasInstallerCode("CLICKHOUSE_SCHEMA_RELEASE_CONFLICT"),
  );
});

class ObserveStateTranscriptClient {
  readonly calls: Array<{readonly sql: string; readonly options: ClickHouseQueryOptions}> = [];
  insertCalls = 0;

  constructor(
    release: LoadedReleasePackage,
    readonly rawRows: readonly Record<string, unknown>[] = rawLedgerRows(release),
  ) {}

  async query(sql: string, options: ClickHouseQueryOptions = {}): Promise<string> {
    this.calls.push({sql,options});
    if (this.calls.length === 1) {
      return JSON.stringify({
        data: [
          ...REQUIRED_DATABASES.map((name) => ({kind: "database",name})),
          {kind: "ledger",name: LEDGER_TABLE},
        ],
      });
    }
    if (this.calls.length === 2 && sql.includes(`FROM ${LEDGER_TABLE} ORDER BY ordinal`)) {
      return JSON.stringify({data: this.rawRows});
    }
    throw new Error("unexpected observeState query");
  }

  async insert(): Promise<void> {
    this.insertCalls += 1;
    throw new Error("observeState transcript must not insert");
  }
}

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
  verificationError?: ReleaseVerificationError;

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
    if (this.verificationError !== undefined) throw this.verificationError;
    if (this.failVerify) throw new Error("injected verifier failure");
    return {
      schemaVersion: "sdar-telemetry.clickhouse-schema-release-verify/v1",
      releaseId: release.manifest.releaseId,
      releaseManifestContentAddress: release.manifest.contentAddress.digest,
      migrationSetContentAddress: release.manifest.migrationSetContentAddress,
      clickHouseVersion: "24.10.2.1",
      databases: 6,
      physicalTables: 311,
      views: 120,
      totalObjects: 431,
      ledgerRows: 23,
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

function rawLedgerRows(release: LoadedReleasePackage): readonly Record<string, unknown>[] {
  return release.migrations.map((migration) => ({
    release_id: release.manifest.releaseId,
    release_manifest_content_address: release.manifest.contentAddress.digest,
    migration_set_content_address: release.manifest.migrationSetContentAddress,
    ordinal: migration.ordinal,
    file_name: migration.file,
    byte_size: String(migration.bytes),
    file_sha256: migration.sha256,
  }));
}

function successfulVerification(release: LoadedReleasePackage): ReleaseVerificationResult {
  return {
    schemaVersion: "sdar-telemetry.clickhouse-schema-release-verify/v1",
    releaseId: release.manifest.releaseId,
    releaseManifestContentAddress: release.manifest.contentAddress.digest,
    migrationSetContentAddress: release.manifest.migrationSetContentAddress,
    clickHouseVersion: "24.10.2.1",
    databases: 6,
    physicalTables: 311,
    views: 120,
    totalObjects: 431,
    ledgerRows: 23,
    verified: true,
  };
}

function hasInstallerCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ReleaseInstallerError && error.code === code;
}
