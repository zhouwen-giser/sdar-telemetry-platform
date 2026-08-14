import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  EVIDENCE_CONTRACT_HEADER,
  EVIDENCE_CONTRACT_VERSION,
  createIngestionGateway,
} from "../apps/ingestion-gateway/src/server.js";
import {
  EVIDENCE_V1_CANONICAL_TABLE,
  EVIDENCE_V1_CONTRACT,
  clickHouseStringExpression,
  createQueryApi,
} from "../apps/query-api/src/server.js";
import { TelemetryWorker, type WorkerCycleResult } from "../apps/telemetry-worker/src/worker.js";
import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";
import type { ClickHouseConfig } from "../packages/telemetry-clickhouse/src/index.js";
import {
  canonicalizeEvidenceJson,
  createEvidenceRecordId,
  hashCanonicalEvidenceJson,
  loadEvidenceV1Validator,
} from "../packages/telemetry-contracts/src/index.js";
import {
  ProjectionRegistry,
  canonicalProjection,
  smppProjection,
  v13Projection,
  v14Projection,
} from "../packages/telemetry-projection-registry/src/index.js";
import type {
  EvidenceV1BatchAcknowledgement,
  EvidenceV1BatchRequest,
  EvidenceV1Record,
  EvidenceV1WalPayload,
} from "../packages/telemetry-types/src/index.js";
import {
  DurableSegmentWal,
  evidenceWalPartition,
} from "../packages/telemetry-wal/src/index.js";
import {
  runWorkerProcessCrashRecovery,
  type WorkerProcessCrashEvidence,
} from "./worker-process-crash-harness.js";

const FIXTURE_RELATIVE_PATH =
  "integrations/skill-driven-agent-runtime/v1.4.1/reports/v1.4.1-evidence/clickhouse-handoff/sample-batches/valid-batch.json";
const SCHEMA_RELATIVE_PATH =
  "integrations/skill-driven-agent-runtime/v1.4.1/schemas/evidence/v1";
const REPORT_DIRECTORY = "reports/sdar-integration/evidence";
const TARGET_HOST = "192.168.1.7";
const RUN_ID_PATTERN = /^codex_it_[A-Za-z0-9._-]+$/u;

export interface EvidenceBatchMetadata {
  readonly contractVersion: "sdar.evidence/v1";
  readonly exportId: string;
  readonly sourceId: string;
  readonly nodeId: string;
  readonly revision: number;
  readonly batchHash: string;
  readonly firstSequence: string;
  readonly lastSequence: string;
  readonly records: readonly EvidenceRecordMetadata[];
}

export interface EvidenceRecordMetadata {
  readonly recordId: string;
  readonly recordType: string;
  readonly payloadHash: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: string;
  readonly taskId: string | null;
  readonly episodeId: string | null;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly correlationId: string;
  readonly evidenceSequence: string;
}

export interface TraceSummary {
  readonly rowCount: number;
  readonly recordIds: readonly string[];
  readonly rowIds: readonly string[];
  readonly payloadHashes: readonly string[];
  readonly walPayloadHashes: readonly string[];
}

export interface SdarE2eEvidenceReportInput {
  readonly runId: string;
  readonly generatedAt: string;
  readonly fixtureSha256: string;
  readonly fixture: EvidenceV1BatchRequest;
  readonly batch: EvidenceV1BatchRequest;
  readonly tableEngine: string;
  readonly gateway: {
    readonly headStatus: number;
    readonly postStatus: number;
    readonly acknowledgement: EvidenceV1BatchAcknowledgement;
    readonly restartPostStatus: number;
    readonly restartAcknowledgement: EvidenceV1BatchAcknowledgement;
  };
  readonly wal: {
    readonly partition: string;
    readonly bytesAfterPost: number;
    readonly bytesAfterRestartDuplicate: number;
    readonly frameCount: number;
    readonly payloadHash: string;
  };
  readonly worker: {
    readonly initial: WorkerCycleResult;
    readonly replayFromFreshState: WorkerCycleResult;
  };
  readonly clickHouseOutage: ClickHouseOutageEvidence;
  readonly workerProcessCrash: WorkerProcessCrashEvidence;
  readonly query: {
    readonly watermarkBeforeReplay: string;
    readonly watermarkAfterReplay: string;
    readonly beforeReplay: TraceSummary;
    readonly afterReplay: TraceSummary;
  };
}

