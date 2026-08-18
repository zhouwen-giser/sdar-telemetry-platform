import {readFile} from "node:fs/promises";

import {
  ClickHouseClient,
  configFromEnv,
} from "../../../packages/telemetry-clickhouse/src/index.js";
import {loadConfig} from "../../../packages/telemetry-config/src/index.js";
import {ControlPostgres} from "../../../packages/telemetry-control-postgres/src/index.js";
import {
  DOMAIN_PROJECTION_DESCRIPTORS,
} from "../../../packages/telemetry-projection-registry/src/domain.js";
import {
  createDomainProjectionWorkerApi,
  type DomainProjectionMetric,
  type DomainProjectionRuntimeSnapshot,
} from "./server.js";

const RELEASE = "1.5.1-rc.2";
const SCHEMA_HASH = "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8";
const DESCRIPTOR_HASH = "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335";

const configuration = loadConfig();
const controlPostgres = new ControlPostgres(await controlPostgresUrl());
const clickHouse = new ClickHouseClient(configFromEnv());
const server = createDomainProjectionWorkerApi({snapshot});
const bindHost = process.env["DOMAIN_PROJECTION_BIND_HOST"] ?? "127.0.0.1";

server.listen(configuration.domainProjection.healthPort, bindHost, () => {
  process.stdout.write(`${JSON.stringify({
    event: "domain_projection_worker.ready",
    host: bindHost,
    port: configuration.domainProjection.healthPort,
    enabled: configuration.domainProjection.enabled,
    maxMode: configuration.domainProjection.maxMode,
    workerId: configuration.domainProjection.workerId,
  })}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => { void controlPostgres.close().finally(() => process.exit(0)); });
  });
}

async function snapshot(): Promise<DomainProjectionRuntimeSnapshot> {
  let controlPostgresReady = false;
  let clickHouseReady = false;
  let schemaContractReady = false;
  let projections: readonly DomainProjectionMetric[] = emptyMetrics();
  try { controlPostgresReady = await controlPostgres.health(); } catch { controlPostgresReady = false; }
  try {
    const document = parseDocument(await clickHouse.query(
      `SELECT release_version,schema_contract_hash,release_descriptor_hash
       FROM sdar_meta.v_schema_contract_release_current LIMIT 1 FORMAT JSON`,
      {readonly: 2, maxResultRows: 1},
    ));
    const release = document.data[0];
    clickHouseReady = release !== undefined;
    schemaContractReady = release?.["release_version"] === RELEASE &&
      release["schema_contract_hash"] === SCHEMA_HASH &&
      release["release_descriptor_hash"] === DESCRIPTOR_HASH;
    projections = await projectionMetrics();
  } catch {
    clickHouseReady = false;
    schemaContractReady = false;
  }
  return Object.freeze({clickHouseReady, controlPostgresReady, schemaContractReady, projections});
}

async function projectionMetrics(): Promise<readonly DomainProjectionMetric[]> {
  const health = parseDocument(await clickHouse.query(
    `SELECT projection_id,checkpoint_watermark,produced_count,skipped_count,failed_count,
            unresolved_blocking_dlq_count,schema_drift_status,last_run_updated_at
     FROM sdar_meta.v_domain_projection_health
     WHERE startsWith(projection_id,'application_to_embodied.dp-')
     ORDER BY projection_id LIMIT 100 FORMAT JSON`,
    {readonly: 2, maxResultRows: 100},
  )).data;
  const byId = new Map(health.map((row) => [requiredString(row, "projection_id"), row] as const));
  const now = Date.now();
  return Object.freeze(DOMAIN_PROJECTION_DESCRIPTORS.map((descriptor) => {
    const row = byId.get(descriptor.definition.projectionId);
    const watermark = timestamp(row?.["checkpoint_watermark"]);
    return Object.freeze({
      projectionId: descriptor.definition.projectionId,
      input: 0,
      produced: unsigned(row?.["produced_count"]),
      skipped: unsigned(row?.["skipped_count"]),
      failed: unsigned(row?.["failed_count"]),
      duplicate: 0,
      checkpointWatermarkMs: watermark,
      lagMs: watermark === 0 ? 0 : Math.max(0, now - watermark),
      openBlockingDeadLetters: unsigned(row?.["unresolved_blocking_dlq_count"]),
      schemaDrift: row?.["schema_drift_status"] !== undefined && row["schema_drift_status"] !== "none",
      lastSuccessfulRunMs: timestamp(row?.["last_run_updated_at"]),
      leaseOwner: "",
      leaseExpiryMs: 0,
      readySeals: 0,
      expectedSeals: 0,
    });
  }));
}

function emptyMetrics(): readonly DomainProjectionMetric[] {
  return Object.freeze(DOMAIN_PROJECTION_DESCRIPTORS.map((descriptor) => Object.freeze({
    projectionId: descriptor.definition.projectionId,
    input: 0, produced: 0, skipped: 0, failed: 0, duplicate: 0,
    checkpointWatermarkMs: 0, lagMs: 0, openBlockingDeadLetters: 0,
    schemaDrift: false, lastSuccessfulRunMs: 0, leaseOwner: "", leaseExpiryMs: 0,
    readySeals: 0, expectedSeals: 0,
  })));
}

function parseDocument(text: string): {data: Record<string, unknown>[]} {
  const value = JSON.parse(text) as {data?: unknown};
  if (!Array.isArray(value.data) || !value.data.every(isObject)) throw new Error("DOMAIN_WORKER_RESPONSE_INVALID");
  return {data: value.data};
}
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requiredString(value: Record<string, unknown>, field: string): string { const result = value[field]; if (typeof result !== "string" || result === "") throw new Error("DOMAIN_WORKER_RESPONSE_INVALID"); return result; }
function unsigned(value: unknown): number { if (value === undefined) return 0; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("DOMAIN_WORKER_RESPONSE_INVALID"); return parsed; }
function timestamp(value: unknown): number { if (value === undefined || value === null || value === "") return 0; const parsed = Date.parse(String(value)); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("DOMAIN_WORKER_RESPONSE_INVALID"); return parsed; }

async function controlPostgresUrl(): Promise<string> {
  const inline = process.env["CONTROL_POSTGRES_URL"];
  const file = process.env["CONTROL_POSTGRES_URL_FILE"];
  if ((inline === undefined) === (file === undefined)) throw new Error("CONTROL_POSTGRES_CONFIGURATION_INVALID");
  const value = inline ?? (await readFile(file!, "utf8")).trim();
  if (value.trim() === "" || /[\r\n]/u.test(value)) throw new Error("CONTROL_POSTGRES_CONFIGURATION_INVALID");
  return value;
}
