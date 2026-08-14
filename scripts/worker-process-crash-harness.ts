import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EvidenceV1BatchRequest,
  EvidenceV1WalPayload,
} from "../packages/telemetry-types/src/index.js";
import {
  DurableSegmentWal,
  evidenceWalPartition,
} from "../packages/telemetry-wal/src/index.js";

const FIRST_TABLE = "sdar_core.a_projection";
const SECOND_TABLE = "sdar_core.b_projection";

interface PersistedWrite {
  readonly table: string;
  readonly writeIdentity: string;
  readonly recordIds: readonly string[];
}

interface ChildMessage {
  readonly type: "blocked-before-second-write" | "completed" | "failed";
  readonly errorCode?: string;
}

export interface WorkerProcessCrashEvidence {
  readonly isolation: "independent-os-process";
  readonly injectedTermination: "SIGKILL";
  readonly exitCode: null;
  readonly signal: "SIGKILL";
  readonly checkpointBeforeRestart: -1;
  readonly completedWritesBeforeCrash: number;
  readonly pendingTableAtCrash: string;
  readonly restartWrites: number;
  readonly resumedTables: readonly string[];
  readonly checkpointAfterRestart: 0;
  readonly persistedTables: readonly string[];
  readonly stablePendingWriteIdentity: boolean;
  readonly stableRecordIdentity: boolean;
  readonly skippedCompletedProjectionOnRestart: boolean;
}

/**
 * Exercises the worker in an actual child process. The child uses only a file-backed test sink;
 * production worker code has no environment-controlled failpoint. The parent sends SIGKILL after
 * projection A and its worker journal are durable, while projection B is blocked before commit.
 */
