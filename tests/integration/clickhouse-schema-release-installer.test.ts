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
  "authorized empty ClickHouse installs and exact replay performs zero mutations",
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
    let injected = false;
    const runtime: ReleaseInstallerRuntime = {
      observeState: () => delegate.observeState(),
      createLedger: () => delegate.createLedger(),
      executeStatement: async (sql: string, migration: LoadedMigration, statementIndex: number) => {
        if (!injected && migration.ordinal === 3 && statementIndex === 0) {
          injected = true;
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
    assert.equal(injected, true);
    await assert.rejects(
      () => installFreshRelease(release, delegate),
      hasCode("CLICKHOUSE_SCHEMA_RELEASE_PARTIAL"),
    );
  },
);

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ReleaseInstallerError && error.code === code;
}
