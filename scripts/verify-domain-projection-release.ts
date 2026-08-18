import {readFile} from "node:fs/promises";

export const DOMAIN_PROJECTION_GATE_IDS = Object.freeze(
  Array.from({length: 35}, (_, index) => `G${String(index + 1).padStart(2, "0")}`),
);

export type DomainProjectionGateSummary = Readonly<{
  complete: boolean;
  passed: number;
  open: number;
  openGates: readonly string[];
}>;

export function summarizeDomainProjectionGates(
  gates: Readonly<Record<string, unknown>>,
): DomainProjectionGateSummary {
  const keys = Object.keys(gates).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...DOMAIN_PROJECTION_GATE_IDS])) {
    throw releaseError("DOMAIN_PROJECTION_GATE_SET_INVALID");
  }
  const openGates = DOMAIN_PROJECTION_GATE_IDS.filter((gate) => gates[gate] !== "PASS");
  return Object.freeze({
    complete: openGates.length === 0,
    passed: DOMAIN_PROJECTION_GATE_IDS.length - openGates.length,
    open: openGates.length,
    openGates: Object.freeze(openGates),
  });
}

if (process.argv[1]?.endsWith("verify-domain-projection-release.js")) {
  try {
    const state = JSON.parse(
      await readFile("reports/domain-projection-v0.1/goal-state.json", "utf8"),
    ) as {status?: unknown; gates?: unknown};
    if (state.gates === null || typeof state.gates !== "object" || Array.isArray(state.gates)) {
      throw releaseError("DOMAIN_PROJECTION_GATE_SET_INVALID");
    }
    const summary = summarizeDomainProjectionGates(state.gates as Record<string, unknown>);
    if (!summary.complete || state.status !== "complete") {
      process.stdout.write(`${JSON.stringify({
        event: "domain_projection.release_gate",
        status: "blocked",
        passed: summary.passed,
        open: summary.open,
        openGates: summary.openGates,
      })}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify({
        event: "domain_projection.release_gate",
        status: "passed",
        passed: summary.passed,
        open: 0,
      })}\n`);
    }
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error
      ? (error as {code?: unknown}).code : undefined;
    process.stderr.write(`${typeof code === "string" ? code : "DOMAIN_PROJECTION_RELEASE_VERIFY_FAILED"}\n`);
    process.exitCode = 1;
  }
}

function releaseError(code: string): Error & {code: string} {
  return Object.assign(new Error(code), {code});
}
