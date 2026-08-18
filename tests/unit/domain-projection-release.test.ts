import assert from "node:assert/strict";
import test from "node:test";

import {
  DOMAIN_PROJECTION_GATE_IDS,
  summarizeDomainProjectionGates,
} from "../../scripts/verify-domain-projection-release.js";

test("release gate requires the exact G01-G35 set and every value PASS", () => {
  const complete = Object.fromEntries(DOMAIN_PROJECTION_GATE_IDS.map((gate) => [gate, "PASS"]));
  assert.deepEqual(summarizeDomainProjectionGates(complete), {
    complete: true,
    passed: 35,
    open: 0,
    openGates: [],
  });
  const blocked = {...complete, G14: "PENDING_REAL_RUN", G35: "BLOCKED"};
  assert.deepEqual(summarizeDomainProjectionGates(blocked), {
    complete: false,
    passed: 33,
    open: 2,
    openGates: ["G14", "G35"],
  });
  const missing = {...complete};
  delete missing.G35;
  assert.throws(() => summarizeDomainProjectionGates(missing), /DOMAIN_PROJECTION_GATE_SET_INVALID/u);
});