export interface ClickHouseOutageEvidence {
  readonly targetHost: typeof TARGET_HOST;
  readonly unreachablePort: 1;
  readonly unauthenticatedPortPreflight: "unreachable";
  readonly connectionErrorCode:
    | "CLICKHOUSE_REQUEST_FAILED"
    | "CLICKHOUSE_CONNECT_TIMEOUT"
    | "CLICKHOUSE_REQUEST_TIMEOUT";
  readonly checkpointBeforeFailure: -1;
  readonly checkpointAfterFailure: -1;
  readonly walFramesBeforeFailure: number;
  readonly walFramesAfterFailure: number;
  readonly walBytesBeforeFailure: number;
  readonly walBytesAfterFailure: number;
  readonly recovery: WorkerCycleResult;
  readonly checkpointAfterRecovery: 0;
}

export function assertIntegrationRunId(value: string | undefined): string {
  if (
    value === undefined ||
    value.length > 180 ||
    !RUN_ID_PATTERN.test(value) ||
    value.includes("..")
  ) {
    throw e2eError("SDAR_E2E_RUN_ID_INVALID");
  }
  return value;
}

/**
 * Derives a unique wire envelope while retaining every fixture payload byte-for-byte in canonical
 * JSON terms. Runtime payload facts are not rewritten or synthesized by this harness.
 */
export function deriveEvidenceBatch(
  fixture: EvidenceV1BatchRequest,
  integrationRunId: string,
): EvidenceV1BatchRequest {
  const runId = assertIntegrationRunId(integrationRunId);
  const identityRecords = fixture.records.map((record, index) => {
    const identity = {
      ...record,
      sourceRecordId: `${runId}:source-record:${String(index + 1)}:${record.sourceRecordId}`,
      sourceRevision: `${runId}:source-revision:${record.sourceRevision}`,
      taskId: `${runId}:task:${String(index + 1)}`,
      episodeId: `${runId}:episode:${String(index + 1)}`,
      runId,
      nodeId: `${runId}:node`,
      correlationId: `${runId}:correlation:${String(index + 1)}`,
    };
    return {
      ...identity,
      recordId: createEvidenceRecordId(identity),
    } satisfies EvidenceV1Record;
  });
  const derivedIds = new Map<string, string>(
    fixture.records.map((record, index) => [
      record.recordId,
      (identityRecords[index] as EvidenceV1Record).recordId,
    ]),
  );
  const records = identityRecords.map((record) => ({
    ...record,
    evidenceRefs: record.evidenceRefs.map((reference) => derivedIds.get(reference) ?? reference),
  })) satisfies EvidenceV1Record[];

  const unsigned = {
    contractVersion: fixture.contractVersion,
    exportId: `${runId}:export`,
    sourceId: `${runId}:source`,
    nodeId: `${runId}:node`,
    revision: fixture.revision,
    firstSequence: records[0]?.evidenceSequence ?? fixture.firstSequence,
    lastSequence: records.at(-1)?.evidenceSequence ?? fixture.lastSequence,
    records,
  } satisfies Omit<EvidenceV1BatchRequest, "batchHash">;
  return {
    ...unsigned,
    batchHash: hashCanonicalEvidenceJson(unsigned),
  };
}

export function evidenceBatchMetadata(batch: EvidenceV1BatchRequest): EvidenceBatchMetadata {
  return {
    contractVersion: batch.contractVersion,
    exportId: batch.exportId,
    sourceId: batch.sourceId,
    nodeId: batch.nodeId,
    revision: batch.revision,
    batchHash: batch.batchHash,
    firstSequence: batch.firstSequence,
    lastSequence: batch.lastSequence,
    records: batch.records.map((record) => ({
      recordId: record.recordId,
      recordType: record.recordType,
      payloadHash: record.payloadHash,
      sourceRecordId: record.sourceRecordId,
      sourceRevision: record.sourceRevision,
      taskId: record.taskId ?? null,
      episodeId: record.episodeId ?? null,
      runId: record.runId ?? null,
      nodeId: record.nodeId ?? null,
      correlationId: record.correlationId,
      evidenceSequence: record.evidenceSequence,
    })),
  };
}

