import {readFile, writeFile} from "node:fs/promises";

import type {DomainSourceRecord, DomainSourceSha256} from "../../packages/telemetry-contracts/src/index.js";
import {ClickHouseClient, configFromEnv} from "../../packages/telemetry-clickhouse/src/index.js";
import {CommanderDomainMapper} from "../../packages/telemetry-projection-registry/src/commander-mappings.js";
import {DomainProjectionRegistry} from "../../packages/telemetry-projection-registry/src/domain.js";
import {NpcDomainMapper} from "../../packages/telemetry-projection-registry/src/npc-mappings.js";
import {ClickHouseDomainTargetWriter} from "../../apps/domain-projection-worker/src/target-writer.js";

type CrashInput = Readonly<{
  source: DomainSourceRecord;
  mappingHash: DomainSourceSha256;
  projectionRunId: string;
  sourceCursor: string;
  projectedAt: string;
  markerPath: string;
}>;

const inputPath = process.argv[2];
if (inputPath === undefined) throw new Error("DOMAIN_PROJECTION_CRASH_INPUT_REQUIRED");
const input = JSON.parse(await readFile(inputPath, "utf8")) as CrashInput;
const descriptor = new DomainProjectionRegistry().resolveSource(input.source.sourceContractId);
if (descriptor === undefined) throw new Error("DOMAIN_PROJECTION_CRASH_DESCRIPTOR_MISSING");
const decision = input.source.sourceContractId.includes("/commander/")
  ? new CommanderDomainMapper().map(input.source)
  : new NpcDomainMapper().map(input.source);
if (decision.kind !== "produce") throw new Error("DOMAIN_PROJECTION_CRASH_MAPPING_NOT_PRODUCED");
const client = new ClickHouseClient(configFromEnv());
const intercepted = {
  query: client.query.bind(client),
  insert: async (table: string, rows: Record<string, unknown>[], options?: {deduplicationToken?: string}) => {
    if (table === "sdar_meta.projection_lineage") {
      await writeFile(input.markerPath, "target-durable-lineage-not-started\n", {mode: 0o600});
      await new Promise<never>(() => undefined);
    }
    await client.insert(table, rows, options);
  },
};
await new ClickHouseDomainTargetWriter(intercepted).close({
  descriptor,
  source: input.source,
  decision,
  mappingHash: input.mappingHash,
  projectionRunId: input.projectionRunId,
  sourceCursor: input.sourceCursor,
  projectedAt: input.projectedAt,
});
