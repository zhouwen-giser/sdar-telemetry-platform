import assert from "node:assert/strict";
import {test} from "node:test";
import {
  SMPP_PROVIDEROPS_GATE_IDS,
  summarizeSmppProviderOpsGates,
} from "../../scripts/verify-smpp-providerops-release.js";

test("SMPP ProviderOps release requires all 28 exact evidenced gates", () => {
  const gates = Object.fromEntries(SMPP_PROVIDEROPS_GATE_IDS.map((gate) => [
    gate,
    {status: "PASS", evidence: [`evidence:${gate}`]},
  ]));
  assert.deepEqual(summarizeSmppProviderOpsGates(gates), {
    complete: true,
    passed: 28,
    open: 0,
    openGates: [],
  });

  gates["G-SMPP-17"] = {status: "PENDING", evidence: ["watermark pending"]};
  assert.deepEqual(summarizeSmppProviderOpsGates(gates), {
    complete: false,
    passed: 27,
    open: 1,
    openGates: ["G-SMPP-17"],
  });
});

test("SMPP ProviderOps release rejects missing and unevidenced gates", () => {
  const gates = Object.fromEntries(SMPP_PROVIDEROPS_GATE_IDS.map((gate) => [
    gate,
    {status: "PASS", evidence: [gate]},
  ]));
  delete gates["G-SMPP-28"];
  assert.throws(() => summarizeSmppProviderOpsGates(gates), /SMPP_PROVIDEROPS_GATE_SET_INVALID/u);

  gates["G-SMPP-28"] = {status: "PASS", evidence: []};
  assert.deepEqual(summarizeSmppProviderOpsGates(gates).openGates, ["G-SMPP-28"]);
});
