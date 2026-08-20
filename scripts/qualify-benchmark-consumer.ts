import {execFile} from "node:child_process";
import path from "node:path";
import {promisify} from "node:util";

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
export const REQUIRED_BENCHMARK_CONSUMER_PATHS = Object.freeze([
  "packages/evaluation-input/src/assembler.ts",
  "packages/evidence-source/src/clickhouse.ts",
  "packages/evidence-source/src/telemetry-input.ts",
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

export function requestedBenchmarkConsumerRef(
  arguments_: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
): string {
  let cliRef: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--benchmark-ref") {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--benchmark-ref requires a value");
      }
      cliRef = singleRequestedRef(cliRef, value);
      index += 1;
    } else if (argument?.startsWith("--benchmark-ref=")) {
      cliRef = singleRequestedRef(cliRef, argument.slice("--benchmark-ref=".length));
    } else {
      throw new Error(`Unknown consumer qualification argument ${argument ?? ""}`);
    }
  }
  const environmentRef = environment["BENCHMARK_CONSUMER_REF"]?.trim();
  if (cliRef !== undefined && environmentRef !== undefined && cliRef !== environmentRef) {
    throw new Error("CLI and BENCHMARK_CONSUMER_REF select different refs");
  }
  const requested = cliRef ?? environmentRef;
  if (requested === undefined || requested === "") {
    throw new Error("BENCHMARK_CONSUMER_REF or --benchmark-ref is required");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}^~:+-]{0,199}$/u.test(requested)) {
    throw new Error("Requested Benchmark consumer ref is not a safe Git revision");
  }
  return requested;
}

function singleRequestedRef(existing: string | undefined, incoming: string): string {
  const normalized = incoming.trim();
  if (existing !== undefined || normalized === "") {
    throw new Error("--benchmark-ref must be supplied exactly once with a value");
  }
  return normalized;
}

async function qualifyBenchmarkConsumer(): Promise<void> {
  const repository = path.resolve(
    process.env["BENCHMARK_REPOSITORY_ROOT"] ?? "../sdar-benchmark-server",
  );
  const requestedRef = requestedBenchmarkConsumerRef(process.argv.slice(2), process.env);
  await execute("git", ["-C", repository, "cat-file", "-e", `${BENCHMARK_CONSUMER_BASELINE}^{commit}`]);
  const resolved = await execute("git", [
    "-C", repository, "rev-parse", "--verify", `${requestedRef}^{commit}`,
  ]);
  const requestedSha = resolved.stdout.trim();
  try {
    await execute("git", [
      "-C", repository, "merge-base", "--is-ancestor",
      BENCHMARK_CONSUMER_BASELINE, requestedSha,
    ]);
  } catch (error) {
    const exitCode = childExitCode(error);
    if (exitCode !== 1) throw error;
    process.stdout.write(`${JSON.stringify({
      event: "benchmark.domain_consumer_qualification",
      status: "blocked",
      errorCode: "BENCHMARK_CONSUMER_REF_NOT_DESCENDANT",
      minimumBaseline: BENCHMARK_CONSUMER_BASELINE,
      requestedRef,
      requestedSha,
    })}\n`);
    process.exitCode = 1;
    return;
  }

  const missingPaths: string[] = [];
  for (const requiredPath of REQUIRED_BENCHMARK_CONSUMER_PATHS) {
    try {
      await execute("git", [
        "-C", repository, "cat-file", "-e", `${requestedSha}:${requiredPath}`,
      ]);
    } catch {
      missingPaths.push(requiredPath);
    }
  }
  const source = await benchmarkConsumerSource(repository, requestedSha);
  const result = assessBenchmarkConsumerSource(source);
  if (!result.qualified || missingPaths.length > 0) {
    process.stdout.write(`${JSON.stringify({
      event: "benchmark.domain_consumer_qualification",
      status: "blocked",
      errorCode: "BENCHMARK_DOMAIN_CONSUMER_PATH_MISSING",
      minimumBaseline: BENCHMARK_CONSUMER_BASELINE,
      requestedRef,
      requestedSha,
      missingPathCount: missingPaths.length,
      missingViewCount: result.missingViews.length,
      missingStatusCount: result.missingStatuses.length,
      generalProfileIndependence: result.hasGeneralProfileIndependence,
      formalReadyGate: result.hasFormalReadyGate,
    })}\n`);
    process.exitCode = 1;
    return;
  }

  const live = process.env["BENCHMARK_CONSUMER_LIVE"] === "true";
  if (live) await runLiveHandoffVerifiers();
  process.stdout.write(`${JSON.stringify({
    event: "benchmark.domain_consumer_qualification",
    status: live ? "passed" : "contract_passed_live_queries_still_required",
    minimumBaseline: BENCHMARK_CONSUMER_BASELINE,
    requestedRef,
    requestedSha,
    descendant: true,
    paths: REQUIRED_BENCHMARK_CONSUMER_PATHS.length,
    views: REQUIRED_BENCHMARK_DOMAIN_VIEWS.length,
    statuses: REQUIRED_BENCHMARK_READINESS_STATUSES.length,
    liveHandoffs: live ? 2 : 0,
  })}\n`);
}

async function benchmarkConsumerSource(repository: string, requestedSha: string): Promise<string> {
  try {
    const result = await execute("git", [
      "-C", repository, "grep", "-n", "-i", "-E",
      "domain.projection|episode.domain|v_domain_source_contract_definition_current|v_episode_projection_readiness|not_required|not_ready|degraded|blocked_drift|general|formal.domain|sdar_meta.v_schema_contract_release_current",
      requestedSha, "--", "packages", "apps", "tests",
    ], {maxBuffer: 4 * 1024 * 1024});
    return result.stdout;
  } catch (error) {
    if (childExitCode(error) === 1) return "";
    throw error;
  }
}

async function runLiveHandoffVerifiers(): Promise<void> {
  for (const verifier of [
    "integrations/sdar-benchmark-server/domain-projection/v1/verify.mjs",
    "integrations/sdar-benchmark-server/mcp-provider-telemetry/v1/verify.mjs",
  ]) {
    const result = await execute(process.execPath, [verifier, "--live"], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
}

function childExitCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as {code?: unknown}).code
    : undefined;
}

if (process.argv[1]?.endsWith("qualify-benchmark-consumer.js")) {
  try {
    await qualifyBenchmarkConsumer();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: "benchmark.domain_consumer_qualification",
      status: "failed",
      errorCode: "BENCHMARK_CONSUMER_QUALIFICATION_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}
