import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runWorkerProcessCrashRecovery } from "../../scripts/worker-process-crash-harness.js";
import type { EvidenceV1BatchRequest } from "../../packages/telemetry-types/src/index.js";

const fixturePath = path.join(
  process.cwd(),
  "integrations/skill-driven-agent-runtime/v1.4.1/reports/v1.4.1-evidence/clickhouse-handoff/sample-batches/valid-batch.json",
);

test("SIGKILL mid-frame resumes only the unjournaled projection with stable identity", async () => {
  const productionWorkerSource = await readFile(
    path.join(process.cwd(), "apps/telemetry-worker/src/worker.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    productionWorkerSource,
    /SDAR_TEST_|SIGKILL|process\.exit/u,
    "the crash trigger must remain outside production Worker code",
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "sdar-worker-process-crash-"));
  try {
    const batch = JSON.parse(await readFile(fixturePath, "utf8")) as EvidenceV1BatchRequest;
    const evidence = await runWorkerProcessCrashRecovery(batch, root);

    assert.deepEqual(evidence, {
      isolation: "independent-os-process",
      injectedTermination: "SIGKILL",
      exitCode: null,
      signal: "SIGKILL",
      checkpointBeforeRestart: -1,
      completedWritesBeforeCrash: 1,
      pendingTableAtCrash: "sdar_core.b_projection",
      restartWrites: 1,
      resumedTables: ["sdar_core.b_projection"],
      checkpointAfterRestart: 0,
      persistedTables: ["sdar_core.a_projection", "sdar_core.b_projection"],
      stablePendingWriteIdentity: true,
      stableRecordIdentity: true,
      skippedCompletedProjectionOnRestart: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
