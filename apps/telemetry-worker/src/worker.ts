import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import type { ClickHouseInsertOptions } from "../../../packages/telemetry-clickhouse/src/index.js";
import { deterministicInsertDeduplicationToken } from "../../../packages/telemetry-clickhouse/src/index.js";
import { normalizeBatch } from "../../../packages/telemetry-normalizers/src/index.js";
import type { ProjectionRow } from "../../../packages/telemetry-projection-registry/src/index.js";
import type {
  CanonicalFact,
  EvidenceV1WalPayload,
} from "../../../packages/telemetry-types/src/index.js";
import {
  DurableSegmentWal,
  type WalFrame,
} from "../../../packages/telemetry-wal/src/index.js";

export interface EvidenceProjector {
  project(fact: CanonicalFact): ProjectionRow[];
}

export interface EvidenceClickHouseWriter {
  insert(
    table: string,
    rows: Record<string, unknown>[],
    options?: ClickHouseInsertOptions,
  ): Promise<void>;
}

export interface TelemetryWorkerDependencies {
  readonly wal: DurableSegmentWal<EvidenceV1WalPayload>;
  readonly projector: EvidenceProjector;
  readonly clickhouse: EvidenceClickHouseWriter;
  readonly stateRoot: string;
  readonly clock?: Readonly<{ now(): string }>;
}

export interface WorkerCycleResult {
  readonly partitionsVisited: number;
  readonly framesCompleted: number;
  readonly writesCompleted: number;
}

interface WorkerCheckpoint {
  readonly schemaVersion: 1;
  readonly partition: string;
  readonly lastCompletedOffset: number;
  readonly walPayloadHash: string;
  readonly updatedAt: string;
}

interface FrameJournal {
  readonly schemaVersion: 1;
  readonly partition: string;
  readonly offset: number;
  readonly walPayloadHash: string;
  readonly completedWriteTokens: readonly string[];
  readonly updatedAt: string;
}

interface ProjectionWrite {
  readonly table: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly token: string;
}

/**
 * Replays immutable Evidence v1 WAL segments into ClickHouse.
 *
 * Each table write uses a deterministic ClickHouse deduplication token. A durable per-frame
 * journal is fsynced after every successful table write, while the partition checkpoint advances
 * only after all writes for that frame complete. Consequently a crash either resumes at the first
 * unfinished write, or safely retries the same token if it happened after ClickHouse committed but
 * before the journal rename became durable.
 */
export class TelemetryWorker {
  private activeCycle: Promise<WorkerCycleResult> | undefined;
  private readonly clock: Readonly<{ now(): string }>;

