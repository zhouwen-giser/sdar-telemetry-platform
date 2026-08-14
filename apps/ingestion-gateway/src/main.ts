import path from "node:path";

import { loadEvidenceV1Validator } from "../../../packages/telemetry-contracts/src/index.js";
import type { EvidenceV1WalPayload } from "../../../packages/telemetry-types/src/index.js";
import { DurableSegmentWal } from "../../../packages/telemetry-wal/src/index.js";
import { loadConfig } from "../../../packages/telemetry-config/src/index.js";
import {
  createIngestionGateway,
  loadEvidenceBearerCredential,
} from "./server.js";

const configuration = loadConfig();
const schemaRoot =
  process.env["SDAR_EVIDENCE_SCHEMA_ROOT"] ??
  path.resolve("integrations/skill-driven-agent-runtime/v1.4.1/schemas/evidence/v1");
const validator = await loadEvidenceV1Validator(schemaRoot);
const bearerCredential = await loadEvidenceBearerCredential();
const wal = new DurableSegmentWal<EvidenceV1WalPayload>(
  path.join(configuration.walDir, "sdar-evidence-v1"),
  configuration.walHighWaterBytes,
);
const server = createIngestionGateway({
  validator,
  wal,
  bearerCredential,
  maximumRequestBytes: Number(process.env["EVIDENCE_MAX_REQUEST_BYTES"] ?? 64 * 1024 * 1024),
});

const bindHost = process.env["GATEWAY_BIND_HOST"] ?? "127.0.0.1";
server.listen(configuration.gatewayPort, bindHost, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "ingestion_gateway.ready", host: bindHost, port: configuration.gatewayPort })}\n`,
  );
});
