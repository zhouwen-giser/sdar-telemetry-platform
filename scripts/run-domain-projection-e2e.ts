import {randomUUID} from "node:crypto";
import {spawn, type ChildProcess} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createDomainSourceBatchHash,
  loadDomainSourceV1Validator,
  type DomainSourceBatchRequest,
  type DomainSourceRecord,
  type DomainSourceSha256,
} from "../packages/telemetry-contracts/src/index.js";
import {ClickHouseClient, configFromEnv} from "../packages/telemetry-clickhouse/src/index.js";
import {CommanderDomainMapper} from "../packages/telemetry-projection-registry/src/commander-mappings.js";
import {
  DomainProjectionRegistry,
  type DomainProjectionDescriptor,
} from "../packages/telemetry-projection-registry/src/domain.js";
import {NpcDomainMapper} from "../packages/telemetry-projection-registry/src/npc-mappings.js";
import {
  ClickHouseDomainCheckpointCommitter,
  ClickHouseDomainTargetWriter,
  DomainProjectionTerminalCloser,
  type DomainMappingDecision,
  type DomainTerminalCloseInput,
} from "../apps/domain-projection-worker/src/target-writer.js";

const runId = process.env["SDAR_DOMAIN_PHASE15_RUN_ID"];
if (runId === undefined || !/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(runId)) {
  fail("DOMAIN_PROJECTION_E2E_RUN_ID_INVALID");
}

const validator = await loadDomainSourceV1Validator();
const clickHouse = new ClickHouseClient(configFromEnv());
const registry = new DomainProjectionRegistry();
const scratch = await mkdtemp(path.join(os.tmpdir(), `sdar-domain-projection-${runId}-`));

