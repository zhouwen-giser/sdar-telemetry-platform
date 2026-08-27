/** Metadata-only preflight. Never contains database creation, alteration or sample inserts. */
import { readFile } from "node:fs/promises";
import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";
import { ClickHouseDomainSchemaPreflight } from "../apps/domain-projection-worker/src/schema-preflight.js";
import { DOMAIN_PROJECTION_DESCRIPTORS } from "../packages/telemetry-projection-registry/src/domain.js";
import {
  failure,
  stableCode,
} from "../packages/telemetry-control-postgres/src/domain-runtime.js";
try {
  const client = new ClickHouseClient(configFromEnv());
  const preflight = await ClickHouseDomainSchemaPreflight.load(client);
  for (const descriptor of DOMAIN_PROJECTION_DESCRIPTORS)
    await preflight.verify({
      descriptor,
      mappingHash: preflight.expectedMappingHash(descriptor.mappingId),
    });
  const ddl: string = await readFile(
    "migrations/clickhouse/014_sdar_evidence_v1_canonical.sql",
    "utf8",
  );
  const columns = ddl.split("\n").flatMap((line) => {
    const match = /^    ([a-z_]+) (.+?)(?: CODEC\(.+\))?,?$/u.exec(line);
    return match
      ? [{ name: match[1], type: match[2]!.replace(/,$/u, "") }]
      : [];
  });
  const actual = JSON.parse(
    await client.query(
      "SELECT name,type FROM system.columns WHERE database='sdar_core' AND table='sdar_evidence_v1_record' ORDER BY position FORMAT JSON",
      { readonly: 2, maxResultRows: 1000 },
    ),
  ) as { data: unknown };
  if (
    columns.length < 50 ||
    JSON.stringify(actual.data) !== JSON.stringify(columns)
  )
    throw failure("EVIDENCE_WAREHOUSE_SCHEMA_MISSING_OR_DRIFT");
  const table = JSON.parse(
    await client.query(
      "SELECT engine,sorting_key,partition_key FROM system.tables WHERE database='sdar_core' AND name='sdar_evidence_v1_record' FORMAT JSON",
      { readonly: 2, maxResultRows: 1 },
    ),
  ) as {
    data: { engine: string; sorting_key: string; partition_key: string }[];
  };
  if (
    table.data.length !== 1 ||
    table.data[0]?.engine !== "ReplacingMergeTree" ||
    table.data[0]?.sorting_key !== "record_type, record_id, row_id" ||
    table.data[0]?.partition_key !== "toYYYYMM(occurred_at)"
  )
    throw failure("EVIDENCE_WAREHOUSE_SCHEMA_MISSING_OR_DRIFT");
  process.stdout.write(
    JSON.stringify({
      status: "passed",
      readonly: true,
      domainMappings: 10,
      evidenceColumns: columns.length,
    }) + "\n",
  );
} catch (error) {
  process.stderr.write(stableCode(error) + "\n");
  process.exitCode = 1;
}