export function createSdarE2eEvidenceReport(
  input: SdarE2eEvidenceReportInput,
): Record<string, unknown> {
  const runId = assertIntegrationRunId(input.runId);
  const payloadsPreserved = input.fixture.records.every((record, index) => {
    const derived = input.batch.records[index];
    return (
      derived !== undefined &&
      record.payloadHash === derived.payloadHash &&
      canonicalizeEvidenceJson(record.payload) === canonicalizeEvidenceJson(derived.payload)
    );
  });
  const effectiveRowsStable =
    canonicalizeEvidenceJson(input.query.beforeReplay) ===
    canonicalizeEvidenceJson(input.query.afterReplay);
  return {
    schemaVersion: 2,
    kind: "sdar-fixture-e2e",
    status: "passed",
    generatedAt: input.generatedAt,
    runId,
    contractVersion: EVIDENCE_V1_CONTRACT,
    fixture: {
      path: FIXTURE_RELATIVE_PATH,
      sha256: input.fixtureSha256,
      batchHash: input.fixture.batchHash,
      payloadHashes: input.fixture.records.map((record) => record.payloadHash),
      payloadsPreserved,
    },
    derivedBatch: evidenceBatchMetadata(input.batch),
    target: {
      host: TARGET_HOST,
      table: EVIDENCE_V1_CANONICAL_TABLE,
      engine: input.tableEngine,
      tablePreflight: "passed",
      queryReadonly: 2,
    },
    gateway: input.gateway,
    outageBacklog: {
      workerRunningDuringIngest: false,
      durableFrames: input.wal.frameCount,
      durableBytes: input.wal.bytesAfterPost,
      walPayloadHash: input.wal.payloadHash,
    },
    restartDeduplication: {
      partition: input.wal.partition,
      framesAfterDuplicate: input.wal.frameCount,
      bytesBeforeDuplicate: input.wal.bytesAfterPost,
      bytesAfterDuplicate: input.wal.bytesAfterRestartDuplicate,
      walDidNotGrow: input.wal.bytesAfterPost === input.wal.bytesAfterRestartDuplicate,
    },
    worker: input.worker,
    clickHouseOutage: input.clickHouseOutage,
    workerProcessCrash: input.workerProcessCrash,
    query: {
      route: "/v1/evidence/trace",
      filter: { exportId: input.batch.exportId },
      watermarkBeforeReplay: input.query.watermarkBeforeReplay,
      watermarkAfterReplay: input.query.watermarkAfterReplay,
      beforeReplay: input.query.beforeReplay,
      afterReplay: input.query.afterReplay,
    },
    checks: {
      fixtureValidated: true,
      derivedBatchValidated: true,
      payloadsPreserved,
      durableBeforeWorker: input.wal.frameCount === 1 && input.wal.bytesAfterPost > 0,
      gatewayRestartIdempotent:
        input.wal.frameCount === 1 &&
        input.wal.bytesAfterPost === input.wal.bytesAfterRestartDuplicate,
      exactAcknowledgement:
        input.gateway.acknowledgement.lastAcknowledgedSequence === input.batch.lastSequence &&
        input.gateway.restartAcknowledgement.lastAcknowledgedSequence === input.batch.lastSequence,
      exactTraceIdentity:
        input.query.beforeReplay.recordIds.length === input.batch.records.length,
      effectiveRowsStableAfterReplay: effectiveRowsStable,
      clickHouseOutagePreservedBacklog:
        input.clickHouseOutage.unauthenticatedPortPreflight === "unreachable" &&
        input.clickHouseOutage.checkpointBeforeFailure === -1 &&
        input.clickHouseOutage.checkpointAfterFailure === -1 &&
        input.clickHouseOutage.walFramesBeforeFailure === input.wal.frameCount &&
        input.clickHouseOutage.walFramesAfterFailure === input.wal.frameCount &&
        input.clickHouseOutage.walBytesBeforeFailure === input.wal.bytesAfterRestartDuplicate &&
        input.clickHouseOutage.walBytesAfterFailure === input.wal.bytesAfterRestartDuplicate,
      clickHouseOutageRecovered:
        input.clickHouseOutage.recovery.framesCompleted === 1 &&
        input.clickHouseOutage.recovery.writesCompleted >= 1 &&
        input.clickHouseOutage.checkpointAfterRecovery === 0,
      workerProcessKilled:
        input.workerProcessCrash.isolation === "independent-os-process" &&
        input.workerProcessCrash.signal === "SIGKILL" &&
        input.workerProcessCrash.exitCode === null,
      workerProcessRestartSafe:
        input.workerProcessCrash.checkpointBeforeRestart === -1 &&
        input.workerProcessCrash.checkpointAfterRestart === 0 &&
        input.workerProcessCrash.stablePendingWriteIdentity &&
        input.workerProcessCrash.stableRecordIdentity &&
        input.workerProcessCrash.skippedCompletedProjectionOnRestart,
    },
  };
}