try {
  await verifyLiveRelease(clickHouse);
  await runDomainSourceE2e(runId);
  const commander = await uniqueBatch("commander-five-records.batch.json", runId);
  const npc = await uniqueBatch("npc-five-records.batch.json", runId);
  const records = [...commander.records, ...npc.records];
  const mappingHashes = await loadMappingHashes();
  const inputs = records.map((source) => projectionInput(source, mappingHashes));
  if (inputs.length !== 10) fail("DOMAIN_PROJECTION_E2E_MAPPING_COUNT_INVALID");

  const initialTargetCounts = await projectionCounts(clickHouse, inputs, "target");
  const initialLineageCounts = await projectionCounts(clickHouse, inputs, "lineage");
  const initialCheckpointCounts = await projectionCounts(clickHouse, inputs, "checkpoint");
  if ([...initialTargetCounts, ...initialLineageCounts, ...initialCheckpointCounts].some((count) => count !== 0)) {
    fail("DOMAIN_PROJECTION_E2E_SCOPE_NOT_UNIQUE");
  }

  const firstOutcomes: string[] = [];
  for (const input of inputs.slice(0, -1)) {
    firstOutcomes.push((await closer(input).close(input)).outcome);
  }

  const crashInput = inputs.at(-1)!;
  const crashEvidence = await crashAfterTarget(crashInput);
  const afterCrash = {
    target: (await projectionCounts(clickHouse, [crashInput], "target"))[0],
    lineage: (await projectionCounts(clickHouse, [crashInput], "lineage"))[0],
    checkpoint: (await projectionCounts(clickHouse, [crashInput], "checkpoint"))[0],
  };
  if (afterCrash.target !== 1 || afterCrash.lineage !== 0 || afterCrash.checkpoint !== 0) {
    fail("DOMAIN_PROJECTION_E2E_CRASH_BOUNDARY_INVALID");
  }
  firstOutcomes.push((await closer(crashInput).close(crashInput)).outcome);

  const afterFirst = await allCounts(clickHouse, inputs);
  assertAllOne(afterFirst, "DOMAIN_PROJECTION_E2E_FIRST_PASS_INVALID");
  const replayOutcomes: string[] = [];
  for (const input of inputs) replayOutcomes.push((await closer(input).close(input)).outcome);
  const afterReplay = await allCounts(clickHouse, inputs);
  assertAllOne(afterReplay, "DOMAIN_PROJECTION_E2E_REPLAY_INVALID");
  if (!firstOutcomes.every((outcome, index) => index === 9 ? outcome === "duplicate" : outcome === "produced")) {
    fail("DOMAIN_PROJECTION_E2E_FIRST_OUTCOME_INVALID");
  }
  if (!replayOutcomes.every((outcome) => outcome === "duplicate")) {
    fail("DOMAIN_PROJECTION_E2E_REPLAY_OUTCOME_INVALID");
  }

  const report = {
    schemaVersion: 1,
    event: "domain_projection_phase15.real_clickhouse_e2e",
    status: "passed",
    runId,
    clickHouse: {host: "192.168.1.7", serverVersion: "24.10.2.1", release: "1.5.1-rc.2"},
    sourceLandingEvidence: `reports/domain-projection-v0.1/evidence/${runId}-phase-03-domain-source-e2e.json`,
    mappings: inputs.map((input, index) => ({
      mappingId: input.descriptor.mappingId,
      projectionId: input.descriptor.definition.projectionId,
      exactSource: input.descriptor.sourceQualifiedTable,
      exactTarget: input.descriptor.targetQualifiedTable,
      firstOutcome: firstOutcomes[index],
      replayOutcome: replayOutcomes[index],
      targetRows: afterReplay.target[index],
      lineageRows: afterReplay.lineage[index],
      checkpointRows: afterReplay.checkpoint[index],
    })),
    recovery: {
      signal: crashEvidence.signal,
      marker: crashEvidence.marker,
      afterCrash,
      restartOutcome: firstOutcomes[9],
    },
    checks: {
      exactTenMappings: inputs.length === 10,
      allTargetsVisible: afterReplay.target.every((count) => count === 1),
      lineageCoverage100Percent: afterReplay.lineage.every((count) => count === 1),
      checkpointsTerminalAndUnique: afterReplay.checkpoint.every((count) => count === 1),
      sameHashReplayIdempotent: replayOutcomes.every((outcome) => outcome === "duplicate"),
      realSigkillRecovery: crashEvidence.signal === "SIGKILL" && firstOutcomes[9] === "duplicate",
      projectionsLeftActivated: false,
      benchmarkScoringExecuted: false,
      nearNameLegacySourceUsed: false,
    },
  };
  const reportDirectory = path.resolve("reports/domain-projection-v0.1/evidence");
  await mkdir(reportDirectory, {recursive: true});
  const reportPath = path.join(reportDirectory, `${runId}-phase-15-domain-projection-e2e.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {mode: 0o644});
  process.stdout.write(`${JSON.stringify({event: report.event, status: report.status, runId, mappings: 10, reportPath: path.relative(process.cwd(), reportPath)})}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    event: "domain_projection_phase15.real_clickhouse_e2e",
    status: "failed",
    runId,
    errorCode: safeCode(error),
  })}\n`);
  process.exitCode = 1;
} finally {
  await rm(scratch, {recursive: true, force: true});
}

function closer(input: DomainTerminalCloseInput): DomainProjectionTerminalCloser {
  return new DomainProjectionTerminalCloser(
    new ClickHouseDomainTargetWriter(clickHouse),
    new ClickHouseDomainCheckpointCommitter(clickHouse, {
      descriptor: input.descriptor,
      mappingHash: input.mappingHash,
      projectionRunId: input.projectionRunId,
      sourceCursor: input.sourceCursor,
      projectedAt: input.projectedAt,
      lookbackMs: 1_800_000,
    }),
  );
}

function projectionInput(
  source: DomainSourceRecord,
  mappingHashes: ReadonlyMap<string, DomainSourceSha256>,
): DomainTerminalCloseInput {
  const descriptor = registry.resolveSource(source.sourceContractId);
  if (descriptor === undefined) fail("DOMAIN_PROJECTION_E2E_DESCRIPTOR_MISSING");
  const decision: DomainMappingDecision = source.sourceContractId.includes("/commander/")
    ? new CommanderDomainMapper().map(source)
    : new NpcDomainMapper().map(source);
  if (decision.kind !== "produce") fail("DOMAIN_PROJECTION_E2E_MAPPING_NOT_PRODUCED");
  const mappingHash = mappingHashes.get(descriptor.mappingId);
  if (mappingHash === undefined) fail("DOMAIN_PROJECTION_E2E_MAPPING_HASH_MISSING");
  return Object.freeze({
    descriptor,
    source,
    decision,
    mappingHash,
    projectionRunId: randomUUID(),
    sourceCursor: JSON.stringify({
      occurredAt: source.occurredAt,
      sequence: source.sequence,
      recordId: source.recordId,
      sourceRevision: source.sourceRevision,
    }),
    projectedAt: new Date().toISOString(),
  });
}

async function crashAfterTarget(input: DomainTerminalCloseInput): Promise<{signal: string; marker: string}> {
  const markerPath = path.join(scratch, "target-durable.marker");
  const inputPath = path.join(scratch, "crash-input.json");
  await writeFile(inputPath, JSON.stringify({
    source: input.source,
    mappingHash: input.mappingHash,
    projectionRunId: input.projectionRunId,
    sourceCursor: input.sourceCursor,
    projectedAt: input.projectedAt,
    markerPath,
  }), {mode: 0o600});
  const child = spawn(process.execPath, [
    "dist/tests/fixtures/domain-projection-e2e-crash-child.js",
    inputPath,
  ], {env: process.env, stdio: ["ignore", "ignore", "ignore"]});
  await waitForMarker(child, markerPath, 30_000);
  if (!child.kill("SIGKILL")) fail("DOMAIN_PROJECTION_E2E_SIGKILL_FAILED");
  await childExit(child);
  if (child.signalCode !== "SIGKILL") fail("DOMAIN_PROJECTION_E2E_SIGKILL_NOT_OBSERVED");
  return {signal: child.signalCode, marker: "target-durable-lineage-not-started"};
}

async function waitForMarker(child: ChildProcess, markerPath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(markerPath, "utf8")).trim() === "target-durable-lineage-not-started") return;
    } catch { /* marker is not durable yet */ }
    if (child.exitCode !== null || child.signalCode !== null) fail("DOMAIN_PROJECTION_E2E_CRASH_CHILD_EARLY_EXIT");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  fail("DOMAIN_PROJECTION_E2E_CRASH_MARKER_TIMEOUT");
}

async function childExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

async function runDomainSourceE2e(identity: string): Promise<void> {
  const child = spawn(process.execPath, ["dist/scripts/run-domain-source-e2e.js"], {
    env: {...process.env, SDAR_DOMAIN_PHASE3_RUN_ID: identity},
    stdio: ["ignore", "ignore", "ignore"],
  });
  await childExit(child);
  if (child.exitCode !== 0) fail("DOMAIN_PROJECTION_E2E_SOURCE_LANDING_FAILED");
}

async function verifyLiveRelease(client: ClickHouseClient): Promise<void> {
  const response = await client.query(
    `SELECT version() AS server_version,release_version,schema_contract_hash,release_descriptor_hash
     FROM sdar_meta.v_schema_contract_release_current LIMIT 1 FORMAT JSON`,
    {readonly: 2, maxResultRows: 1},
  );
  const row = parseRows(response)[0];
  if (
    row?.["server_version"] !== "24.10.2.1" ||
    row["release_version"] !== "1.5.1-rc.2" ||
    row["schema_contract_hash"] !== "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8" ||
    row["release_descriptor_hash"] !== "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335"
  ) fail("DOMAIN_PROJECTION_E2E_RELEASE_DRIFT");
}

async function allCounts(client: ClickHouseClient, inputs: readonly DomainTerminalCloseInput[]) {
  return {
    target: await projectionCounts(client, inputs, "target"),
    lineage: await projectionCounts(client, inputs, "lineage"),
    checkpoint: await projectionCounts(client, inputs, "checkpoint"),
  };
}

async function projectionCounts(
  client: ClickHouseClient,
  inputs: readonly DomainTerminalCloseInput[],
  kind: "target" | "lineage" | "checkpoint",
): Promise<number[]> {
  const counts: number[] = [];
  for (const input of inputs) {
    const source = input.source;
    let sql: string;
    if (kind === "target") {
      sql = `SELECT count() AS count FROM ${input.descriptor.targetQualifiedTable} FINAL
