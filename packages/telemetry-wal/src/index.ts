import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  truncate,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../telemetry-validation/src/index.js";

export interface WalFrame<T = unknown> {
  offset: number;
  endOffset?: number;
  ordinal?: number;
  partition: string;
  payload: T;
  payloadHash: string;
  writtenAt: string;
}

export interface WalDurabilityEvent {
  readonly operation: "mkdir" | "fsync-file" | "rename" | "fsync-directory";
  readonly path: string;
  readonly destination?: string;
}

export interface DurableSegmentWalOptions {
  /** Test/diagnostic hook emitted only after the corresponding filesystem operation succeeds. */
  readonly onDurabilityEvent?: (event: WalDurabilityEvent) => void;
}

/**
 * Compatibility WAL for the legacy v1.3 receiver.
 *
 * New sdar.evidence/v1 traffic uses DurableSegmentWal below. This class remains intentionally
 * available so the legacy relay is not silently reclassified as the v1.4 path.
 */
export class DurableWal {
  constructor(
    private readonly root: string,
    private readonly highWaterBytes = 512 * 1024 * 1024,
  ) {}

  private file(partition: string): string {
    return path.join(this.root, `${partition}.wal`);
  }

  async size(): Promise<number> {
    await mkdir(this.root, { recursive: true });
    let total = 0;
    for (const file of await readdir(this.root)) {
      if (file.endsWith(".wal")) total += (await stat(path.join(this.root, file))).size;
    }
    return total;
  }

  async append(partition: string, payload: unknown): Promise<WalFrame> {
    await mkdir(this.root, { recursive: true });
    if ((await this.size()) >= this.highWaterBytes) throw walError("WAL_HIGH_WATER");
    const file = this.file(partition);
    let offset = 0;
    try {
      offset = (await stat(file)).size;
    } catch {
      // The first frame starts at byte zero.
    }
    const frame: WalFrame = {
      offset,
      partition,
      payload,
      payloadHash: sha256(payload),
      writtenAt: new Date().toISOString(),
    };
    const body = Buffer.from(JSON.stringify(frame));
    const header = Buffer.from(`${String(body.length)}:${sha256Bytes(body).slice(0, 8)}:`);
    const handle = await open(file, "a");
    try {
      await writeAll(handle, Buffer.concat([header, body, Buffer.from("\n")]));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return frame;
  }

  async recover(partition: string): Promise<WalFrame[]> {
    await mkdir(this.root, { recursive: true });
    const file = this.file(partition);
    let buffer: Buffer;
    try {
      buffer = await readFile(file);
    } catch {
      return [];
    }
    const frames: WalFrame[] = [];
    let cursor = 0;
    let lastValidOffset = 0;
    while (cursor < buffer.length) {
      const firstColon = buffer.indexOf(58, cursor);
      const secondColon = firstColon < 0 ? -1 : buffer.indexOf(58, firstColon + 1);
      if (firstColon < 0 || secondColon < 0) break;
      const length = Number(buffer.subarray(cursor, firstColon).toString());
      const checksum = buffer.subarray(firstColon + 1, secondColon).toString();
      const end = secondColon + 1 + length;
      if (!Number.isSafeInteger(length) || length < 1 || end >= buffer.length || buffer[end] !== 10)
        break;
      const body = buffer.subarray(secondColon + 1, end);
      if (sha256Bytes(body).slice(0, 8) !== checksum) break;
      frames.push(JSON.parse(body.toString("utf8")) as WalFrame);
      lastValidOffset = end + 1;
      cursor = lastValidOffset;
    }
    if (lastValidOffset < buffer.length) await truncate(file, lastValidOffset);
    return frames;
  }
}

interface SegmentEnvelope<T> {
  schemaVersion: 1;
  checksum: string;
  frame: WalFrame<T> & Required<Pick<WalFrame<T>, "endOffset" | "ordinal">>;
}

/**
 * Crash-safe segment WAL used by the formal sdar.evidence/v1 receiver.
 *
 * Every accepted batch is written to a new immutable segment, fsynced, atomically renamed, and
 * followed by a directory fsync before the caller may send an ACK. Recovery never truncates a
 * committed segment: corruption is a fail-closed error that preserves the bytes for diagnosis.
 */
export class DurableSegmentWal<T = unknown> {
  private readonly partitionLocks = new Map<string, Promise<void>>();
  private readonly root: string;
  private readonly onDurabilityEvent?: (event: WalDurabilityEvent) => void;

  constructor(
    root: string,
    private readonly highWaterBytes = 512 * 1024 * 1024,
    options: DurableSegmentWalOptions = {},
  ) {
    this.root = path.resolve(root);
    this.onDurabilityEvent = options.onDurabilityEvent;
  }

  async size(): Promise<number> {
    await ensureDirectoryDurable(this.root, (event) => this.notify(event));
    return directorySize(this.root);
  }

  async partitions(): Promise<readonly string[]> {
    await ensureDirectoryDurable(this.root, (event) => this.notify(event));
    const entries = await readdir(this.root, { withFileTypes: true });
    return entries
      .filter((entry: Dirent) => entry.isDirectory() && evidencePartitionPattern.test(entry.name))
      .map((entry: Dirent) => entry.name)
      .sort();
  }

