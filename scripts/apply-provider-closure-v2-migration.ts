import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";

const approval = process.env["ALLOW_CLICKHOUSE_ADDITIVE_MIGRATION"];
if (approval !== "sdar.provider-closure/v2")
  throw new Error("PROVIDER_CLOSURE_MIGRATION_APPROVAL_REQUIRED");
const path = "migrations/clickhouse/015_provider_closure_v2.sql";
const source = await readFile(path, "utf8");
const expectedHash = process.env["PROVIDER_CLOSURE_MIGRATION_SHA256"];
const actualHash = createHash("sha256").update(source).digest("hex");
if (!/^[0-9a-f]{64}$/u.test(expectedHash ?? "") || expectedHash !== actualHash)
  throw new Error("PROVIDER_CLOSURE_MIGRATION_REVIEW_HASH_MISMATCH");
if (/\b(?:ALTER|ATTACH|DELETE|DETACH|DROP|INSERT|OPTIMIZE|RENAME|REPLACE|TRUNCATE|UPDATE)\b/iu.test(source))
  throw new Error("PROVIDER_CLOSURE_MIGRATION_MUTATION_FORBIDDEN");
const statements: string[] = source
  .split(";")
  .map((statement: string) => statement.replace(/^\s*--.*$/gmu, "").trim())
  .filter((statement: string) => statement !== "");
if(statements.length!==10||statements.slice(0,5).some(statement=>!/^CREATE TABLE IF NOT EXISTS sdar_mart\.provider_closure_[a-z_]+_v2\s*\(/iu.test(statement))||statements.slice(5).some(statement=>!/^CREATE VIEW IF NOT EXISTS sdar_mart\.v_episode_smpp_[a-z_]+\s+AS\s+SELECT/iu.test(statement)))
  throw new Error("PROVIDER_CLOSURE_MIGRATION_SHAPE_INVALID");
const client=new ClickHouseClient(configFromEnv());
for(const statement of statements)await client.query(statement);
const verification=JSON.parse(await client.query(`SELECT name,engine FROM system.tables WHERE database='sdar_mart'
  AND name IN ('provider_closure_manifest_v2','provider_closure_binding_v2','provider_closure_fact_v2','provider_closure_relation_v2','provider_closure_reconciliation_v2',
  'v_episode_smpp_provider_readiness','v_episode_smpp_provider_binding_closure','v_episode_smpp_provider_fact_closure','v_episode_smpp_binding_relation_closure','v_episode_smpp_origin_claim_reconciliation')
  ORDER BY name FORMAT JSON`,{readonly:2,maxResultRows:10})) as {data?:unknown[]};
if(verification.data?.length!==10)throw new Error("PROVIDER_CLOSURE_MIGRATION_VERIFICATION_FAILED");
process.stdout.write(JSON.stringify({status:"applied-and-verified",migration:path,objects:10,sha256:actualHash})+"\n");
