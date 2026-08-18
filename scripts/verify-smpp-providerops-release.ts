import {readFile} from "node:fs/promises";

export const SMPP_PROVIDEROPS_GATE_IDS = Object.freeze(
  Array.from({length: 28}, (_, index) => `G-SMPP-${String(index + 1).padStart(2, "0")}`),
);

type Gate = Readonly<{status?: unknown; evidence?: unknown}>;

export type SmppProviderOpsGateSummary = Readonly<{
  complete: boolean;
  passed: number;
  open: number;
  openGates: readonly string[];
}>;

export function summarizeSmppProviderOpsGates(
  gates: Readonly<Record<string, unknown>>,
): SmppProviderOpsGateSummary {
  const keys = Object.keys(gates).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SMPP_PROVIDEROPS_GATE_IDS].sort())) {
    throw releaseError("SMPP_PROVIDEROPS_GATE_SET_INVALID");
  }
  const openGates = SMPP_PROVIDEROPS_GATE_IDS.filter((gateId) => {
    const gate = gates[gateId] as Gate | undefined;
    return gate?.status !== "PASS" || !Array.isArray(gate.evidence) ||
      gate.evidence.length === 0 || gate.evidence.some((item) => typeof item !== "string" || item.trim() === "");
  });
  return Object.freeze({
    complete: openGates.length === 0,
    passed: SMPP_PROVIDEROPS_GATE_IDS.length - openGates.length,
    open: openGates.length,
    openGates: Object.freeze(openGates),
  });
}

