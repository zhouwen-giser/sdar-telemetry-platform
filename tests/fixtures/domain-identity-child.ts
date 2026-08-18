import { createCanonicalDomainIdentity } from "../../packages/telemetry-projection-registry/src/domain.js";

const serialized = process.env.SDAR_TEST_DOMAIN_ID_INPUT;
if (serialized === undefined) throw new Error("SDAR_TEST_DOMAIN_ID_INPUT is required");
const input = JSON.parse(serialized) as {
  tenantId: string;
  projectId: string;
  sourceAgentType: "commander" | "npc" | "sdar";
  sourceEntityType: string;
  sourceId: string;
};
process.send?.(createCanonicalDomainIdentity(input));
