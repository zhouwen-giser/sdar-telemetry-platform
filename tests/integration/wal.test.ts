import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DurableSegmentWal,
  DurableWal,
  evidenceWalPartition,
  type WalDurabilityEvent,
} from "../../packages/telemetry-wal/src/index.js";

test("fsync append and recover", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wal-"));
  const wal = new DurableWal(directory);
  await wal.append("p", { x: 1 });
  assert.equal((await wal.recover("p")).length, 1);
  await rm(directory, { recursive: true });
});

test("tail truncation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wal-"));
  const wal = new DurableWal(directory);
  await wal.append("p", { x: 1 });
  await appendFile(path.join(directory, "p.wal"), "broken");
  assert.equal((await wal.recover("p")).length, 1);
  await rm(directory, { recursive: true });
});

test("high water retryable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wal-"));
  const wal = new DurableWal(directory, 1);
  await wal.append("p", { x: 1 });
  await assert.rejects(() => wal.append("p", { x: 2 }), /WAL_HIGH_WATER/u);
  await rm(directory, { recursive: true });
});

test("Evidence v1 segment WAL serializes concurrent appends and recovers stable offsets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-wal-"));
  const partition = evidenceWalPartition({
    exportId: "export-1",
    sourceId: "runtime-1",
    nodeId: "node-1",
    revision: 1,
  });
  const wal = new DurableSegmentWal<{ index: number }>(directory);
  await Promise.all(Array.from({ length: 20 }, (_, index) => wal.append(partition, { index })));
  const recovered = await wal.recover(partition);
  assert.deepEqual(
    recovered.map((frame) => frame.ordinal),
    Array.from({ length: 20 }, (_, index) => index),
  );
  assert.equal(new Set(recovered.map((frame) => frame.offset)).size, 20);
  assert.equal((await wal.partitions())[0], partition);
  await rm(directory, { recursive: true });
});

test("Evidence v1 segment WAL is restart durable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-wal-"));
  const partition = evidenceWalPartition({
    exportId: "export-2",
    sourceId: "runtime-2",
    nodeId: "node-2",
    revision: 1,
  });
  await new DurableSegmentWal(directory).append(partition, { batchHash: "sha256:test" });
  const recovered = await new DurableSegmentWal(directory).recover(partition);
  assert.equal(recovered.length, 1);
  assert.deepEqual(recovered[0]?.payload, { batchHash: "sha256:test" });
  await rm(directory, { recursive: true });
});

test("Evidence v1 segment WAL durably creates every parent before the ACK-visible commit", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "evidence-wal-order-"));
  const rootParent = path.join(base, "wal");
  const root = path.join(rootParent, "sdar-evidence-v1");
  const partition = evidenceWalPartition({
    exportId: "export-durable-directory",
    sourceId: "runtime-durable-directory",
    nodeId: "node-durable-directory",
    revision: 1,
  });
  const partitionDirectory = path.join(root, partition);
  const events: WalDurabilityEvent[] = [];
  const wal = new DurableSegmentWal(root, undefined, {
    onDurabilityEvent: (event) => events.push(event),
  });

  await wal.append(partition, { value: "durable" });

  assert.deepEqual(
    events.map((event) => [event.operation, event.path]),
    [
      ["mkdir", rootParent],
      ["fsync-directory", base],
      ["mkdir", root],
      ["fsync-directory", rootParent],
      ["mkdir", partitionDirectory],
      ["fsync-directory", root],
      ["fsync-file", events[6]?.path],
      ["rename", events[7]?.path],
      ["fsync-directory", partitionDirectory],
    ],
  );
  assert.match(events[6]?.path ?? "", /^.*\.[0-9a-f-]+\.tmp$/u);
  assert.equal(events[7]?.destination, path.join(partitionDirectory, "00000000000000000000.frame"));
  assert.equal((await new DurableSegmentWal(root).recover(partition)).length, 1);
  await rm(base, { recursive: true });
});

test("Evidence v1 segment WAL preserves a corrupt committed segment and fails closed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-wal-"));
  const partition = evidenceWalPartition({
    exportId: "export-3",
    sourceId: "runtime-3",
    nodeId: "node-3",
    revision: 1,
  });
  const wal = new DurableSegmentWal(directory);
  await wal.append(partition, { value: "durable" });
  const file = (await readdir(path.join(directory, partition)))[0];
  assert.ok(file);
  const segment = path.join(directory, partition, file);
  await appendFile(segment, "corrupt");
  const bytesBefore = (await stat(segment)).size;
  await assert.rejects(
    () => new DurableSegmentWal(directory).recover(partition),
    (error: unknown) => errorCode(error) === "WAL_SEGMENT_CORRUPT",
  );
  assert.equal((await stat(segment)).size, bytesBefore);
  await rm(directory, { recursive: true });
});

test("Evidence v1 segment WAL does not commit above high water", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-wal-"));
  const partition = evidenceWalPartition({
    exportId: "export-4",
    sourceId: "runtime-4",
    nodeId: "node-4",
    revision: 1,
  });
  const wal = new DurableSegmentWal(directory, 1);
  await assert.rejects(
    () => wal.append(partition, { value: "too-large" }),
    (error: unknown) => errorCode(error) === "WAL_HIGH_WATER",
  );
  assert.deepEqual(await wal.recover(partition), []);
  await rm(directory, { recursive: true });
});

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}
