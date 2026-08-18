import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleMcpProviderTelemetry,
  evaluateMcpProviderReadiness,
  reconcileMcpProviderTelemetry,
  type SmppEntityRelation,
  type SmppProviderFact,
} from "../../packages/telemetry-smpp-consumer/src/index.js";

const taskFact: SmppProviderFact = {
  fact_id: "11111111-1111-5111-8111-111111111111",
  fact_hash: "a".repeat(64),
  fact_type: "provider.task.lifecycle",
  smpp_source_id: "smpp.test.provider-one",
  external_task_id: "provider-task-1",
  lifecycle_status: "completed",
  runtime_revision: "7",
  occurred_at: "2026-08-18T01:00:00.000Z",
  projected_at: "2026-08-18T01:00:01.000Z",
};

const relation: SmppEntityRelation = {
  relation_id: "22222222-2222-5222-8222-222222222222",
  relation_type: "invokes",
  source_entity_type: "task",
  source_entity_id: "sdar-task-1",
  target_entity_type: "task",
  target_entity_id: "provider-task-1",
  evidence_fact_ids: [taskFact.fact_id],
  source_record_hash: "b".repeat(64),
  projection_id: "smpp_relations_to_sdar_core",
  projection_version: 1,
};

const commandFact: SmppProviderFact = {
  ...taskFact,
  fact_id: "33333333-3333-5333-8333-333333333333",
  fact_hash: "c".repeat(64),
  fact_type: "provider.command.lifecycle",
};

const progressFact: SmppProviderFact = {
  ...taskFact,
  fact_id: "44444444-4444-5444-8444-444444444444",
  fact_hash: "d".repeat(64),
  fact_type: "provider.execution.progress",
};

test("all five SMPP readiness states are explicit and empty required input is never healthy", () => {
  assert.equal(evaluateMcpProviderReadiness({required: false, facts: [], relations: []}).status, "not_required");
  assert.equal(evaluateMcpProviderReadiness({required: true, facts: [], relations: []}).status, "not_ready");
  assert.equal(evaluateMcpProviderReadiness({required: true, facts: [taskFact], relations: [relation]}).status, "degraded");
  assert.equal(evaluateMcpProviderReadiness({required: true, facts: [taskFact, commandFact, progressFact], relations: [relation]}).status, "ready");
  assert.equal(evaluateMcpProviderReadiness({required: true, facts: [taskFact, {...taskFact, fact_hash: "e".repeat(64)}], relations: [relation]}).status, "conflict");
});

test("provider completed never proves Goal or physical success", () => {
  const result = evaluateMcpProviderReadiness({required: true, facts: [taskFact, commandFact, progressFact], relations: [relation]});
  assert.equal(result.status, "ready");
  assert.equal(result.goalSuccessProven, false);
  assert.equal(result.physicalSuccessProven, false);
  assert.equal("goalStatus" in result, false);
});

test("reconciliation detects terminal and revision mismatch without changing provider authority", () => {
  const issues = reconcileMcpProviderTelemetry({
    runtimeBindings: [{externalTaskId: "provider-task-1", runtimeStatus: "failed", runtimeRevision: "8"}],
    facts: [taskFact],
    relations: [relation],
  });
  assert.deepEqual(issues.map((issue) => issue.code), ["SMPP_PROVIDER_TERMINAL_MISMATCH", "SMPP_REVISION_MISMATCH"]);
  assert.equal(issues[0]!.blocking, true);
});

test("episode assembly follows explicit task binding, relation and evidence fact identities", async () => {
  const requestedRelations: string[] = [];
  const requestedFacts: string[] = [];
  const result = await assembleMcpProviderTelemetry({
    episodeId: "episode-1",
    required: true,
    bindings: {
      async listByEpisode(episodeId) {
        assert.equal(episodeId, "episode-1");
        return [{
          episodeId,
          taskId: "sdar-task-1",
          externalTaskId: "provider-task-1",
          runtimeStatus: "completed",
          runtimeRevision: "7",
        }];
      },
    },
    relations: {
      async list(filter) {
        requestedRelations.push(`${filter.sourceEntityType}:${filter.sourceEntityId}`);
        return [relation];
      },
    },
    facts: {
      async list() {
        assert.fail("episode assembly must resolve relation evidence IDs, not scan facts");
      },
      async get(factId) {
        requestedFacts.push(factId);
        return [taskFact, commandFact, progressFact].find((fact) => fact.fact_id === factId) ?? null;
      },
    },
  });

  assert.deepEqual(requestedRelations, ["task:sdar-task-1"]);
  assert.deepEqual(requestedFacts, [taskFact.fact_id]);
  assert.equal(result.facts.length, 1);
  assert.equal(result.relations.length, 1);
  assert.equal(result.readiness.status, "degraded");
  assert.equal(result.readiness.goalSuccessProven, false);
  assert.equal(result.readiness.physicalSuccessProven, false);
});
