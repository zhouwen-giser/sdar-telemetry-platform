import {
  evaluateMcpProviderReadiness,
  reconcileMcpProviderTelemetry,
  type SmppEntityRelation,
  type SmppProviderFact,
} from "../packages/telemetry-smpp-consumer/src/index.js";
import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";
import {
  decideMcpProviderConsumption,
  SMPP_BENCHMARK_HANDOFF_CONTRACT,
} from "../integrations/sdar-benchmark-server/mcp-provider-telemetry/v1/consumer-contract.js";

const runId = process.env.SMPP_E2E_RUN_ID;
if (runId === undefined || !/^codex-smpp-s8-[A-Za-z0-9]+$/u.test(runId)) {
  throw new Error("SMPP_E2E_RUN_ID_REQUIRED");
}
const suffix = runId.slice("codex-smpp-s8-".length).toLowerCase();
const projectId = `smpp-s8-${suffix}`;
const smppSourceId = `smpp.codex.s8.${suffix}`;
const client = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));

const factRows = await query(`SELECT
  toString(fact_id) AS fact_id,
  fact_hash,
  fact_type,
  smpp_source_id,
  external_task_id,
  external_execution_id,
  external_command_id,
  lifecycle_status,
  provider_revision,
  runtime_revision,
  toString(occurred_at) AS occurred_at,
  toString(projected_at) AS projected_at,
  source_schema_version,
  projection_id,
  projection_version
FROM sdar_core.external_provider_fact FINAL
WHERE tenant_id = 'codex-integration'
  AND project_id = '${projectId}'
  AND smpp_source_id = '${smppSourceId}'
ORDER BY occurred_at, fact_id
FORMAT JSON`);
const relationRows = await query(`SELECT
  toString(relation_id) AS relation_id,
  relation_type,
  source_entity_type,
  source_entity_id,
  target_entity_type,
  target_entity_id,
  arrayMap(value -> toString(value), evidence_fact_ids) AS evidence_fact_ids,
  source_record_hash,
  projection_id,
  projection_version
FROM sdar_core.external_entity_relation_fact FINAL
WHERE tenant_id = 'codex-integration'
  AND project_id = '${projectId}'
  AND smpp_source_id = '${smppSourceId}'
ORDER BY relation_id
FORMAT JSON`);

const facts = factRows as unknown as SmppProviderFact[];
const relations = relationRows as unknown as SmppEntityRelation[];
const taskId = `provider-task-${runId}`;
const issues = reconcileMcpProviderTelemetry({
  runtimeBindings: [
    {
      externalTaskId: taskId,
      runtimeStatus: "completed",
      runtimeRevision: "2.0.0-rc.1",
    },
  ],
  facts,
  relations,
});
const readiness = evaluateMcpProviderReadiness({
  required: true,
  facts,
  relations,
  issues,
});
const decision = decideMcpProviderConsumption(true, readiness.status);
const recordTypes = [...new Set(facts.map((fact) => fact.fact_type))].sort();
const checks = {
  actualRowsConsumed: facts.length === 17 && relations.length === 48,
  sixteenRecordTypes: recordTypes.length === 16,
  exactProjectionIdentity:
    factRows.every(
      (row) =>
        row["projection_id"] === "smpp_provider_ops_to_sdar_core" &&
        Number(row["projection_version"]) === 1,
    ) &&
    relationRows.every(
      (row) =>
        row["projection_id"] === "smpp_relations_to_sdar_core" &&
        Number(row["projection_version"]) === 1,
    ),
  sourceRelease: factRows.every((row) => row["source_schema_version"] === "1.1.0"),
  readinessReady: readiness.status === "ready",
  noReconciliationIssue: issues.length === 0,
  benchmarkMaySnapshotEvidence: decision.maySnapshotProviderInput,
  noGoalPromotion: readiness.goalSuccessProven === false,
  noPhysicalPromotion: readiness.physicalSuccessProven === false,
  noScoreField: !("score" in decision) && !("score" in readiness),
};
if (!Object.values(checks).every(Boolean)) {
  throw Object.assign(new Error("SMPP_E2E_CONSUMER_FAILED"), {checks});
}
console.log(
  JSON.stringify({
    event: "smpp_providerops.consumer_e2e",
    status: "passed",
    runId,
    projectId,
    smppSourceId,
    handoffContract: SMPP_BENCHMARK_HANDOFF_CONTRACT,
    checks,
    readiness,
    decision,
    factCount: facts.length,
    relationCount: relations.length,
    recordTypes,
    readonly: 2,
  }),
);

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const document = JSON.parse(
    await client.query(sql, {readonly: 2, maxResultRows: 1_000}),
  ) as {data?: unknown};
  if (!Array.isArray(document.data)) throw new Error("SMPP_E2E_QUERY_INVALID");
  return document.data as Record<string, unknown>[];
}