export async function runWorkerProcessCrashRecovery(
  batch: EvidenceV1BatchRequest,
  temporaryRoot: string,
): Promise<WorkerProcessCrashEvidence> {
  const root = path.join(temporaryRoot, "worker-process-crash");
  const walRoot = path.join(root, "wal");
  const stateRoot = path.join(root, "state");
  const sinkRoot = path.join(root, "sink");
  const batchPath = path.join(root, "batch.json");
  await mkdir(root, { recursive: true });
  await writeFile(batchPath, `${JSON.stringify(batch)}\n`, { mode: 0o600, flag: "wx" });

  const wal = new DurableSegmentWal<EvidenceV1WalPayload>(walRoot);
  const partition = evidenceWalPartition({
    exportId: batch.exportId,
    sourceId: batch.sourceId,
    nodeId: batch.nodeId,
    revision: batch.revision,
  });
  await wal.append(partition, {
    kind: "sdar-evidence-v1",
    receivedAt: "2026-08-14T00:00:00.000Z",
    batch,
  });

  const firstChild = startChild("crash", { walRoot, stateRoot, sinkRoot, batchPath });
  const firstMessage = await waitForMessage(firstChild);
  if (firstMessage.type !== "blocked-before-second-write") {
    throw harnessError(firstMessage.errorCode ?? "WORKER_PROCESS_CRASH_CHILD_NOT_READY");
  }
  const firstExit = once(firstChild, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  if (!firstChild.kill("SIGKILL")) throw harnessError("WORKER_PROCESS_CRASH_KILL_FAILED");
  const [exitCode, signal] = await firstExit;
  if (exitCode !== null || signal !== "SIGKILL") {
    throw harnessError("WORKER_PROCESS_CRASH_EXIT_NOT_ABNORMAL");
  }

  const firstWrite = await readPersistedWrite(path.join(sinkRoot, "a.json"));
  const pendingAttempt = await readPersistedWrite(path.join(sinkRoot, "pending-b.json"));
  const journal = await readJson(
    path.join(stateRoot, "journals", partition, "00000000000000000000.json"),
  );
  const completedWriteIdentities = stringArray(journal, "completedWriteTokens");
  const checkpointBeforeRestart = await readCheckpoint(stateRoot, partition);
  if (
    firstWrite.table !== FIRST_TABLE ||
    pendingAttempt.table !== SECOND_TABLE ||
    completedWriteIdentities.length !== 1 ||
    completedWriteIdentities[0] !== firstWrite.writeIdentity ||
    checkpointBeforeRestart !== -1
  ) {
    throw harnessError("WORKER_PROCESS_CRASH_PRECONDITION_INVALID");
  }

  const recoveryChild = startChild("recover", { walRoot, stateRoot, sinkRoot, batchPath });
  const recoveryExit = once(recoveryChild, "exit") as Promise<
    [number | null, NodeJS.Signals | null]
  >;
  const recoveryMessage = await waitForMessage(recoveryChild);
  if (recoveryMessage.type !== "completed") {
    recoveryChild.kill("SIGKILL");
    throw harnessError(recoveryMessage.errorCode ?? "WORKER_PROCESS_RECOVERY_FAILED");
  }
  const [recoveryExitCode, recoverySignal] = await recoveryExit;
  if (recoveryExitCode !== 0 || recoverySignal !== null) {
    throw harnessError("WORKER_PROCESS_RECOVERY_EXIT_INVALID");
  }

  const recoveredWrite = await readPersistedWrite(path.join(sinkRoot, "b.json"));
  const recoveryCalls = await readPersistedWrites(path.join(sinkRoot, "recovery-calls.json"));
  const checkpointAfterRestart = await readCheckpoint(stateRoot, partition);
  const expectedRecordIds = batch.records.map((record) => record.recordId).sort();
  const stableRecordIdentity =
    canonicalStrings(firstWrite.recordIds) === canonicalStrings(expectedRecordIds) &&
    canonicalStrings(recoveredWrite.recordIds) === canonicalStrings(expectedRecordIds);
  const stablePendingWriteIdentity =
    pendingAttempt.writeIdentity === recoveredWrite.writeIdentity;
  const skippedCompletedProjectionOnRestart =
    recoveryCalls.length === 1 && recoveryCalls[0]?.table === SECOND_TABLE;
  if (
    recoveredWrite.table !== SECOND_TABLE ||
    checkpointAfterRestart !== 0 ||
    !stableRecordIdentity ||
    !stablePendingWriteIdentity ||
    !skippedCompletedProjectionOnRestart
  ) {
    throw harnessError("WORKER_PROCESS_RECOVERY_INVARIANT_FAILED");
  }

  return {
    isolation: "independent-os-process",
    injectedTermination: "SIGKILL",
    exitCode: null,
    signal: "SIGKILL",
    checkpointBeforeRestart: -1,
    completedWritesBeforeCrash: 1,
    pendingTableAtCrash: SECOND_TABLE,
    restartWrites: recoveryCalls.length,
    resumedTables: recoveryCalls.map((write) => write.table),
    checkpointAfterRestart: 0,
    persistedTables: [FIRST_TABLE, SECOND_TABLE],
    stablePendingWriteIdentity,
    stableRecordIdentity,
    skippedCompletedProjectionOnRestart,
  };
}

function startChild(
  mode: "crash" | "recover",
  paths: Readonly<{
    walRoot: string;
    stateRoot: string;
    sinkRoot: string;
    batchPath: string;
  }>,
): ChildProcess {
  return fork(path.resolve("dist/tests/fixtures/worker-crash-child.js"), [], {
    env: {
      SDAR_TEST_WORKER_MODE: mode,
      SDAR_TEST_WAL_ROOT: paths.walRoot,
      SDAR_TEST_STATE_ROOT: paths.stateRoot,
      SDAR_TEST_SINK_ROOT: paths.sinkRoot,
      SDAR_TEST_BATCH_PATH: paths.batchPath,
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
}

async function waitForMessage(child: ChildProcess): Promise<ChildMessage> {
  return new Promise<ChildMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGKILL");
      reject(harnessError("WORKER_PROCESS_CHILD_TIMEOUT"));
    }, 10_000);
    const onMessage = (candidate: unknown): void => {
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "type" in candidate &&
        (candidate.type === "blocked-before-second-write" ||
          candidate.type === "completed" ||
          candidate.type === "failed")
      ) {
        cleanup();
        resolve(candidate as ChildMessage);
      }
    };
    const onExit = (): void => {
      cleanup();
      reject(harnessError("WORKER_PROCESS_CHILD_EARLY_EXIT"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

async function readCheckpoint(stateRoot: string, partition: string): Promise<number> {
  try {
    const value = await readJson(path.join(stateRoot, "checkpoints", `${partition}.json`));
    if (
      typeof value === "object" &&
      value !== null &&
      "lastCompletedOffset" in value &&
      typeof value.lastCompletedOffset === "number"
    ) {
      return value.lastCompletedOffset;
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return -1;
    throw error;
  }
  throw harnessError("WORKER_PROCESS_CHECKPOINT_INVALID");
}

async function readPersistedWrite(filename: string): Promise<PersistedWrite> {
  const value = await readJson(filename);
  if (
    typeof value !== "object" ||
    value === null ||
    !("table" in value) ||
    typeof value.table !== "string" ||
    !("writeIdentity" in value) ||
    typeof value.writeIdentity !== "string" ||
    !("recordIds" in value) ||
    !Array.isArray(value.recordIds) ||
    !value.recordIds.every((candidate) => typeof candidate === "string")
  ) {
    throw harnessError("WORKER_PROCESS_SINK_INVALID");
  }
  return value as PersistedWrite;
}

async function readPersistedWrites(filename: string): Promise<readonly PersistedWrite[]> {
  const value = await readJson(filename);
  if (!Array.isArray(value)) throw harnessError("WORKER_PROCESS_SINK_INVALID");
  return Promise.all(
    value.map(async (_candidate, index) =>
      readPersistedWriteFromValue(value[index], `WORKER_PROCESS_SINK_${String(index)}_INVALID`),
    ),
  );
}

function readPersistedWriteFromValue(value: unknown, code: string): PersistedWrite {
  if (
    typeof value !== "object" ||
    value === null ||
    !("table" in value) ||
    typeof value.table !== "string" ||
    !("writeIdentity" in value) ||
    typeof value.writeIdentity !== "string" ||
    !("recordIds" in value) ||
    !Array.isArray(value.recordIds) ||
    !value.recordIds.every((candidate) => typeof candidate === "string")
  ) {
    throw harnessError(code);
  }
  return value as PersistedWrite;
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, "utf8")) as unknown;
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (typeof value !== "object" || value === null) {
    throw harnessError("WORKER_PROCESS_JOURNAL_INVALID");
  }
  const candidate = (value as Record<string, unknown>)[field];
  if (
    !Array.isArray(candidate) ||
    !candidate.every((item) => typeof item === "string")
  ) {
    throw harnessError("WORKER_PROCESS_JOURNAL_INVALID");
  }
  return candidate as string[];
}

function canonicalStrings(values: readonly string[]): string {
  return JSON.stringify([...values].sort());
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function harnessError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