  constructor(private readonly dependencies: TelemetryWorkerDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date().toISOString() };
  }

  processOnce(): Promise<WorkerCycleResult> {
    if (this.activeCycle !== undefined) return this.activeCycle;
    const operation = this.processAllPartitions();
    this.activeCycle = operation;
    const clear = (): void => {
      if (this.activeCycle === operation) this.activeCycle = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }

  async checkpoint(partition: string): Promise<number> {
    return (await this.readCheckpoint(partition))?.lastCompletedOffset ?? -1;
  }

  private async processAllPartitions(): Promise<WorkerCycleResult> {
    const partitions = await this.dependencies.wal.partitions();
    let framesCompleted = 0;
    let writesCompleted = 0;
    for (const partition of partitions) {
      const result = await this.processPartition(partition);
      framesCompleted += result.framesCompleted;
      writesCompleted += result.writesCompleted;
    }
    return Object.freeze({
      partitionsVisited: partitions.length,
      framesCompleted,
      writesCompleted,
    });
  }

  private async processPartition(
    partition: string,
  ): Promise<Pick<WorkerCycleResult, "framesCompleted" | "writesCompleted">> {
    const frames = await this.dependencies.wal.recover(partition);
    const checkpoint = await this.readCheckpoint(partition);
    if (
      checkpoint !== undefined &&
      (checkpoint.lastCompletedOffset >= frames.length ||
        frames[checkpoint.lastCompletedOffset]?.payloadHash !== checkpoint.walPayloadHash)
    ) {
      throw workerError("WORKER_CHECKPOINT_CONFLICT");
    }

    let framesCompleted = 0;
    let writesCompleted = 0;
    for (const frame of frames) {
      if (frame.offset <= (checkpoint?.lastCompletedOffset ?? -1)) continue;
      const result = await this.processFrame(frame);
      writesCompleted += result;
      await this.writeCheckpoint(frame);
      framesCompleted += 1;
    }
    return { framesCompleted, writesCompleted };
  }

  private async processFrame(frame: WalFrame<EvidenceV1WalPayload>): Promise<number> {
    const facts = normalizeBatch(frame.payload, {
      walPartition: frame.partition,
      walOffset: frame.offset,
      walWrittenAt: frame.writtenAt,
      walPayloadHash: frame.payloadHash,
    });
    const writes = projectionWrites(facts.flatMap((fact) => this.dependencies.projector.project(fact)));
    if (writes.length === 0) throw workerError("WORKER_CANONICAL_PROJECTION_MISSING");

    const journal = await this.readJournal(frame);
    const completed = new Set(journal?.completedWriteTokens ?? []);
    const validTokens = new Set(writes.map((write) => write.token));
    if ([...completed].some((token) => !validTokens.has(token))) {
      throw workerError("WORKER_PROJECTION_JOURNAL_CONFLICT");
    }

    let writesCompleted = 0;
    for (const write of writes) {
      if (completed.has(write.token)) continue;
      await this.dependencies.clickhouse.insert(write.table, [...write.rows], {
        deduplicationToken: write.token,
      });
      completed.add(write.token);
      await this.writeJournal(frame, [...completed]);
      writesCompleted += 1;
    }
    return writesCompleted;
  }

  private async readCheckpoint(partition: string): Promise<WorkerCheckpoint | undefined> {
    const value = await readJsonIfPresent(this.checkpointPath(partition));
    if (value === undefined) return undefined;
    if (
      !isRecord(value) ||
      value["schemaVersion"] !== 1 ||
      value["partition"] !== partition ||
      !Number.isSafeInteger(value["lastCompletedOffset"]) ||
      (value["lastCompletedOffset"] as number) < 0 ||
      typeof value["walPayloadHash"] !== "string" ||
      typeof value["updatedAt"] !== "string"
    ) {
      throw workerError("WORKER_CHECKPOINT_CORRUPT");
    }
    return value as unknown as WorkerCheckpoint;
  }

  private async readJournal(
    frame: WalFrame<EvidenceV1WalPayload>,
  ): Promise<FrameJournal | undefined> {
    const value = await readJsonIfPresent(this.journalPath(frame));
    if (value === undefined) return undefined;
    if (
      !isRecord(value) ||
      value["schemaVersion"] !== 1 ||
      value["partition"] !== frame.partition ||
      value["offset"] !== frame.offset ||
      value["walPayloadHash"] !== frame.payloadHash ||
      typeof value["updatedAt"] !== "string" ||
      !Array.isArray(value["completedWriteTokens"]) ||
      !(value["completedWriteTokens"] as unknown[]).every(
        (candidate) => typeof candidate === "string" && /^[a-f0-9]{64}$/u.test(candidate),
      )
    ) {
      throw workerError("WORKER_PROJECTION_JOURNAL_CORRUPT");
    }
    return value as unknown as FrameJournal;
  }

  private async writeCheckpoint(frame: WalFrame<EvidenceV1WalPayload>): Promise<void> {
    await writeDurableJson(this.checkpointPath(frame.partition), {
      schemaVersion: 1,
      partition: frame.partition,
      lastCompletedOffset: frame.offset,
      walPayloadHash: frame.payloadHash,
      updatedAt: this.clock.now(),
    } satisfies WorkerCheckpoint);
  }

  private async writeJournal(
    frame: WalFrame<EvidenceV1WalPayload>,
    completedWriteTokens: readonly string[],
  ): Promise<void> {
    await writeDurableJson(this.journalPath(frame), {
      schemaVersion: 1,
      partition: frame.partition,
      offset: frame.offset,
      walPayloadHash: frame.payloadHash,
      completedWriteTokens,
      updatedAt: this.clock.now(),
    } satisfies FrameJournal);
  }

  private checkpointPath(partition: string): string {
    return path.join(this.dependencies.stateRoot, "checkpoints", `${partition}.json`);
  }

  private journalPath(frame: Pick<WalFrame, "partition" | "offset">): string {
    return path.join(
      this.dependencies.stateRoot,
      "journals",
      frame.partition,
      `${String(frame.offset).padStart(20, "0")}.json`,
    );
  }
}

function projectionWrites(rows: readonly ProjectionRow[]): readonly ProjectionWrite[] {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const candidate of rows) {
    const group = grouped.get(candidate.table) ?? [];
    group.push(candidate.row);
    grouped.set(candidate.table, group);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, tableRows]) => ({
      table,
      rows: tableRows,
      token: deterministicInsertDeduplicationToken(table, tableRows),
    }));
}

async function readJsonIfPresent(filename: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filename, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    if (error instanceof SyntaxError) throw workerError("WORKER_STATE_CORRUPT");
    throw error;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

function workerError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
