import path from "node:path";

import {
  ClickHouseClient,
  configFromEnv,
} from "../../../packages/telemetry-clickhouse/src/index.js";
import { loadConfig } from "../../../packages/telemetry-config/src/index.js";
import {
  ProjectionRegistry,
  canonicalProjection,
  smppProjection,
  v13Projection,
  v14Projection,
} from "../../../packages/telemetry-projection-registry/src/index.js";
import type { EvidenceV1WalPayload } from "../../../packages/telemetry-types/src/index.js";
import {
  loadDomainSourceV1Validator,
  type DomainSourceWalPayload,
} from "../../../packages/telemetry-contracts/src/index.js";
import { DurableSegmentWal } from "../../../packages/telemetry-wal/src/index.js";
import { TelemetryWorker } from "./worker.js";
import { DomainSourceLandingWorker } from "./domain-source-worker.js";

const config = loadConfig();
const walRoot = path.join(config.walDir, "sdar-evidence-v1");
const wal = new DurableSegmentWal<EvidenceV1WalPayload>(walRoot, config.walHighWaterBytes);
const clickhouse = new ClickHouseClient(configFromEnv());
const registry = new ProjectionRegistry();
for (const projection of [canonicalProjection, v13Projection, v14Projection, smppProjection]) {
  registry.register(projection);
}

const worker = new TelemetryWorker({
  wal,
  clickhouse,
  projector: registry,
  stateRoot: path.join(config.walDir, "sdar-evidence-v1-worker"),
});
const domainSourceWal = new DurableSegmentWal<DomainSourceWalPayload>(
  path.join(config.walDir, "sdar-domain-source-v1"),
  config.walHighWaterBytes,
);
const domainSourceWorker = new DomainSourceLandingWorker({
  wal: domainSourceWal,
  validator: await loadDomainSourceV1Validator(process.env["SDAR_DOMAIN_SOURCE_SCHEMA_ROOT"]),
  clickhouse,
  stateRoot: path.join(config.walDir, "sdar-domain-source-v1-worker"),
});

let stopping = false;
async function run(): Promise<void> {
  while (!stopping) {
    const started = Date.now();
    try {
      await worker.processOnce();
      await domainSourceWorker.processOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : "WORKER_UNKNOWN_ERROR";
      console.error("telemetry-worker", message);
    }
    const remaining = Math.max(0, config.workerIntervalMs - (Date.now() - started));
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

await run();
