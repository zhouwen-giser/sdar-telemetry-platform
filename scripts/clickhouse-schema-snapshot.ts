import {mkdir, chmod, writeFile} from "node:fs/promises";
import path from "node:path";

import {
  ClickHouseClient,
  configFromEnv,
  type ClickHouseQueryOptions,
} from "../packages/telemetry-clickhouse/src/index.js";
import {assertSafeSqlIdentifier} from "../packages/telemetry-validation/src/index.js";

const databases = [
  "sdar_meta",
  "sdar_core",
  "sdar_commander",
  "sdar_npc",
  "sdar_embodied",
  "sdar_mart",
] as const;
const databaseSet = new Set<string>(databases);
const snapshotLabel = process.env["CLICKHOUSE_SCHEMA_SNAPSHOT_LABEL"];
if (snapshotLabel !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(snapshotLabel)) {
  throw new Error("CLICKHOUSE_SCHEMA_SNAPSHOT_LABEL is invalid.");
}
const outputDirectory = path.resolve(
  "reports/clickhouse/192.168.1.7-schema-snapshot",
  ...(snapshotLabel === undefined ? [] : [snapshotLabel]),
);
const readOnlyOptions: ClickHouseQueryOptions = Object.freeze({
  readonly: 2,
  maxResultRows: 100_000,
});

interface JsonQueryResult<T> {
  data: T[];
}

interface TableRow {
  database: string;
  name: string;
  engine: string;
  partition_key: string;
  sorting_key: string;
  primary_key: string;
  sampling_key: string;
  storage_policy: string;
}

const credentialPrefix = process.env["CLICKHOUSE_SCHEMA_CONFIG_PREFIX"] ?? "CLICKHOUSE_QUERY_";
if (credentialPrefix !== "CLICKHOUSE_QUERY_" && credentialPrefix !== "CLICKHOUSE_") {
  throw new Error("CLICKHOUSE_SCHEMA_CONFIG_PREFIX must be CLICKHOUSE_QUERY_ or CLICKHOUSE_.");
}
const client = new ClickHouseClient(configFromEnv(credentialPrefix));
const databaseList = databases.map((database) => `'${database}'`).join(",");

const server = await queryJson<Record<string, unknown>>(`
SELECT version() AS version, currentDatabase() AS current_database
FORMAT JSON
`);
const databaseRows = await queryJson<Record<string, unknown>>(`
SELECT name, engine
FROM system.databases
WHERE name IN (${databaseList})
ORDER BY name
FORMAT JSON
`);
const tables = await queryJson<TableRow>(`
SELECT
  database,
  name,
  engine,
  partition_key,
  sorting_key,
  primary_key,
  sampling_key,
  storage_policy
FROM system.tables
WHERE database IN (${databaseList})
ORDER BY database, name
FORMAT JSON
`);
const columns = await queryJson<Record<string, unknown>>(`
SELECT
  database,
  table,
  position,
  name,
  type,
  default_kind,
  default_expression,
  compression_codec,
  is_in_partition_key,
  is_in_sorting_key,
  is_in_primary_key,
  is_in_sampling_key
FROM system.columns
WHERE database IN (${databaseList})
ORDER BY database, table, position
FORMAT JSON
`);

const showCreate = await mapWithConcurrency(tables, 4, async (table) => {
  if (!databaseSet.has(table.database)) throw new Error("Unexpected database in schema snapshot.");
  const qualifiedName = assertSafeSqlIdentifier(`${table.database}.${table.name}`);
  const ddl = await client.query(`SHOW CREATE TABLE ${qualifiedName} FORMAT TSVRaw`, {
    readonly: 2,
    maxResultRows: 2,
  });
  return {database: table.database, name: table.name, engine: table.engine, ddl: ddl.trimEnd()};
});

await mkdir(outputDirectory, {recursive: true, mode: 0o700});
await chmod(outputDirectory, 0o700);
await Promise.all([
  writePrivateJson("server.json", server),
  writePrivateJson("databases.json", databaseRows),
  writePrivateJson("tables.json", tables),
  writePrivateJson("columns.json", columns),
  writePrivateJson("show-create.json", showCreate),
  writePrivateJson("snapshot-manifest.json", {
    observedAt: new Date().toISOString(),
    phase: snapshotLabel ?? "pre-migration",
    databaseAllowlist: databases,
    counts: {
      databases: databaseRows.length,
      tablesAndViews: tables.length,
      columns: columns.length,
      showCreate: showCreate.length,
    },
    queryPolicy: {readonly: 2, maxResultRows: readOnlyOptions.maxResultRows},
  }),
]);

console.log(
  `ClickHouse schema snapshot written: ${outputDirectory} (${String(tables.length)} objects, ${String(columns.length)} columns)`,
);

async function queryJson<T>(sql: string): Promise<T[]> {
  const raw = await client.query(sql, readOnlyOptions);
  let parsed: JsonQueryResult<T>;
  try {
    parsed = JSON.parse(raw) as JsonQueryResult<T>;
  } catch {
    throw new Error("ClickHouse schema snapshot returned invalid JSON.");
  }
  if (!Array.isArray(parsed.data)) throw new Error("ClickHouse schema snapshot has no data array.");
  return parsed.data;
}

async function writePrivateJson(name: string, value: unknown): Promise<void> {
  const target = path.join(outputDirectory, name);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
  await chmod(target, 0o600);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({length: Math.min(concurrency, values.length)}, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value === undefined) throw new Error("Schema snapshot work item is unavailable.");
      results[index] = await operation(value);
    }
  });
  await Promise.all(workers);
  return results;
}
