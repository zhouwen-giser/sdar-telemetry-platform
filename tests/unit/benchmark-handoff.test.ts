import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  decideDomainConsumption,
  DOMAIN_READINESS_STATUSES,
} from "../../integrations/sdar-benchmark-server/domain-projection/v1/consumer-contract.js";

test("consumer readiness preserves General independence and formal fail-closed semantics", () => {
  assert.deepEqual(DOMAIN_READINESS_STATUSES, ["not_required", "not_ready", "degraded", "ready", "blocked_drift"]);
  assert.deepEqual(decideDomainConsumption("general", "not_required"), {
    mayProceed: true,
    maySnapshotDomainInput: false,
    resultDisposition: "proceed_without_domain",
  });
  assert.deepEqual(decideDomainConsumption("domain_formal", "ready"), {
    mayProceed: true,
    maySnapshotDomainInput: true,
    resultDisposition: "formal_domain_ready",
  });
  for (const status of ["not_required", "not_ready", "degraded"] as const) {
    assert.deepEqual(decideDomainConsumption("domain_formal", status), {
      mayProceed: false,
      maySnapshotDomainInput: false,
      resultDisposition: "not_rated",
    });
  }
  assert.equal(decideDomainConsumption("domain_formal", "blocked_drift").resultDisposition, "blocked");
});

test("handoff queries use exactly seven fixed bounded readonly views", async () => {
  const sql = await readFile("integrations/sdar-benchmark-server/domain-projection/v1/queries.sql", "utf8");
  const views = [...sql.matchAll(/\bFROM\s+([a-z_]+\.[a-z0-9_]+)/giu)].map((match) => match[1]);
  assert.deepEqual(views, [
    "sdar_meta.v_schema_contract_release_current",
    "sdar_meta.v_domain_source_contract_definition_current",
    "sdar_meta.v_domain_projection_health",
    "sdar_meta.v_domain_projection_set_readiness",
    "sdar_meta.v_episode_projection_readiness",
    "sdar_mart.v_episode_domain_readiness",
    "sdar_embodied.v_episode_domain_fact_index",
  ]);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|SYSTEM)\b/iu);
  assert.equal((sql.match(/\bLIMIT\b/gu) ?? []).length, 7);
});