export function assertTraceRows(
  batch: EvidenceV1BatchRequest,
  rows: readonly unknown[],
  expectedWal: Readonly<{ partition: string; payloadHash: string }>,
): TraceSummary {
  if (rows.length !== batch.records.length) throw e2eError("SDAR_E2E_TRACE_COUNT_MISMATCH");
  const byRecordId = new Map<string, Record<string, unknown>>();
  for (const candidate of rows) {
    if (!isRecord(candidate) || typeof candidate["record_id"] !== "string") {
      throw e2eError("SDAR_E2E_TRACE_ROW_INVALID");
    }
    if (byRecordId.has(candidate["record_id"])) {
      throw e2eError("SDAR_E2E_TRACE_DUPLICATE");
    }
    byRecordId.set(candidate["record_id"], candidate);
  }

  const rowIds: string[] = [];
  const payloadHashes: string[] = [];
  const walPayloadHashes: string[] = [];
  for (const record of batch.records) {
    const row = byRecordId.get(record.recordId);
    if (row === undefined) throw e2eError("SDAR_E2E_TRACE_IDENTITY_MISMATCH");
    assertRowValue(row, "fact_id", record.recordId);
    assertRowValue(row, "contract_version", batch.contractVersion);
    assertRowValue(row, "export_id", batch.exportId);
    assertRowValue(row, "source_id", batch.sourceId);
    assertRowValue(row, "source_type", "sdar-evidence-v1");
    assertRowValue(row, "batch_node_id", batch.nodeId);
    assertRowValue(row, "batch_hash", batch.batchHash);
    assertRowValue(row, "first_sequence", batch.firstSequence);
    assertRowValue(row, "last_sequence", batch.lastSequence);
    assertRowValue(row, "evidence_sequence", record.evidenceSequence);
    assertRowValue(row, "record_id", record.recordId);
    assertRowValue(row, "payload_hash", record.payloadHash);
    assertRowValue(row, "source_record_id", record.sourceRecordId);
    assertRowValue(row, "source_revision", record.sourceRevision);
    assertRowValue(row, "task_id", record.taskId ?? null);
    assertRowValue(row, "episode_id", record.episodeId ?? null);
    assertRowValue(row, "run_id", record.runId ?? null);
    assertRowValue(row, "node_id", record.nodeId ?? null);
    assertRowValue(row, "correlation_id", record.correlationId);
    assertRowValue(row, "wal_partition", expectedWal.partition);
    assertRowValue(row, "wal_payload_hash", expectedWal.payloadHash);
    if (Number(row["export_revision"]) !== batch.revision || Number(row["wal_offset"]) !== 0) {
      throw e2eError("SDAR_E2E_TRACE_LINEAGE_MISMATCH");
    }
    assertJsonColumn(row, "payload_json", record.payload);
    assertJsonColumn(row, "record_json", record);

    const rowId = row["row_id"];
    if (typeof rowId !== "string" || !/^[0-9a-f]{64}$/u.test(rowId)) {
      throw e2eError("SDAR_E2E_TRACE_ROW_ID_INVALID");
    }
    rowIds.push(rowId);
    payloadHashes.push(record.payloadHash);
    walPayloadHashes.push(expectedWal.payloadHash);
  }
  return {
    rowCount: rows.length,
    recordIds: batch.records.map((record) => record.recordId).sort(),
    rowIds: rowIds.sort(),
    payloadHashes: payloadHashes.sort(),
    walPayloadHashes: walPayloadHashes.sort(),
  };
}

