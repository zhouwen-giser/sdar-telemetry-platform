import test from "node:test";
import assert from "node:assert/strict";

import {ClickHouseClient,configFromEnv} from "../../packages/telemetry-clickhouse/src/index.js";
import {
  ClickHouseReleaseInstallerRuntime,
  installFreshRelease,
  ReleaseInstallerError,
  type ReleaseInstallerRuntime,
} from "../../scripts/install-clickhouse-schema-release.js";
import {loadReleasePackage,type LoadedMigration} from "../../scripts/sync-clickhouse-schema-release.js";

const scenario = process.env["SDAR_CLICKHOUSE_SCHEMA_RELEASE_INTEGRATION_SCENARIO"];

test(
  "authorized empty ClickHouse recovers after reset, installs, and exact replay performs zero mutations",
  {skip: scenario !== "install-replay" ? "requires Run Controller-authorized empty ClickHouse" : false},
  async () => {
    const release = await loadReleasePackage();
    const runtime = new ClickHouseReleaseInstallerRuntime(new ClickHouseClient(configFromEnv()));
    const installed = await installFreshRelease(release, runtime);
    assert.equal(installed.status, "installed");
    const replayed = await installFreshRelease(release, runtime);
    assert.equal(replayed.status, "idempotent");
    assert.deepEqual(replayed.appliedOrdinals, []);
  },
);

test(
  "authorized injected migration failure leaves partial state and next invocation requires reset",
  {skip: scenario !== "fault-reset-required" ? "requires a separate Run Controller-authorized empty ClickHouse" : false},
  async () => {
    const release = await loadReleasePackage();
    const delegate = new ClickHouseReleaseInstallerRuntime(new ClickHouseClient(configFromEnv()));
    let injectionAttempts = 0;
    const runtime: ReleaseInstallerRuntime = {
      observeState: () => delegate.observeState(),
      createLedger: () => delegate.createLedger(),
      executeStatement: async (sql: string, migration: LoadedMigration, statementIndex: number) => {
        if (migration.ordinal === 23 && statementIndex === 0) {
          injectionAttempts += 1;
          throw new Error("targeted integration fault");
        }
        await delegate.executeStatement(sql, migration, statementIndex);
      },
      appendLedger: (row) => delegate.appendLedger(row),
      verify: (loaded) => delegate.verify(loaded),
    };
    await assert.rejects(
      () => installFreshRelease(release, runtime),
      hasCode("CLICKHOUSE_SCHEMA_RELEASE_MIGRATION_FAILED"),
    );
    assert.equal(injectionAttempts, 1);
    const durablePartial = await delegate.observeState();
    assert.deepEqual(
      durablePartial.ledgerRows.map(({ordinal}) => ordinal),
      Array.from({length: 23}, (_, ordinal) => ordinal),
    );
    const secondInvocationMutations = {createLedger: 0,executeStatement: 0,appendLedger: 0};
    const sameVolumeRuntime: ReleaseInstallerRuntime = {
      observeState: () => delegate.observeState(),
      createLedger: async () => {
        secondInvocationMutations.createLedger += 1;
        await delegate.createLedger();
      },
      executeStatement: async (sql, migration, statementIndex) => {
        secondInvocationMutations.executeStatement += 1;
        await delegate.executeStatement(sql, migration, statementIndex);
      },
      appendLedger: async (row) => {
        secondInvocationMutations.appendLedger += 1;
        await delegate.appendLedger(row);
      },
      verify: (loaded) => delegate.verify(loaded),
    };
    await assert.rejects(
      () => installFreshRelease(release, sameVolumeRuntime),
      hasCode("CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"),
    );
    assert.deepEqual(secondInvocationMutations, {
      createLedger: 0,
      executeStatement: 0,
      appendLedger: 0,
    });
  },
);

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ReleaseInstallerError && error.code === code;
}
