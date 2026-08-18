import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

import {ClickHouseClient, configFromEnv} from "../packages/telemetry-clickhouse/src/index.js";

const lock = JSON.parse(await readFile("integrations/smpp-providerops/v1.1/source-lock.json", "utf8")) as {
  clickHouse: Record<string, unknown>;
};
const expected = lock.clickHouse;
const client = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));

try {
  const release = await queryOne(`SELECT version() AS server_version,release_version,migration_range,
    release_descriptor_hash,schema_contract_hash
    FROM sdar_meta.v_schema_contract_release_current FORMAT JSON`);
  assertEqual(release["server_version"], expected["serverVersion"]);
  assertEqual(release["release_version"], expected["releaseVersion"]);
  assertEqual(release["migration_range"], expected["migrationRange"]);
  assertEqual(release["release_descriptor_hash"], expected["releaseDescriptorHash"]);
  assertEqual(release["schema_contract_hash"], expected["schemaContractHash"]);

  const targets = await queryRows(`SELECT database,table,position,name,type,default_kind,default_expression,
    compression_codec,is_in_partition_key,is_in_sorting_key,is_in_primary_key,is_in_sampling_key
    FROM system.columns WHERE database='sdar_core'
      AND table IN ('external_entity_relation_fact','external_provider_fact')
    ORDER BY database,table,position FORMAT JSON`);
  assertEqual(targets.length, expected["targetColumnCount"]);
  assertEqual(canonicalHash(targets), expected["targetColumnDescriptorHash"]);

  const viewNames = [
    "v_smpp_execution_latest_progress", "v_smpp_provider_task_timeline",
    "v_smpp_resource_current_health", "v_smpp_resource_current_state",
    "v_sdar_smpp_execution_topology", "v_sdar_smpp_task_reconciliation",
  ];
  const views = await queryRows(`SELECT database,table,position,name,type,default_kind,default_expression,
    compression_codec,is_in_partition_key,is_in_sorting_key,is_in_primary_key,is_in_sampling_key
    FROM system.columns WHERE database='sdar_core'
      AND table IN (${viewNames.map((value) => `'${value}'`).join(",")})
    ORDER BY database,table,position FORMAT JSON`);
  assertEqual(views.length, expected["viewColumnCount"]);
  assertEqual(canonicalHash(views), expected["viewColumnDescriptorHash"]);
  for (const view of expected["views"] as string[]) {
    await client.query(`SELECT * FROM ${view} LIMIT 0 FORMAT JSON`, {readonly: 2, maxResultRows: 1_000});
  }
  console.log(JSON.stringify({event: "smpp_providerops.clickhouse_preflight", status: "passed", releaseVersion: expected["releaseVersion"], targets: 2, targetColumns: targets.length, views: 6, viewColumns: views.length, readonly: 2}));
} catch (error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "SMPP_SCHEMA_DRIFT";
  console.error(JSON.stringify({event: "smpp_providerops.clickhouse_preflight", status: "failed", errorCode: /^[A-Z0-9_]{1,128}$/u.test(code) ? code : "SMPP_SCHEMA_DRIFT"}));
  process.exitCode = 1;
}

async function queryRows(sql: string): Promise<Record<string, unknown>[]> {
  const document = JSON.parse(await client.query(sql, {readonly: 2, maxResultRows: 1_000})) as {data?: unknown};
  if (!Array.isArray(document.data)) throw Object.assign(new Error("invalid response"), {code: "SMPP_SCHEMA_DRIFT"});
  return document.data as Record<string, unknown>[];
}

async function queryOne(sql: string): Promise<Record<string, unknown>> {
  const rows = await queryRows(sql);
  if (rows.length !== 1) throw Object.assign(new Error("invalid release"), {code: "SMPP_SCHEMA_DRIFT"});
  return rows[0]!;
}

function assertEqual(actual: unknown, wanted: unknown): void {
  if (actual !== wanted) throw Object.assign(new Error("contract drift"), {code: "SMPP_SCHEMA_DRIFT"});
}

function canonicalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  throw Object.assign(new Error("invalid descriptor"), {code: "SMPP_SCHEMA_DRIFT"});
}