export async function runSdarE2E(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ reportPath: string; report: Record<string, unknown> }> {
  const runId = assertIntegrationRunId(environment["SDAR_INTEGRATION_RUN_ID"]);
  const schemaRoot = path.resolve(environment["SDAR_EVIDENCE_SCHEMA_ROOT"] ?? SCHEMA_RELATIVE_PATH);
  const fixturePath = path.resolve(FIXTURE_RELATIVE_PATH);
  const reportPath = path.resolve(REPORT_DIRECTORY, `${runId}-fixture-e2e.json`);
  await assertPathAbsent(reportPath, "SDAR_E2E_REPORT_EXISTS");

  const fixtureBytes = await readFile(fixturePath);
  const validator = await loadEvidenceV1Validator(schemaRoot);
  const fixture = validator.assertBatch(JSON.parse(fixtureBytes.toString("utf8")) as unknown);
  const batch = validator.assertBatch(deriveEvidenceBatch(fixture, runId));
  if (
    !fixture.records.every(
      (record, index) =>
        batch.records[index] !== undefined &&
        record.payloadHash === batch.records[index]?.payloadHash &&
        canonicalizeEvidenceJson(record.payload) ===
          canonicalizeEvidenceJson(batch.records[index]?.payload),
    )
  ) {
    throw e2eError("SDAR_E2E_PAYLOAD_CHANGED");
  }

  const writerConfig = configFromEnv("CLICKHOUSE_");
  const writer = new ClickHouseClient(writerConfig);
  const reader = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));
  const tableEngine = await externalStage(
    "SDAR_E2E_TABLE_PREFLIGHT_FAILED",
    async () => assertCanonicalTableExists(reader),
  );
  await externalStage("SDAR_E2E_UNIQUENESS_PREFLIGHT_FAILED", async () =>
    assertExportIsUnique(reader, batch.exportId),
  );

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `sdar-e2e-${runId}-`));
  const walRoot = path.join(temporaryRoot, "wal");
  const stateRoot = path.join(temporaryRoot, "worker-state");
  const replayStateRoot = path.join(temporaryRoot, "worker-replay-state");
  const credential = randomBytes(32).toString("base64url");
  const queryCredential = randomBytes(32).toString("base64url");
  const partition = evidenceWalPartition({
    exportId: batch.exportId,
    sourceId: batch.sourceId,
    nodeId: batch.nodeId,
    revision: batch.revision,
  });
  let gateway: Server | undefined;
  let queryApi: Server | undefined;
  try {
    const initialWal = new DurableSegmentWal<EvidenceV1WalPayload>(walRoot);
    gateway = createIngestionGateway({ validator, wal: initialWal, bearerCredential: credential });
    const firstGatewayUrl = await listenOnLoopback(gateway);
    const headStatus = await probeGateway(firstGatewayUrl, credential);
    const firstPost = await postBatch(firstGatewayUrl, credential, batch);
    await closeServer(gateway);
    gateway = undefined;

    const bytesAfterPost = await initialWal.size();
    const durableFrames = await initialWal.recover(partition);
    if (durableFrames.length !== 1 || bytesAfterPost < 1) {
      throw e2eError("SDAR_E2E_WAL_NOT_DURABLE");
    }
    const durableFrame = durableFrames[0];
    if (
      durableFrame === undefined ||
      durableFrame.payload.batch.batchHash !== batch.batchHash ||
      durableFrame.payload.batch.records.length !== batch.records.length
    ) {
      throw e2eError("SDAR_E2E_WAL_IDENTITY_MISMATCH");
    }

    const restartedWal = new DurableSegmentWal<EvidenceV1WalPayload>(walRoot);
    gateway = createIngestionGateway({ validator, wal: restartedWal, bearerCredential: credential });
    const restartedGatewayUrl = await listenOnLoopback(gateway);
    const restartPost = await postBatch(restartedGatewayUrl, credential, batch);
    await closeServer(gateway);
    gateway = undefined;
    const bytesAfterRestartDuplicate = await restartedWal.size();
    if (
      bytesAfterRestartDuplicate !== bytesAfterPost ||
      (await restartedWal.recover(partition)).length !== 1
    ) {
      throw e2eError("SDAR_E2E_GATEWAY_RESTART_DUPLICATE");
    }

    const registry = currentProjectionRegistry();
    await assertTcpPortUnreachable(TARGET_HOST, 1);
    const outageWorker = new TelemetryWorker({
      wal: restartedWal,
      clickhouse: new ClickHouseClient(unreachableClickHouseConfig(writerConfig)),
      projector: registry,
      stateRoot,
    });
    const checkpointBeforeFailure = await outageWorker.checkpoint(partition);
    const walFramesBeforeFailure = (await restartedWal.recover(partition)).length;
    const walBytesBeforeFailure = await restartedWal.size();
    let connectionErrorCode: ClickHouseOutageEvidence["connectionErrorCode"];
    try {
      await outageWorker.processOnce();
      throw e2eError("SDAR_E2E_CLICKHOUSE_OUTAGE_NOT_OBSERVED");
    } catch (error) {
      const code = safeErrorCode(error);
      if (
        code !== "CLICKHOUSE_REQUEST_FAILED" &&
        code !== "CLICKHOUSE_CONNECT_TIMEOUT" &&
        code !== "CLICKHOUSE_REQUEST_TIMEOUT"
      ) {
        throw e2eError("SDAR_E2E_CLICKHOUSE_OUTAGE_NOT_TRANSPORT_FAILURE");
      }
      connectionErrorCode = code;
    }
    const checkpointAfterFailure = await outageWorker.checkpoint(partition);
    const walFramesAfterFailure = (await restartedWal.recover(partition)).length;
    const walBytesAfterFailure = await restartedWal.size();
    if (
      checkpointBeforeFailure !== -1 ||
      checkpointAfterFailure !== -1 ||
      walFramesBeforeFailure !== durableFrames.length ||
      walFramesAfterFailure !== durableFrames.length ||
      walBytesBeforeFailure !== bytesAfterRestartDuplicate ||
      walBytesAfterFailure !== bytesAfterRestartDuplicate
    ) {
      throw e2eError("SDAR_E2E_CLICKHOUSE_OUTAGE_MOVED_DURABLE_STATE");
    }

    const worker = new TelemetryWorker({
      wal: restartedWal,
      clickhouse: writer,
      projector: registry,
      stateRoot,
    });
    const initialCycle = await externalStage(
      "SDAR_E2E_INITIAL_PROJECTION_FAILED",
      async () => worker.processOnce(),
    );
    if (initialCycle.framesCompleted !== 1 || initialCycle.writesCompleted < 1) {
      throw e2eError("SDAR_E2E_WORKER_DID_NOT_PROJECT");
    }
    const checkpointAfterRecovery = await worker.checkpoint(partition);
    if (checkpointAfterRecovery !== 0) {
      throw e2eError("SDAR_E2E_CLICKHOUSE_RECOVERY_CHECKPOINT_INVALID");
    }
    const clickHouseOutage: ClickHouseOutageEvidence = {
      targetHost: TARGET_HOST,
      unreachablePort: 1,
      unauthenticatedPortPreflight: "unreachable",
      connectionErrorCode,
      checkpointBeforeFailure: -1,
      checkpointAfterFailure: -1,
      walFramesBeforeFailure,
      walFramesAfterFailure,
      walBytesBeforeFailure,
      walBytesAfterFailure,
      recovery: initialCycle,
      checkpointAfterRecovery: 0,
    };

    const workerProcessCrash = await runWorkerProcessCrashRecovery(batch, temporaryRoot);

    queryApi = createQueryApi({
      clickHouse: reader,
      bearerCredential: queryCredential,
      maxResultRows: 1_000,
    });
    const queryApiUrl = await listenOnLoopback(queryApi);
    const beforeReplayEnvelope = await externalStage(
      "SDAR_E2E_INITIAL_QUERY_FAILED",
      async () => queryTrace(queryApiUrl, batch.exportId, queryCredential),
    );
    const beforeReplay = assertTraceRows(batch, beforeReplayEnvelope.rows, {
      partition,
      payloadHash: durableFrame.payloadHash,
    });

    // A fresh state root deliberately replays the committed WAL frame. Stable rows and the
    // deterministic insert token must leave the FINAL/effective query result unchanged.
    const replayWorker = new TelemetryWorker({
      wal: restartedWal,
      clickhouse: writer,
      projector: currentProjectionRegistry(),
      stateRoot: replayStateRoot,
    });
    const replayCycle = await externalStage(
      "SDAR_E2E_REPLAY_PROJECTION_FAILED",
      async () => replayWorker.processOnce(),
    );
    if (replayCycle.framesCompleted !== 1 || replayCycle.writesCompleted < 1) {
      throw e2eError("SDAR_E2E_WORKER_REPLAY_NOT_EXERCISED");
    }
    const afterReplayEnvelope = await externalStage(
      "SDAR_E2E_REPLAY_QUERY_FAILED",
      async () => queryTrace(queryApiUrl, batch.exportId, queryCredential),
    );
    const afterReplay = assertTraceRows(batch, afterReplayEnvelope.rows, {
      partition,
      payloadHash: durableFrame.payloadHash,
    });
    if (canonicalizeEvidenceJson(beforeReplay) !== canonicalizeEvidenceJson(afterReplay)) {
      throw e2eError("SDAR_E2E_EFFECTIVE_DUPLICATE");
    }

    const generatedAt = new Date().toISOString();
    const report = createSdarE2eEvidenceReport({
      runId,
      generatedAt,
      fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"),
      fixture,
      batch,
      tableEngine,
      gateway: {
        headStatus,
        postStatus: firstPost.status,
        acknowledgement: firstPost.acknowledgement,
        restartPostStatus: restartPost.status,
        restartAcknowledgement: restartPost.acknowledgement,
      },
      wal: {
        partition,
        bytesAfterPost,
        bytesAfterRestartDuplicate,
        frameCount: durableFrames.length,
        payloadHash: durableFrame.payloadHash,
      },
      worker: { initial: initialCycle, replayFromFreshState: replayCycle },
      clickHouseOutage,
      workerProcessCrash,
      query: {
        watermarkBeforeReplay: beforeReplayEnvelope.watermark,
        watermarkAfterReplay: afterReplayEnvelope.watermark,
        beforeReplay,
        afterReplay,
      },
    });
    assertPassingReport(report);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return { reportPath, report };
  } finally {
    if (gateway !== undefined) await closeServer(gateway).catch(() => undefined);
    if (queryApi !== undefined) await closeServer(queryApi).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function unreachableClickHouseConfig(config: ClickHouseConfig): ClickHouseConfig {
  const endpoint = new URL(config.url);
  endpoint.port = "1";
  return {
    ...config,
    url: endpoint.toString(),
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 1_500,
  };
}

async function assertTcpPortUnreachable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve();
    }, 1_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(e2eError("SDAR_E2E_UNREACHABLE_PORT_ACCEPTED_CONNECTION"));
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
  });
}

