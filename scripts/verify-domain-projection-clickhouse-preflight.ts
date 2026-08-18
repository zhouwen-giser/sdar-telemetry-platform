import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";

import {
  ClickHouseClient,
  configFromEnv,
  type ClickHouseQueryOptions,
} from "../packages/telemetry-clickhouse/src/index.js";

type JsonObject = Record<string, unknown>;

const readOnly: ClickHouseQueryOptions = Object.freeze({readonly: 2, maxResultRows: 100_000});
const contractRoot = path.resolve("integrations/sdar-clickhouse/1.5.1-rc.2");
const client = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));

try {
  const contract = await readJson(path.join(contractRoot, "contract.json"));
  const sourceLock = await readJson(path.join(contractRoot, "source-lock.json"));
  const expectedDescriptors = await readJson(
    path.join(contractRoot, "required-object-descriptors.json"),
  );
  const databases = requiredStringArray(contract, "databases");
  const databaseSql = databases.map((value) => `'${value}'`).join(",");

  const server = await queryOne(`SELECT version() AS version FORMAT JSON`);
  assertEqual(
    requiredString(server, "version"),
    requiredString(requiredObject(contract, "release"), "serverVersion"),
    "CLICKHOUSE_SERVER_VERSION_DRIFT",
  );

  const databaseRows = await queryJson(
    `SELECT name,engine FROM system.databases WHERE name IN (${databaseSql}) ORDER BY name FORMAT JSON`,
  );
  assertEqual(databaseRows.length, databases.length, "CLICKHOUSE_DATABASE_COUNT_DRIFT");
  for (const row of databaseRows) {
    assertEqual(requiredString(row, "engine"), "Atomic", "CLICKHOUSE_DATABASE_ENGINE_DRIFT");
  }

  const tables = await queryJson(
    `SELECT database,name,engine,partition_key,sorting_key,primary_key,sampling_key,storage_policy
     FROM system.tables WHERE database IN (${databaseSql}) ORDER BY database,name FORMAT JSON`,
  );
  const columns = await queryJson(
    `SELECT database,table,position,name,type,default_kind,default_expression,compression_codec,
            is_in_partition_key,is_in_sorting_key,is_in_primary_key,is_in_sampling_key
     FROM system.columns WHERE database IN (${databaseSql}) ORDER BY database,table,position FORMAT JSON`,
  );
  const descriptorLock = requiredObject(sourceLock, "descriptorLock");
  assertEqual(tables.length, requiredNumber(descriptorLock, "objectCount"), "OBJECT_COUNT_DRIFT");
  assertEqual(columns.length, requiredNumber(descriptorLock, "columnCount"), "COLUMN_COUNT_DRIFT");
  assertEqual(
    canonicalSha256(tables),
    requiredString(descriptorLock, "tableDescriptorHash"),
    "TABLE_DESCRIPTOR_DRIFT",
  );
  assertEqual(
    canonicalSha256(columns),
    requiredString(descriptorLock, "columnDescriptorHash"),
    "COLUMN_DESCRIPTOR_DRIFT",
  );

  const expectedObjects = requiredObjectArray(expectedDescriptors, "objects");
  const tableByName = new Map(tables.map((row) => [qualifiedTable(row), row] as const));
  for (const expected of expectedObjects) {
    const name = requiredString(expected, "name");
    const actualTable = tableByName.get(name);
    if (actualTable === undefined) fail("CLICKHOUSE_REQUIRED_OBJECT_MISSING");
    assertCanonicalEqual(actualTable, requiredObject(expected, "table"), "REQUIRED_TABLE_DRIFT");
    const [database, table] = splitName(name);
    const actualColumns = columns.filter(
      (row) => row["database"] === database && row["table"] === table,
    );
    assertCanonicalEqual(
      actualColumns,
      requiredObjectArray(expected, "columns"),
      "REQUIRED_COLUMN_DRIFT",
    );
  }

  const release = requiredObject(contract, "release");
  const actualRelease = await queryOne(
    `SELECT release_version,migration_range,package_generation,release_descriptor_hash,
            schema_contract_hash,source_contract_count,episode_seal_contract_count,
            projection_identity_count,projection_set_count,active_domain_projection_count
     FROM sdar_meta.v_schema_contract_release_current FORMAT JSON`,
  );
  const releaseFields: ReadonlyArray<readonly [string, string]> = [
    ["release_version", "releaseVersion"],
    ["migration_range", "migrationRange"],
    ["package_generation", "packageGeneration"],
    ["release_descriptor_hash", "releaseDescriptorHash"],
    ["schema_contract_hash", "schemaContractHash"],
  ];
  for (const [actualField, expectedField] of releaseFields) {
    assertEqual(
      requiredString(actualRelease, actualField),
      requiredString(release, expectedField),
      "RELEASE_LOCK_DRIFT",
    );
  }
  const countFields: ReadonlyArray<readonly [string, string]> = [
    ["source_contract_count", "sourceContractCount"],
    ["episode_seal_contract_count", "episodeSealContractCount"],
    ["projection_identity_count", "projectionIdentityCount"],
    ["projection_set_count", "projectionSetCount"],
    ["active_domain_projection_count", "activeDomainProjectionCount"],
  ];
  for (const [actualField, expectedField] of countFields) {
    assertEqual(
      numeric(actualRelease[actualField]),
      requiredNumber(release, expectedField),
      "RELEASE_COUNT_DRIFT",
    );
  }

  const actualSources = await queryJson(
    `SELECT source_contract_id AS id,source_contract_version AS version,
            source_database AS database,source_table AS table,schema_hash AS schemaHash
     FROM sdar_meta.v_domain_source_contract_definition_current
     ORDER BY source_contract_id FORMAT JSON`,
  );
  assertCanonicalEqual(actualSources, requiredObjectArray(contract, "sources"), "SOURCE_LOCK_DRIFT");

  const actualProjectionVersions = await queryJson(
    `SELECT projection_id AS id,projection_version AS version,mapper_id AS mapperId,
            mapper_version AS mapperVersion,concat(source_database,'.',source_table) AS source,
            concat(target_database,'.',target_table) AS target,status
     FROM sdar_meta.v_domain_projection_version_current
     WHERE startsWith(projection_id,'application_to_embodied.dp-')
     ORDER BY projection_id FORMAT JSON`,
  );
  const expectedProjections = requiredObjectArray(contract, "projections").map((entry) => ({
    id: requiredString(entry, "id"),
    version: requiredString(entry, "version"),
    mapperId: requiredString(entry, "mapperId"),
    mapperVersion: requiredString(entry, "mapperVersion"),
    source: requiredString(entry, "source"),
    target: requiredString(entry, "target"),
    status: requiredString(entry, "status"),
  }));
  assertCanonicalEqual(actualProjectionVersions, expectedProjections, "PROJECTION_LOCK_DRIFT");

  const actualSets = await queryJson(
    `SELECT projection_set_id AS id,projection_set_version AS version,member_count AS memberCount,
            status,content_hash AS contentHash
     FROM sdar_meta.v_domain_projection_set_definition_current
     ORDER BY projection_set_id,projection_set_version FORMAT JSON`,
  );
  assertCanonicalEqual(actualSets, requiredObjectArray(contract, "projectionSets"), "SET_LOCK_DRIFT");

  const viewResults: Array<{view: string; columns: number}> = [];
  for (const view of requiredStringArray(contract, "views")) {
    const response = await queryDocument(`SELECT * FROM ${view} LIMIT 0 FORMAT JSON`);
    const meta = response["meta"];
    if (!Array.isArray(meta) || !meta.every(isObject)) fail("CLICKHOUSE_VIEW_METADATA_INVALID");
    const names = meta.map((entry) => requiredString(entry, "name"));
    if (names.some((name) => name.includes("."))) fail("CLICKHOUSE_VIEW_DOTTED_COLUMN_DRIFT");
    viewResults.push({view, columns: names.length});
  }

  console.log(
    JSON.stringify({
      event: "domain_projection.clickhouse_preflight",
      status: "passed",
      releaseVersion: requiredString(release, "releaseVersion"),
      migrationRange: requiredString(release, "migrationRange"),
      objects: tables.length,
      columns: columns.length,
      requiredObjects: expectedObjects.length,
      sources: actualSources.length,
      projections: actualProjectionVersions.length,
      projectionSets: actualSets.length,
      activeProjections: numeric(actualRelease["active_domain_projection_count"]),
      views: viewResults,
      readonly: 2,
    }),
  );
} catch (error) {
  const candidate = isObject(error) ? error["code"] : undefined;
  const errorCode =
    typeof candidate === "string" && /^[A-Z0-9_]{1,128}$/u.test(candidate)
      ? candidate
      : "CLICKHOUSE_SCHEMA_CONTRACT_DRIFT";
  console.error(
    JSON.stringify({
      event: "domain_projection.clickhouse_preflight",
      status: "failed",
      errorCode,
    }),
  );
  process.exitCode = 1;
}

