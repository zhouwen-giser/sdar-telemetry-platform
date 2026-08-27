import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";

const approval = process.env["ALLOW_CLICKHOUSE_ADDITIVE_MIGRATION"];
if (approval !== "sdar.evidence/v1") {
  throw new Error(
    "ALLOW_CLICKHOUSE_ADDITIVE_MIGRATION=sdar.evidence/v1 is required.",
  );
}

const migrationPath = path.resolve(
  "migrations/clickhouse/014_sdar_evidence_v1_canonical.sql",
);
const reviewPath = path.resolve(
  "reports/sdar-integration/03_CLICKHOUSE_SCHEMA_DIFF.md",
);
const [source, review] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(reviewPath, "utf8"),
]);
if (!review.includes("Migration decision: APPROVED_ADDITIVE")) {
  throw new Error(
    "The reviewed schema diff does not approve the additive migration.",
  );
}
// Byte identity from the reviewed schema diff; a new DDL requires a new review.
if (
  createHash("sha256").update(source).digest("hex") !==
  "fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9"
) {
  throw new Error("EVIDENCE_ADDITIVE_MIGRATION_REVIEW_HASH_MISMATCH");
}
if (
  /\b(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER|RENAME|REPLACE|OPTIMIZE|INSERT)\b/iu.test(
    source,
  )
) {
  throw new Error(
    "Evidence v1 migration contains a forbidden mutating statement.",
  );
}

const statements = source
  .split(";")
  .map((statement: string) => statement.replace(/^\s*--.*$/gmu, "").trim())
  .filter((statement: string) => statement !== "");
if (
  statements.length !== 2 ||
  !/^CREATE DATABASE IF NOT EXISTS sdar_core$/iu.test(statements[0] ?? "") ||
  !/^CREATE TABLE IF NOT EXISTS sdar_core\.sdar_evidence_v1_record\s*\(/iu.test(
    statements[1] ?? "",
  )
) {
  throw new Error(
    "Evidence v1 migration is not the reviewed two-statement additive shape.",
  );
}

const client = new ClickHouseClient(configFromEnv());
for (const statement of statements) await client.query(statement);

const verification = await client.query(
  `SELECT engine, count() AS object_count
FROM system.tables
WHERE database = 'sdar_core' AND name = 'sdar_evidence_v1_record'
GROUP BY engine
FORMAT JSON`,
  { readonly: 2, maxResultRows: 2 },
);
const parsed = JSON.parse(verification) as {
  data?: Array<{ engine?: unknown; object_count?: unknown }>;
};
const row = parsed.data?.[0];
if (row?.engine !== "ReplacingMergeTree" || Number(row.object_count) !== 1) {
  throw new Error("Evidence v1 canonical table verification failed.");
}
process.stdout.write(
  `${JSON.stringify({
    migration: path.basename(migrationPath),
    target: "192.168.1.7",
    table: "sdar_core.sdar_evidence_v1_record",
    engine: row.engine,
    status: "applied-and-verified",
  })}\n`,
);