if (process.argv[1]?.endsWith("verify-smpp-providerops-release.js")) {
  try {
    const [state, qualification, sourceLock, handoff, e2e, parent] = await Promise.all([
      readJson("reports/smpp-providerops-increment/gate-state.json"),
      readJson("reports/smpp-providerops-increment/final-qualification.json"),
      readJson("integrations/smpp-providerops/v1.1/source-lock.json"),
      readJson("integrations/sdar-benchmark-server/mcp-provider-telemetry/v1/handoff-manifest.json"),
      readJson("reports/smpp-providerops-increment/evidence/codex-smpp-s8-20260818T023207Z.json"),
      readJson("reports/domain-projection-v0.1/goal-state.json"),
    ]);
    const gates = objectAt(state, "gates", "SMPP_PROVIDEROPS_GATE_SET_INVALID");
    const summary = summarizeSmppProviderOpsGates(gates);
    const marker = "SDAR_TELEMETRY_SMPP_PROVIDEROPS_INCREMENT_COMPLETE";
    assert(state.status === "complete" && state.phase === "S10" && state.completionMarker === marker,
      "SMPP_PROVIDEROPS_STATE_INVALID");
    assert(qualification.status === "passed" && qualification.phase === "S10" &&
      qualification.passedGates === 28 && qualification.failedGates === 0 &&
      qualification.completionMarker === marker, "SMPP_PROVIDEROPS_QUALIFICATION_INVALID");

    const sourceLocks = objectAt(qualification, "sourceLocks", "SMPP_PROVIDEROPS_SOURCE_LOCK_INVALID");
    const providerOpsEnvelope = objectAt(sourceLock, "providerOpsEnvelope", "SMPP_PROVIDEROPS_SOURCE_LOCK_INVALID");
    assert(sourceLocks.smppCompanionHead === providerOpsEnvelope.companionHead &&
      sourceLocks.smppCompanionHead === handoff.companionHead,
    "SMPP_PROVIDEROPS_COMPANION_HEAD_MISMATCH");

    const qualifiedClickHouse = objectAt(qualification, "clickHouse", "SMPP_PROVIDEROPS_CLICKHOUSE_LOCK_INVALID");
    const lockedClickHouse = objectAt(sourceLock, "clickHouse", "SMPP_PROVIDEROPS_CLICKHOUSE_LOCK_INVALID");
    assert(qualifiedClickHouse.releaseVersion === "1.5.1-rc.2" &&
      qualifiedClickHouse.migrationRange === "00..26" && qualifiedClickHouse.readonly === 2 &&
      qualifiedClickHouse.schemaContractHash === lockedClickHouse.schemaContractHash &&
      qualifiedClickHouse.releaseDescriptorHash === lockedClickHouse.releaseDescriptorHash &&
      qualifiedClickHouse.schemaContractHash === handoff.schemaContractHash &&
      qualifiedClickHouse.releaseDescriptorHash === handoff.releaseDescriptorHash,
    "SMPP_PROVIDEROPS_CLICKHOUSE_LOCK_INVALID");

    const realE2e = objectAt(qualification, "realE2e", "SMPP_PROVIDEROPS_REAL_E2E_INVALID");
    const checks = objectAt(e2e, "checks", "SMPP_PROVIDEROPS_REAL_E2E_INVALID");
    assert(e2e.status === "passed" && e2e.runId === realE2e.runId &&
      checks.realRowsConsumed === true && checks.allProviderOpsRecordTypes === true &&
      checks.sameHashIdempotency === true && checks.differentHashConflict === true &&
      checks.outageIsolationAndRecovery === true && checks.restartReplay === true &&
      checks.queryPollingUsedAsDurableProjection === false &&
      checks.providerCompletedPromotedToGoalSuccess === false &&
      checks.providerCompletedPromotedToPhysicalSuccess === false &&
      checks.benchmarkScoringImplementedInTelemetry === false && checks.clickHouseDdlModified === false,
    "SMPP_PROVIDEROPS_REAL_E2E_INVALID");

    const regression = objectAt(qualification, "regression", "SMPP_PROVIDEROPS_REGRESSION_INVALID");
    const telemetryRegression = objectAt(regression, "telemetry", "SMPP_PROVIDEROPS_REGRESSION_INVALID");
    const companionRegression = objectAt(regression, "smppCompanion", "SMPP_PROVIDEROPS_REGRESSION_INVALID");
    assert(telemetryRegression.passed === 165 && telemetryRegression.failed === 0 &&
      telemetryRegression.skipped === 2 && companionRegression.passed === 44 &&
      companionRegression.failed === 0 && companionRegression.skipped === 0 &&
      regression.clickHouseDdlModified === false &&
      regression.benchmarkScoringImplementedInTelemetry === false &&
      regression.queryPollingUsedAsDurableProjection === false &&
      regression.providerCompletedPromotedToGoalSuccess === false &&
      regression.providerCompletedPromotedToPhysicalSuccess === false,
    "SMPP_PROVIDEROPS_REGRESSION_INVALID");

    const parentGates = objectAt(parent, "gates", "SMPP_PROVIDEROPS_PARENT_STATE_INVALID");
    const parentPassed = Object.values(parentGates).filter((value) => value === "PASS").length;
    assert(parent.status === "blocked" && parentPassed === 23,
      "SMPP_PROVIDEROPS_PARENT_STATE_INVALID");
    assert(summary.complete, "SMPP_PROVIDEROPS_RELEASE_BLOCKED");

    process.stdout.write(`${JSON.stringify({
      event: "smpp_providerops.release_gate",
      status: "passed",
      passed: summary.passed,
      open: summary.open,
      realE2eRunId: e2e.runId,
      parentStatus: parent.status,
      parentPassed,
    })}\n`);
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error
      ? (error as {code?: unknown}).code : undefined;
    process.stderr.write(`${typeof code === "string" ? code : "SMPP_PROVIDEROPS_RELEASE_VERIFY_FAILED"}\n`);
    process.exitCode = 1;
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw releaseError("SMPP_PROVIDEROPS_JSON_OBJECT_REQUIRED");
  }
  return value as Record<string, unknown>;
}

function objectAt(
  value: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): Record<string, unknown> {
  const candidate = value[key];
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw releaseError(code);
  }
  return candidate as Record<string, unknown>;
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) throw releaseError(code);
}

function releaseError(code: string): Error & {code: string} {
  return Object.assign(new Error(code), {code});
}