  async append(partition: string, payload: T): Promise<WalFrame<T>> {
    assertEvidencePartition(partition);
    return this.withPartitionLock(partition, async () => {
      const partitionDirectory = path.join(this.root, partition);
      await ensureDirectoryDurable(partitionDirectory, (event) => this.notify(event));
      const existing = await segmentFiles(partitionDirectory);
      const ordinal = existing.length;
      if (existing.some((file, index) => file !== segmentFileName(index))) {
        throw walError("WAL_SEGMENT_GAP");
      }
      const frame: SegmentEnvelope<T>["frame"] = {
        offset: ordinal,
        endOffset: ordinal,
        ordinal,
        partition,
        payload,
        payloadHash: sha256(payload),
        writtenAt: new Date().toISOString(),
      };
      const envelope: SegmentEnvelope<T> = {
        schemaVersion: 1,
        checksum: frameChecksum(frame),
        frame,
      };
      const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
      if ((await this.size()) + bytes.length > this.highWaterBytes) {
        throw walError("WAL_HIGH_WATER");
      }
      const finalPath = path.join(partitionDirectory, segmentFileName(ordinal));
      const temporaryPath = path.join(partitionDirectory, `.${randomUUID()}.tmp`);
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await writeAll(handle, bytes);
        await handle.sync();
        this.notify({ operation: "fsync-file", path: temporaryPath });
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      await handle.close();
      await rename(temporaryPath, finalPath);
      this.notify({ operation: "rename", path: temporaryPath, destination: finalPath });
      await syncDirectory(partitionDirectory);
      this.notify({ operation: "fsync-directory", path: partitionDirectory });
      return frame;
    });
  }

  async recover(partition: string): Promise<readonly WalFrame<T>[]> {
    assertEvidencePartition(partition);
    const partitionDirectory = path.join(this.root, partition);
    let files: readonly string[];
    try {
      files = await segmentFiles(partitionDirectory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const frames: WalFrame<T>[] = [];
    for (const [ordinal, file] of files.entries()) {
      if (file !== segmentFileName(ordinal)) throw walError("WAL_SEGMENT_GAP");
      const bytes = await readFile(path.join(partitionDirectory, file));
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw walError("WAL_SEGMENT_CORRUPT");
      }
      const envelope = assertSegmentEnvelope<T>(value, partition, ordinal);
      frames.push(envelope.frame);
    }
    return frames;
  }

  private async withPartitionLock<R>(partition: string, operation: () => Promise<R>): Promise<R> {
    const previous = this.partitionLocks.get(partition) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.partitionLocks.set(partition, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.partitionLocks.get(partition) === queued) this.partitionLocks.delete(partition);
    }
  }

  private notify(event: WalDurabilityEvent): void {
    try {
      this.onDurabilityEvent?.(event);
    } catch {
      // Diagnostics must never weaken or change WAL durability semantics.
    }
  }
}

const evidencePartitionPattern = /^[a-f0-9]{64}$/u;

export function evidenceWalPartition(identity: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(stableJson(identity), "utf8").digest("hex");
}

function assertEvidencePartition(partition: string): void {
  if (!evidencePartitionPattern.test(partition)) throw walError("WAL_PARTITION_INVALID");
}

function segmentFileName(ordinal: number): string {
  return `${String(ordinal).padStart(20, "0")}.frame`;
}

async function segmentFiles(directory: string): Promise<readonly string[]> {
  return (await readdir(directory))
    .filter((file: string) => /^\d{20}\.frame$/u.test(file))
    .sort();
}

function frameChecksum<T>(frame: SegmentEnvelope<T>["frame"]): string {
  return sha256Bytes(Buffer.from(JSON.stringify(frame), "utf8"));
}

function assertSegmentEnvelope<T>(
  value: unknown,
  partition: string,
  ordinal: number,
): SegmentEnvelope<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw walError("WAL_SEGMENT_CORRUPT");
  }
  const candidate = value as Partial<SegmentEnvelope<T>>;
  const frame = candidate.frame;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.checksum !== "string" ||
    typeof frame !== "object" ||
    frame === null ||
    frame.partition !== partition ||
    frame.ordinal !== ordinal ||
    frame.offset !== ordinal ||
    frame.endOffset !== ordinal ||
    typeof frame.payloadHash !== "string" ||
    typeof frame.writtenAt !== "string" ||
    candidate.checksum !== frameChecksum(frame)
  ) {
    throw walError("WAL_SEGMENT_CORRUPT");
  }
  return candidate as SegmentEnvelope<T>;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await handle.write(bytes, written, bytes.byteLength - written, null);
    if (result.bytesWritten < 1) throw walError("WAL_WRITE_INCOMPLETE");
    written += result.bytesWritten;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDirectoryDurable(
  directory: string,
  observe: (event: WalDurabilityEvent) => void,
): Promise<void> {
  const missing: string[] = [];
  let current = path.resolve(directory);
  for (;;) {
    try {
      const metadata = await stat(current);
      if (!metadata.isDirectory()) throw walError("WAL_DIRECTORY_INVALID");
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
      missing.push(current);
      const parent = path.dirname(current);
      if (parent === current) throw walError("WAL_DIRECTORY_INVALID");
      current = parent;
    }
  }

  for (const candidate of missing.reverse()) {
    try {
      await mkdir(candidate, { mode: 0o700 });
      observe({ operation: "mkdir", path: candidate });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const metadata = await stat(candidate);
      if (!metadata.isDirectory()) throw walError("WAL_DIRECTORY_INVALID");
    }
    const parent = path.dirname(candidate);
    await syncDirectory(parent);
    observe({ operation: "fsync-directory", path: parent });
  }
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else total += (await stat(entryPath)).size;
  }
  return total;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value !== "object") throw walError("WAL_PARTITION_INVALID");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function walError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}