function currentProjectionRegistry(): ProjectionRegistry {
  const registry = new ProjectionRegistry();
  for (const projection of [canonicalProjection, v13Projection, v14Projection, smppProjection]) {
    registry.register(projection);
  }
  return registry;
}

async function assertCanonicalTableExists(reader: ClickHouseClient): Promise<string> {
  const rows = await clickHouseRows(
    reader,
    `SELECT engine
FROM system.tables
WHERE database = 'sdar_core' AND name = 'sdar_evidence_v1_record'
FORMAT JSON`,
    2,
  );
  if (rows.length !== 1 || rows[0]?.["engine"] !== "ReplacingMergeTree") {
    throw e2eError("SDAR_E2E_CANONICAL_TABLE_MISSING");
  }
  return rows[0]["engine"] as string;
}

async function assertExportIsUnique(reader: ClickHouseClient, exportId: string): Promise<void> {
  const rows = await clickHouseRows(
    reader,
    `SELECT count() AS row_count
FROM ${EVIDENCE_V1_CANONICAL_TABLE} FINAL
WHERE export_id = ${clickHouseStringExpression(exportId)}
FORMAT JSON`,
    1,
  );
  if (rows.length !== 1 || Number(rows[0]?.["row_count"]) !== 0) {
    throw e2eError("SDAR_E2E_RUN_ID_NOT_UNIQUE");
  }
}