async function queryJson(sql: string): Promise<JsonObject[]> {
  const value = await queryDocument(sql);
  const data = value["data"];
  if (!Array.isArray(data) || !data.every(isObject)) fail("CLICKHOUSE_RESPONSE_INVALID");
  return data;
}

async function queryOne(sql: string): Promise<JsonObject> {
  const data = await queryJson(sql);
  if (data.length !== 1 || data[0] === undefined) fail("CLICKHOUSE_RESPONSE_INVALID");
  return data[0];
}

async function queryDocument(sql: string): Promise<JsonObject> {
  const raw = await client.query(sql, readOnly);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("CLICKHOUSE_RESPONSE_INVALID");
  }
  if (!isObject(value)) fail("CLICKHOUSE_RESPONSE_INVALID");
  return value;
}

async function readJson(filename: string): Promise<JsonObject> {
  const value: unknown = JSON.parse(await readFile(filename, "utf8"));
  if (!isObject(value)) fail("CLICKHOUSE_CONTRACT_INVALID");
  return value;
}

function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("CLICKHOUSE_DESCRIPTOR_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  fail("CLICKHOUSE_DESCRIPTOR_INVALID");
}

function assertCanonicalEqual(actual: unknown, expected: unknown, code: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(`CLICKHOUSE_SCHEMA_CONTRACT_${code}`);
}

