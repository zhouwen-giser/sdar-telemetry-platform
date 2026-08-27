import { readFile } from "node:fs/promises";
import {
  ClickHouseClient,
  configFromEnv,
} from "../../../packages/telemetry-clickhouse/src/index.js";
import { loadConfig } from "../../../packages/telemetry-config/src/index.js";
import { ControlPostgres } from "../../../packages/telemetry-control-postgres/src/index.js";
import { stableCode } from "../../../packages/telemetry-control-postgres/src/domain-runtime.js";
import { createDomainProjectionWorkerApi } from "./server.js";
import { ClickHouseDomainSchemaPreflight } from "./schema-preflight.js";
import { DomainRuntime } from "./runtime.js";

const configuration = loadConfig();
const database = new ControlPostgres(await databaseUrl());
const clickHouse = new ClickHouseClient(configFromEnv());
// Existing deployments remain shadow-capped and do not acquire an implicit global scope.
const scoped =
  process.env["DOMAIN_TENANT_ID"] !== undefined ||
  process.env["DOMAIN_PROJECT_ID"] !== undefined;
const runtime = scoped
  ? new DomainRuntime(
      database,
      clickHouse,
      await ClickHouseDomainSchemaPreflight.load(clickHouse),
      {
        tenantId: required("DOMAIN_TENANT_ID"),
        projectId: required("DOMAIN_PROJECT_ID"),
      },
      configuration.domainProjection,
    )
  : undefined;
await runtime?.initialize();
const server = createDomainProjectionWorkerApi(
  runtime ?? {
    snapshot: async () => ({
      controlPostgresReady: await database.health(),
      clickHouseReady: false,
      schemaContractReady: false,
      projections: [],
    }),
  },
);
server.listen(
  configuration.domainProjection.healthPort,
  process.env["DOMAIN_PROJECTION_BIND_HOST"] ?? "127.0.0.1",
  () => {
    process.stdout.write(
      `${JSON.stringify({ event: "domain_projection_worker.ready", enabled: configuration.domainProjection.enabled, maxMode: configuration.domainProjection.maxMode })}\n`,
    );
  },
);
let stopped = false;
let active: Promise<void> = Promise.resolve();
const tick = (): void => {
  if (stopped || runtime === undefined) return;
  active = runtime.processOnce().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ event: "domain_projection_worker.cycle_failed", errorCode: stableCode(error) })}\n`,
    );
  });
};
const timer = setInterval(tick, configuration.domainProjection.pollIntervalMs);
tick();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopped = true;
    clearInterval(timer);
    server.close(() => {
      void active
        .then(() => database.close())
        .then(() => {
          process.exitCode = 0;
        });
    });
  });
}
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "" || value.length > 512)
    throw new Error("DOMAIN_SCOPE_REQUIRED");
  return value;
}
async function databaseUrl(): Promise<string> {
  const inline = process.env["CONTROL_POSTGRES_URL"],
    file = process.env["CONTROL_POSTGRES_URL_FILE"];
  if ((inline === undefined) === (file === undefined))
    throw new Error("CONTROL_POSTGRES_CONFIGURATION_INVALID");
  const value = inline ?? (await readFile(file!, "utf8")).trim();
  if (!value || /[\r\n]/u.test(value))
    throw new Error("CONTROL_POSTGRES_CONFIGURATION_INVALID");
  return value;
}