WHERE tenant_id=${stringExpression(source.tenantId)} AND project_id=${stringExpression(source.projectId)}
  AND projection_id=${stringExpression(input.descriptor.definition.projectionId)}
  AND source_record_id=${stringExpression(source.recordId)} FORMAT JSON`;
    } else if (kind === "lineage") {
      sql = `SELECT count() AS count FROM sdar_meta.projection_lineage FINAL
WHERE tenant_id=${stringExpression(source.tenantId)} AND project_id=${stringExpression(source.projectId)}
  AND projection_id=${stringExpression(input.descriptor.definition.projectionId)}
  AND source_record_id=${stringExpression(source.recordId)} FORMAT JSON`;
    } else {
      sql = `SELECT count() AS count FROM sdar_meta.projection_checkpoint FINAL
WHERE tenant_id=${stringExpression(source.tenantId)} AND project_id=${stringExpression(source.projectId)}
  AND projection_id=${stringExpression(input.descriptor.definition.projectionId)}
  AND episode_key=${stringExpression(source.episodeId)} FORMAT JSON`;
    }
    const count = Number(parseRows(await client.query(sql, {readonly: 2, maxResultRows: 1}))[0]?.["count"]);
    if (!Number.isSafeInteger(count) || count < 0) fail("DOMAIN_PROJECTION_E2E_COUNT_INVALID");
    counts.push(count);
  }
  return counts;
}

function assertAllOne(value: {target: number[]; lineage: number[]; checkpoint: number[]}, code: string): void {
  if ([...value.target, ...value.lineage, ...value.checkpoint].some((count) => count !== 1)) fail(code);
}

async function uniqueBatch(filename: string, identity: string): Promise<DomainSourceBatchRequest> {
  const value = JSON.parse(await readFile(
    path.resolve("integrations/domain-source/contracts/v1/fixtures/valid", filename),
    "utf8",
  )) as MutableBatch;
  value.batchId = `${value.application}-${identity}`;
  for (const [index, record] of value.records.entries()) {
    record.tenantId = `tenant-${identity}`;
    record.projectId = `project-${identity}`;
    record.environment = "test";
    record.recordId = `${identity}-${record.sourceContractId.split("/").at(-1)!}-${String(index)}`;
    record.episodeId = `episode-${identity}-${value.application}`;
    record.taskId = `task-${identity}-${value.application}`;
    record.contextId = `context-${identity}-${value.application}`;
    record.correlationId = `correlation-${identity}-${String(index)}`;
  }
  const {batchHash: _old, ...unsigned} = value;
  value.batchHash = createDomainSourceBatchHash(unsigned);
  return validator.assertBatch(value);
}

async function loadMappingHashes(): Promise<ReadonlyMap<string, DomainSourceSha256>> {
  const value = JSON.parse(await readFile(
    "integrations/domain-projection/mappings/v1/mapping-manifest.json",
    "utf8",
  )) as {mappings?: unknown};
  if (!Array.isArray(value.mappings)) fail("DOMAIN_PROJECTION_E2E_MAPPING_MANIFEST_INVALID");
  return new Map(value.mappings.map((entry) => {
    if (!isObject(entry) || typeof entry["mappingId"] !== "string" ||
      typeof entry["documentHash"] !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(entry["documentHash"])) {
      fail("DOMAIN_PROJECTION_E2E_MAPPING_MANIFEST_INVALID");
    }
    return [entry["mappingId"], entry["documentHash"] as DomainSourceSha256] as const;
  }));
}

function parseRows(text: string): Record<string, unknown>[] {
  const value = JSON.parse(text) as {data?: unknown};
  if (!Array.isArray(value.data) || !value.data.every(isObject)) fail("DOMAIN_PROJECTION_E2E_RESPONSE_INVALID");
  return value.data;
}
function stringExpression(value: string): string { return `reinterpretAsString(unhex('${Buffer.from(value, "utf8").toString("hex")}'))`; }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function safeCode(error: unknown): string { const code = isObject(error) ? error["code"] : undefined; return typeof code === "string" && /^[A-Z0-9_-]{3,128}$/u.test(code) ? code : "DOMAIN_PROJECTION_E2E_FAILED"; }
function fail(code: string): never { throw Object.assign(new Error(code), {code}); }

type MutableBatch = {
  -readonly [K in keyof DomainSourceBatchRequest]: K extends "records"
    ? Array<{-readonly [P in keyof DomainSourceRecord]: DomainSourceRecord[P]}>
    : DomainSourceBatchRequest[K];
};