function assertEqual(actual: unknown, expected: unknown, code: string): void {
  if (actual !== expected) fail(`CLICKHOUSE_SCHEMA_CONTRACT_${code}`);
}

function qualifiedTable(row: JsonObject): string {
  return `${requiredString(row, "database")}.${requiredString(row, "name")}`;
}

function splitName(value: string): [string, string] {
  const parts = value.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    fail("CLICKHOUSE_CONTRACT_INVALID");
  }
  return [parts[0], parts[1]];
}

function requiredObject(value: JsonObject, field: string): JsonObject {
  const candidate = value[field];
  if (!isObject(candidate)) fail("CLICKHOUSE_CONTRACT_INVALID");
  return candidate;
}

function requiredObjectArray(value: JsonObject, field: string): JsonObject[] {
  const candidate = value[field];
  if (!Array.isArray(candidate) || !candidate.every(isObject)) fail("CLICKHOUSE_CONTRACT_INVALID");
  return candidate;
}

function requiredStringArray(value: JsonObject, field: string): string[] {
  const candidate = value[field];
  if (!Array.isArray(candidate) || !candidate.every((entry) => typeof entry === "string")) {
    fail("CLICKHOUSE_CONTRACT_INVALID");
  }
  return candidate;
}

function requiredString(value: JsonObject, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") fail("CLICKHOUSE_CONTRACT_INVALID");
  return candidate;
}

function requiredNumber(value: JsonObject, field: string): number {
  const candidate = value[field];
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) {
    fail("CLICKHOUSE_CONTRACT_INVALID");
  }
  return candidate;
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("CLICKHOUSE_RESPONSE_INVALID");
  return parsed;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string): never {
  throw Object.assign(new Error(code), {code});
}
