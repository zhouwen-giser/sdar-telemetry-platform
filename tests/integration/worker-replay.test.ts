import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TelemetryWorker } from "../../apps/telemetry-worker/src/worker.js";
import type { ClickHouseInsertOptions } from "../../packages/telemetry-clickhouse/src/index.js";
import type { EvidenceProjector } from "../../apps/telemetry-worker/src/worker.js";
import type {
  EvidenceV1BatchRequest,
  EvidenceV1WalPayload,
} from "../../packages/telemetry-types/src/index.js";
import {
  DurableSegmentWal,
  evidenceWalPartition,
} from "../../packages/telemetry-wal/src/index.js";

const fixturePath = path.join(
  process.cwd(),
  "integrations/skill-driven-agent-runtime/v1.4.1/reports/v1.4.1-evidence/clickhouse-handoff/sample-batches/valid-batch.json",
);

test("worker resumes a partially projected frame without advancing its checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdar-worker-replay-"));
  const wal = new DurableSegmentWal<EvidenceV1WalPayload>(path.join(root, "wal"));
  const batch = JSON.parse(await readFile(fixturePath, "utf8")) as EvidenceV1BatchRequest;
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

  const projector: EvidenceProjector = {
    project(fact) {
      const row = { record_id: fact.recordId, payload_hash: fact.payloadHash };
      return [
        { table: "sdar_core.a_projection", row },
        { table: "sdar_core.b_projection", row },
      ];
    },
  };

  const firstCalls: Array<{
    table: string;
    rows: Record<string, unknown>[];
    token: string | undefined;
  }> = [];
  const firstWriter = {
    async insert(
      table: string,
      rows: Record<string, unknown>[],
      options?: ClickHouseInsertOptions,
    ): Promise<void> {
      firstCalls.push({ table, rows, token: options?.deduplicationToken });
      if (table === "sdar_core.b_projection") throw new Error("controlled outage");
    },
  };
  const stateRoot = path.join(root, "state");
  const firstWorker = new TelemetryWorker({
    wal,
    projector,
    clickhouse: firstWriter,
    stateRoot,
    clock: { now: () => "2026-08-14T00:00:01.000Z" },
  });
  await assert.rejects(firstWorker.processOnce(), /controlled outage/u);
  assert.equal(await firstWorker.checkpoint(partition), -1);
  assert.deepEqual(
    firstCalls.map((call) => call.table),
    ["sdar_core.a_projection", "sdar_core.b_projection"],
  );

  const resumedCalls: typeof firstCalls = [];
  const resumedWorker = new TelemetryWorker({
    wal,
    projector,
    clickhouse: {
      async insert(table, rows, options): Promise<void> {
        resumedCalls.push({ table, rows, token: options?.deduplicationToken });
      },
    },
    stateRoot,
    clock: { now: () => "2026-08-14T00:00:02.000Z" },
  });
  const result = await resumedWorker.processOnce();
  assert.deepEqual(result, { partitionsVisited: 1, framesCompleted: 1, writesCompleted: 1 });
  assert.equal(await resumedWorker.checkpoint(partition), 0);
  assert.equal(resumedCalls.length, 1);
  assert.equal(resumedCalls[0]?.table, "sdar_core.b_projection");
  assert.equal(resumedCalls[0]?.token, firstCalls[1]?.token);
  assert.equal(
    resumedCalls[0]?.rows[0]?.["record_id"],
    batch.records[0]?.recordId,
    "stable Runtime evidence identity survives replay",
  );

  assert.deepEqual(await resumedWorker.processOnce(), {
    partitionsVisited: 1,
    framesCompleted: 0,
    writesCompleted: 0,
  });
});
