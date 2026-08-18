import path from "node:path";

import {
  loadDomainSourceV1Validator,
  loadEvidenceV1Validator,
  type DomainSourceWalPayload,
} from "../../../packages/telemetry-contracts/src/index.js";
import type { EvidenceV1WalPayload } from "../../../packages/telemetry-types/src/index.js";
import { DurableSegmentWal } from "../../../packages/telemetry-wal/src/index.js";
import { loadConfig } from "../../../packages/telemetry-config/src/index.js";
import {
  createIngestionGateway,
  loadDomainSourceBearerCredential,
  loadEvidenceBearerCredential,
} from "./server.js";

const configuration = loadConfig();
const schemaRoot =
  process.env["SDAR_EVIDENCE_SCHEMA_ROOT"] ??
  path.resolve("integrations/skill-driven-agent-runtime/v1.4.1/schemas/evidence/v1");
const validator = await loadEvidenceV1Validator(schemaRoot);
const bearerCredential = await loadEvidenceBearerCredential();
const domainSourceValidator = await loadDomainSourceV1Validator(
  process.env["SDAR_DOMAIN_SOURCE_SCHEMA_ROOT"],
);
const domainSourceBearerCredential = await loadDomainSourceBearerCredential();
const wal = new DurableSegmentWal<EvidenceV1WalPayload>(
  path.join(configuration.walDir, "sdar-evidence-v1"),
  configuration.walHighWaterBytes,
);
const domainSourceWal = new DurableSegmentWal<DomainSourceWalPayload>(
  path.join(configuration.walDir, "sdar-domain-source-v1"),
  configuration.walHighWaterBytes,
);
const server = createIngestionGateway({
  validator,
  wal,
  bearerCredential,
  domainSource: {
    validator: domainSourceValidator,
    wal: domainSourceWal,
    bearerCredential: domainSourceBearerCredential,
  },
  maximumRequestBytes: Number(process.env["EVIDENCE_MAX_REQUEST_BYTES"] ?? 64 * 1024 * 1024),
});

const bindHost = process.env["GATEWAY_BIND_HOST"] ?? "127.0.0.1";
server.listen(configuration.gatewayPort, bindHost, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "ingestion_gateway.ready", host: bindHost, port: configuration.gatewayPort })}\n`,
  );
});
