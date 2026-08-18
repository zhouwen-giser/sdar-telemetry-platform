import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";

const execute = promisify(execFile);
export const BENCHMARK_CONSUMER_BASELINE = "ee7f73735595382072b8205b891af554e8496582";
export const REQUIRED_BENCHMARK_DOMAIN_VIEWS = Object.freeze([
  "sdar_meta.v_schema_contract_release_current",
  "sdar_meta.v_domain_source_contract_definition_current",
  "sdar_meta.v_domain_projection_health",
  "sdar_meta.v_domain_projection_set_readiness",
  "sdar_meta.v_episode_projection_readiness",
  "sdar_mart.v_episode_domain_readiness",
  "sdar_embodied.v_episode_domain_fact_index",
]);
export const REQUIRED_BENCHMARK_READINESS_STATUSES = Object.freeze([
  "not_required", "not_ready", "degraded", "ready", "blocked_drift",
]);

export type BenchmarkConsumerQualification = Readonly<{
  qualified: boolean;
  missingViews: readonly string[];
  missingStatuses: readonly string[];
  hasGeneralProfileIndependence: boolean;
  hasFormalReadyGate: boolean;
}>;

export function assessBenchmarkConsumerSource(source: string): BenchmarkConsumerQualification {
  const missingViews = REQUIRED_BENCHMARK_DOMAIN_VIEWS.filter((view) => !source.includes(view));
  const missingStatuses = REQUIRED_BENCHMARK_READINESS_STATUSES.filter(
    (status) => !source.includes(status),
  );
  const normalized = source.toLowerCase();
  const hasGeneralProfileIndependence = normalized.includes("general") &&
    normalized.includes("not_required");
  const hasFormalReadyGate = (normalized.includes("domain_formal") || normalized.includes("formal domain")) &&
    normalized.includes("ready");
  return Object.freeze({
    qualified: missingViews.length === 0 && missingStatuses.length === 0 &&
      hasGeneralProfileIndependence && hasFormalReadyGate,
    missingViews: Object.freeze(missingViews),
    missingStatuses: Object.freeze(missingStatuses),
    hasGeneralProfileIndependence,
    hasFormalReadyGate,
  });
}

if (process.argv[1]?.endsWith("qualify-benchmark-consumer.js")) {
  const repository = path.resolve(
    process.env["BENCHMARK_REPOSITORY_ROOT"] ?? "../sdar-benchmark-server",
  );
  try {
    await execute("git", ["-C", repository, "cat-file", "-e", `${BENCHMARK_CONSUMER_BASELINE}^{commit}`]);
    let source = "";
    try {
      const result = await execute("git", [
        "-C", repository, "grep", "-n", "-i", "-E",
        "domain.projection|episode.domain|not_required|not_ready|degraded|blocked_drift|formal.domain|sdar_meta.v_schema_contract_release_current",
        BENCHMARK_CONSUMER_BASELINE, "--", "packages", "apps", "tests",
      ], {maxBuffer: 4 * 1024 * 1024});
      source = result.stdout;
    } catch (error) {
      const exitCode = typeof error === "object" && error !== null && "code" in error
        ? (error as {code?: unknown}).code : undefined;
      if (exitCode !== 1) throw error;
    }
    const result = assessBenchmarkConsumerSource(source);
    if (!result.qualified) {
      process.stdout.write(`${JSON.stringify({
        event: "benchmark.domain_consumer_qualification",
        status: "blocked",
        errorCode: "BENCHMARK_DOMAIN_CONSUMER_PATH_MISSING",
        baseline: BENCHMARK_CONSUMER_BASELINE,
        missingViewCount: result.missingViews.length,
        missingStatusCount: result.missingStatuses.length,
        generalProfileIndependence: result.hasGeneralProfileIndependence,
        formalReadyGate: result.hasFormalReadyGate,
      })}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify({
        event: "benchmark.domain_consumer_qualification",
        status: "contract_passed_live_queries_still_required",
        baseline: BENCHMARK_CONSUMER_BASELINE,
        views: REQUIRED_BENCHMARK_DOMAIN_VIEWS.length,
        statuses: REQUIRED_BENCHMARK_READINESS_STATUSES.length,
      })}\n`);
    }
  } catch {
    process.stderr.write("BENCHMARK_CONSUMER_QUALIFICATION_FAILED\n");
    process.exitCode = 1;
  }
}
