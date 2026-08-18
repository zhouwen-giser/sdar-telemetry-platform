import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { TelemetryWorker, type EvidenceProjector } from "../../apps/telemetry-worker/src/worker.js";
import type { ClickHouseInsertOptions } from "../../packages/telemetry-clickhouse/src/index.js";
import type { EvidenceV1BatchRequest, EvidenceV1WalPayload } from "../../packages/telemetry-types/src/index.js";
import { DurableSegmentWal } from "../../packages/telemetry-wal/src/index.js";

const mode = requiredEnvironment("SDAR_TEST_WORKER_MODE");
const walRoot = requiredEnvironment("SDAR_TEST_WAL_ROOT");
const stateRoot = requiredEnvironment("SDAR_TEST_STATE_ROOT");
const sinkRoot = requiredEnvironment("SDAR_TEST_SINK_ROOT");
const batchPath = requiredEnvironment("SDAR_TEST_BATCH_PATH");

const projector: EvidenceProjector = {
  project(fact) {
    const row = { record_id: fact.recordId, payload_hash: fact.payloadHash };
    return [
      { table: "sdar_core.a_projection", row },
      { table: "sdar_core.b_projection", row },
    ];
  },
};

try {
  const batch = JSON.parse(await readFile(batchPath, "utf8")) as EvidenceV1BatchRequest;
  const recoveryCalls: PersistedWrite[] = [];
  const worker = new TelemetryWorker({
    wal: new DurableSegmentWal<EvidenceV1WalPayload>(walRoot),
    projector,
    stateRoot,
    clickhouse: {
      async insert(table, rows, options): Promise<void> {
        const write = persistedWrite(table, rows, options);
        if (mode === "crash" && table === "sdar_core.b_projection") {
          await writeDurableJson(path.join(sinkRoot, "pending-b.json"), write);
          process.send?.({ type: "blocked-before-second-write" });
          await new Promise<never>(() => {
            setInterval(() => undefined, 60_000);
          });
        }
        if (mode === "recover") recoveryCalls.push(write);
        await writeDurableJson(
          path.join(sinkRoot, table === "sdar_core.a_projection" ? "a.json" : "b.json"),
          write,
        );
      },
    },
    clock: { now: () => "2026-08-14T00:00:01.000Z" },
  });
  const result = await worker.processOnce();
  if (mode !== "recover") throw childError("WORKER_CRASH_CHILD_DID_NOT_BLOCK");
  await writeDurableJson(path.join(sinkRoot, "recovery-calls.json"), recoveryCalls);
  process.send?.({ type: "completed", result, recordCount: batch.records.length });
} catch (error) {
  process.send?.({ type: "failed", errorCode: safeErrorCode(error) });
  process.exitCode = 1;
}

interface PersistedWrite {
  readonly table: string;
  readonly writeIdentity: string;
  readonly recordIds: readonly string[];
}

function persistedWrite(
  table: string,
  rows: readonly Record<string, unknown>[],
  options?: ClickHouseInsertOptions,
): PersistedWrite {
  const writeIdentity = options?.deduplicationToken;
  const recordIds = rows.map((row) => row["record_id"]);
  if (
    typeof writeIdentity !== "string" ||
    !/^[a-f0-9]{64}$/u.test(writeIdentity) ||
    !recordIds.every((candidate) => typeof candidate === "string")
  ) {
    throw childError("WORKER_CRASH_CHILD_WRITE_INVALID");
  }
  return { table, writeIdentity, recordIds: recordIds as string[] };
}

async function writeDurableJson(filename: string, value: unknown): Promise<void> {
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filename)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporary, filename);
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw childError("WORKER_CRASH_CHILD_CONFIG_INVALID");
  return value;
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "WORKER_CRASH_CHILD_FAILED";
}

function childError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