async function clickHouseRows(
  reader: ClickHouseClient,
  sql: string,
  maxResultRows: number,
): Promise<Record<string, unknown>[]> {
  const raw = await reader.query(sql, { readonly: 2, maxResultRows });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw e2eError("SDAR_E2E_CLICKHOUSE_RESPONSE_INVALID");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["data"]) || !parsed["data"].every(isRecord)) {
    throw e2eError("SDAR_E2E_CLICKHOUSE_RESPONSE_INVALID");
  }
  return parsed["data"] as Record<string, unknown>[];
}

async function probeGateway(baseUrl: string, credential: string): Promise<number> {
  const response = await fetch(`${baseUrl}/v1/evidence/batches`, {
    method: "HEAD",
    headers: gatewayHeaders(credential, false),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 204) throw e2eError("SDAR_E2E_GATEWAY_PROBE_FAILED");
  return response.status;
}

async function postBatch(
  baseUrl: string,
  credential: string,
  batch: EvidenceV1BatchRequest,
): Promise<{ status: number; acknowledgement: EvidenceV1BatchAcknowledgement }> {
  const response = await fetch(`${baseUrl}/v1/evidence/batches`, {
    method: "POST",
    headers: gatewayHeaders(credential, true),
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(30_000),
  });
  let acknowledgement: unknown;
  try {
    acknowledgement = await response.json();
  } catch {
    throw e2eError("SDAR_E2E_GATEWAY_RESPONSE_INVALID");
  }
  if (
    response.status !== 202 ||
    !isRecord(acknowledgement) ||
    Object.keys(acknowledgement).length !== 1 ||
    acknowledgement["lastAcknowledgedSequence"] !== batch.lastSequence
  ) {
    throw e2eError("SDAR_E2E_GATEWAY_ACK_INVALID");
  }
  return {
    status: response.status,
    acknowledgement: acknowledgement as unknown as EvidenceV1BatchAcknowledgement,
  };
}

function gatewayHeaders(credential: string, contentType: boolean): Record<string, string> {
  return {
    authorization: `Bearer ${credential}`,
    [EVIDENCE_CONTRACT_HEADER]: EVIDENCE_CONTRACT_VERSION,
    ...(contentType ? { "content-type": "application/json" } : {}),
  };
}

async function queryTrace(
  baseUrl: string,
  exportId: string,
  credential: string,
): Promise<{ rows: readonly unknown[]; watermark: string }> {
  const url = new URL(`${baseUrl}/v1/evidence/trace`);
  url.searchParams.set("exportId", exportId);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${credential}` },
    signal: AbortSignal.timeout(30_000),
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw e2eError("SDAR_E2E_QUERY_RESPONSE_INVALID");
  }
  if (
    response.status !== 200 ||
    !isRecord(value) ||
    !Array.isArray(value["data"]) ||
    typeof value["watermark"] !== "string" ||
    !isRecord(value["sourceCoverage"]) ||
    canonicalizeEvidenceJson(value["sourceCoverage"]) !==
      canonicalizeEvidenceJson({
        expected: [EVIDENCE_V1_CONTRACT],
        observed: [EVIDENCE_V1_CONTRACT],
      })
  ) {
    throw e2eError("SDAR_E2E_QUERY_RESPONSE_INVALID");
  }
  return { rows: value["data"], watermark: value["watermark"] };
}

async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw e2eError("SDAR_E2E_SERVER_ADDRESS_INVALID");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
  });
}

function assertRowValue(row: Record<string, unknown>, field: string, expected: unknown): void {
  if (row[field] !== expected) throw e2eError("SDAR_E2E_TRACE_LINEAGE_MISMATCH");
}

function assertJsonColumn(
  row: Record<string, unknown>,
  field: string,
  expected: unknown,
): void {
  if (typeof row[field] !== "string") throw e2eError("SDAR_E2E_TRACE_JSON_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(row[field]);
  } catch {
    throw e2eError("SDAR_E2E_TRACE_JSON_INVALID");
  }
  if (canonicalizeEvidenceJson(parsed) !== canonicalizeEvidenceJson(expected)) {
    throw e2eError("SDAR_E2E_TRACE_JSON_MISMATCH");
  }
}

function assertPassingReport(report: Record<string, unknown>): void {
  const checks = report["checks"];
  if (!isRecord(checks) || !Object.values(checks).every((value) => value === true)) {
    throw e2eError("SDAR_E2E_EVIDENCE_CHECK_FAILED");
  }
}

async function assertPathAbsent(filename: string, code: string): Promise<void> {
  try {
    await access(filename);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  throw e2eError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

function e2eError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function externalStage<T>(code: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const httpStatus = /\bHTTP ([0-9]{3})\b/u.exec(message)?.[1];
    const clickHouseCode = /\bCode:\s*([0-9]{1,5})\b/u.exec(message)?.[1];
    const suffix = [
      ...(httpStatus === undefined ? [] : [`HTTP_${httpStatus}`]),
      ...(clickHouseCode === undefined ? [] : [`CH_${clickHouseCode}`]),
    ].join("_");
    throw e2eError(suffix === "" ? code : `${code}_${suffix}`);
  }
}

function safeErrorCode(error: unknown): string {
  if (
    isRecord(error) &&
    typeof error["code"] === "string" &&
    /^[A-Z][A-Z0-9_]{2,127}$/u.test(error["code"])
  ) {
    return error["code"];
  }
  return "SDAR_E2E_FAILED";
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    pathToFileURL(path.resolve(entrypoint)).href === import.meta.url
  );
}

if (isMainModule()) {
  try {
    const result = await runSdarE2E();
    process.stdout.write(
      `${JSON.stringify({
        status: "passed",
        runId: result.report["runId"],
        report: path.relative(process.cwd(), result.reportPath),
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ status: "failed", errorCode: safeErrorCode(error) })}\n`,
    );
    process.exitCode = 1;
  }
}
