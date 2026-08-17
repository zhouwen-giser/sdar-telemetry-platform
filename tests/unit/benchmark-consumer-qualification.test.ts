import assert from "node:assert/strict";
import test from "node:test";

import {
  assessBenchmarkConsumerSource,
  REQUIRED_BENCHMARK_DOMAIN_VIEWS,
  REQUIRED_BENCHMARK_READINESS_STATUSES,
} from "../../scripts/qualify-benchmark-consumer.js";

test("consumer qualification requires all views, statuses and both profile gates", () => {
  const complete = [
    ...REQUIRED_BENCHMARK_DOMAIN_VIEWS,
    ...REQUIRED_BENCHMARK_READINESS_STATUSES,
    "general profile",
    "domain_formal profile",
  ].join("\n");
  assert.deepEqual(assessBenchmarkConsumerSource(complete), {
    qualified: true,
    missingViews: [],
    missingStatuses: [],
    hasGeneralProfileIndependence: true,
    hasFormalReadyGate: true,
  });
  const missing = assessBenchmarkConsumerSource("ready not_ready degraded");
  assert.equal(missing.qualified, false);
  assert.equal(missing.missingViews.length, 7);
  assert.deepEqual(missing.missingStatuses, ["not_required", "blocked_drift"]);
  assert.equal(missing.hasGeneralProfileIndependence, false);
  assert.equal(missing.hasFormalReadyGate, false);
});
