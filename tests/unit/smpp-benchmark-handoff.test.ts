import assert from "node:assert/strict";
import test from "node:test";

import {
  decideMcpProviderConsumption,
  MCP_PROVIDER_READINESS_STATUSES,
} from "../../integrations/sdar-benchmark-server/mcp-provider-telemetry/v1/consumer-contract.js";

test("SMPP handoff exposes all five readiness states without score semantics", () => {
  assert.deepEqual(MCP_PROVIDER_READINESS_STATUSES, [
    "not_required",
    "not_ready",
    "degraded",
    "ready",
    "conflict",
  ]);
  assert.deepEqual(decideMcpProviderConsumption(false, "not_required"), {
    mayProceed: true,
    maySnapshotProviderInput: false,
    resultDisposition: "provider_not_required",
  });
  assert.equal(decideMcpProviderConsumption(true, "not_ready").resultDisposition, "not_rated");
  assert.equal(decideMcpProviderConsumption(true, "conflict").mayProceed, false);
  assert.equal("score" in decideMcpProviderConsumption(true, "ready"), false);
});

test("degraded and ready only qualify immutable Provider evidence input", () => {
  for (const status of ["degraded", "ready"] as const) {
    const decision = decideMcpProviderConsumption(true, status);
    assert.equal(decision.mayProceed, true);
    assert.equal(decision.maySnapshotProviderInput, true);
  }
});
