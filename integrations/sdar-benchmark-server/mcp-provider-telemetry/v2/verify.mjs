#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes("--live");
const manifest = JSON.parse(await readFile(join(root, "handoff-manifest.json"), "utf8"));
if (manifest.contract !== "sdar.telemetry-smpp-providerops-handoff/v2") throw new Error("HANDOFF_V2_CONTRACT_INVALID");
for (const asset of manifest.assets) {
  const body = await readFile(join(root, asset.path));
  const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  if (body.byteLength !== asset.bytes || digest !== asset.byteSha256) throw new Error(`HANDOFF_V2_ASSET_DRIFT:${asset.path}`);
}
const readiness = JSON.parse(await readFile(join(root, "readiness-contract.json"), "utf8"));
if (readiness.v1FallbackAllowed !== false) throw new Error("HANDOFF_V1_FALLBACK_FORBIDDEN");
const semanticMigration = await readFile(join(root, "../../../../migrations/clickhouse", manifest.semanticAdditiveMigration));
const semanticDigest = `sha256:${createHash("sha256").update(semanticMigration).digest("hex")}`;
if (semanticDigest !== manifest.semanticAdditiveMigrationSha256) throw new Error("HANDOFF_V2_SEMANTIC_MIGRATION_DRIFT");
for (const criterion of ["unresolvedExecutionCount == 0", "unresolvedReconciliationCount == 0", "terminalConflictCount == 0"]) {
  if (!readiness.formalReadyWhen.includes(criterion)) throw new Error(`HANDOFF_V2_SEMANTIC_READINESS_MISSING:${criterion}`);
}
if (live) {
  const {ClickHouseClient, configFromEnv} = await import("../../../../dist/packages/telemetry-clickhouse/src/index.js");
  const client = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));
  const contracts = JSON.parse(await readFile(join(root, "view-contracts.json"), "utf8"));
  for (const view of contracts.views) {
    if (!/^sdar_mart\.[a-z0-9_]+$/u.test(view.name)) throw new Error("HANDOFF_V2_LIVE_VIEW_INVALID");
    const document = JSON.parse(await client.query(
      `SELECT ${view.requiredFields.join(",")} FROM ${view.name} LIMIT 0 FORMAT JSON`,
      {readonly: 2, maxResultRows: 1},
    ));
    if (JSON.stringify(document.meta.map((field) => field.name)) !== JSON.stringify(view.requiredFields)) {
      throw new Error(`HANDOFF_V2_LIVE_VIEW_DRIFT:${view.name}`);
    }
  }
  const ready = JSON.parse(await client.query(`SELECT closure_snapshot_id,status,expected_fact_count,selected_fact_count,
    foreign_fact_count,unresolved_binding_count,unresolved_execution_count,conflicting_execution_count,
    unresolved_reconciliation_count,terminal_conflict_count,identity_hash_conflict_count,truncated,hints_used_for_authority
    FROM sdar_mart.v_episode_smpp_provider_readiness WHERE status='ready'
    ORDER BY projected_at DESC LIMIT 1 FORMAT JSON`, {readonly: 2, maxResultRows: 1})).data?.[0];
  if (!ready || !/^sha256:[0-9a-f]{64}$/u.test(ready.closure_snapshot_id) ||
      ready.expected_fact_count !== ready.selected_fact_count || Number(ready.selected_fact_count) < 1 ||
      ["foreign_fact_count","unresolved_binding_count","unresolved_execution_count","conflicting_execution_count",
        "unresolved_reconciliation_count","terminal_conflict_count","identity_hash_conflict_count"].some((field) => Number(ready[field]) !== 0) ||
      Boolean(ready.truncated) || Boolean(ready.hints_used_for_authority)) {
    throw new Error("HANDOFF_V2_LIVE_READY_SNAPSHOT_INVALID");
  }
}
console.log(`SMPP_BENCHMARK_HANDOFF_V2_${live ? "LIVE" : "STATIC"}_PASS assets=${manifest.assets.length}`);
