import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { hashCanonicalDomainProjectionJson } from "../packages/telemetry-contracts/src/index.js";
import {
  DOMAIN_PROJECTION_DESCRIPTORS,
  type DomainProjectionMappingId,
} from "../packages/telemetry-projection-registry/src/domain.js";
import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";
import { ClickHouseDomainSchemaPreflight } from "../apps/domain-projection-worker/src/schema-preflight.js";
import {
  failure,
  stableCode,
} from "../packages/telemetry-control-postgres/src/domain-runtime.js";

type SourceConfig = {
  tenantId: string;
  projectId: string;
  producers: Record<string, unknown>[];
};
type Projection = {
  projectionId: string;
  lifecycle: string;
  revision: number;
  definitionHash: string;
  mappingHash: string;
  lastErrorCode: string | null;
};
type Snapshot = {
  scope: { tenantId: string; projectId: string };
  sources: { application: string }[];
  projections: Projection[];
  actions: { actionId: string; status: string }[];
};
export async function bootstrapDebugProjection(
  config: SourceConfig,
  expectedMapping: (id: DomainProjectionMappingId) => string,
  request: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<"ACTIVE" | "waiting_configuration"> {
  if (
    !config ||
    !Array.isArray(config.producers) ||
    !config.tenantId ||
    !config.projectId
  )
    throw failure("DOMAIN_DEBUG_CONFIGURATION_INVALID");
  const call = async (url: string, body?: unknown): Promise<unknown> => {
    const response = await request(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const result: unknown = await response.json();
    if (!response.ok) throw failure("DOMAIN_DEBUG_MANAGEMENT_REQUEST_FAILED");
    return result;
  };
  for (const producer of config.producers) {
    if (
      producer["tenantId"] !== config.tenantId ||
      producer["projectId"] !== config.projectId ||
      producer["contractVersion"] !== "sdar.domain-source/v1" ||
      !["commander", "npc"].includes(String(producer["application"]))
    )
      throw failure("DOMAIN_DEBUG_SOURCE_SCOPE_CONFLICT");
    await call(
      "http://admin-api:8082/v1/admin/domain-source-producers",
      producer,
    );
  }
  const snapshot = async (): Promise<Snapshot> => {
    const value = (await call(
      "http://domain-projection-worker:8083/status",
    )) as Snapshot;
    if (
      value.scope?.tenantId !== config.tenantId ||
      value.scope?.projectId !== config.projectId ||
      !Array.isArray(value.projections) ||
      value.projections.length !== 10 ||
      !Array.isArray(value.sources)
    )
      throw failure("DOMAIN_DEBUG_SCOPE_CONFLICT");
    for (const descriptor of DOMAIN_PROJECTION_DESCRIPTORS) {
      const row = value.projections.find(
        (row) => row.projectionId === descriptor.definition.projectionId,
      );
      if (
        !row ||
        row.definitionHash !== descriptor.definitionHash ||
        row.mappingHash !== expectedMapping(descriptor.mappingId)
      )
        throw failure("PROJECTION_ACTIVATION_HASH_MISMATCH");
    }
    return value;
  };
  for (let round = 0; round < 6; round++) {
    const before = await snapshot();
    if (["commander","npc"].some(application=>before.sources.filter(source=>source.application===application).length===0)) return "waiting_configuration";
    if (["commander","npc"].some(application=>before.sources.filter(source=>source.application===application).length!==1)) throw failure("DOMAIN_SOURCE_PRODUCER_CONFLICT");
    if (
      before.projections.every(
        (row) => row.lifecycle === "ACTIVE" && !row.lastErrorCode,
      )
    )
      return "ACTIVE";
    const sent: Projection[] = [];
    const actions: string[] = [];
    for (const row of before.projections) {
      if (row.lifecycle === "ACTIVE") {
        if (row.lastErrorCode) throw failure(row.lastErrorCode);
        continue;
      }
      const modes: Record<string, string> = {
        APPROVED_DISABLED: "shadow",
        SHADOW_READ_ONLY: "dry_run",
        DRY_RUN: "active",
      };
      if (
        row.lifecycle !== "MAPPING_CONTRACT_BLOCKED" &&
        modes[row.lifecycle] === undefined
      )
        throw failure("PROJECTION_DEBUG_STATE_BLOCKED");
      const body = {
        actionId: randomUUID(),
        projectionVersion: 1,
        expectedRevision: row.revision,
        expectedDefinitionHash: row.definitionHash,
        expectedMappingHash: row.mappingHash,
        requestedBy: "ugv-debug-development",
        actionType:
          row.lifecycle === "MAPPING_CONTRACT_BLOCKED"
            ? "approve_definition"
            : "set_mode",
        payload: {
          tenantId: config.tenantId,
          projectId: config.projectId,
          ...(modes[row.lifecycle] ? { mode: modes[row.lifecycle] } : {}),
        },
      };
      await call(
        `http://admin-api:8082/v1/admin/domain-projections/${encodeURIComponent(row.projectionId)}/actions`,
        { ...body, requestHash: hashCanonicalDomainProjectionJson(body) },
      );
      sent.push(row);
      actions.push(body.actionId);
    }
    let advanced = false;
    for (let poll = 0; poll < 60; poll++) {
      await pause(500);
      const after = await snapshot();
      if (
        sent.every((row) =>
          after.projections.some(
            (next) =>
              next.projectionId === row.projectionId &&
              next.revision === row.revision + 1,
          ),
        )
      ) {
        advanced = true;
        break;
      }
      if (
        after.actions?.some(
          (action) =>
            actions.includes(action.actionId) && action.status === "rejected",
        )
      ) {
        const failed = after.projections.find((row) => row.lastErrorCode);
        throw failure(failed?.lastErrorCode ?? "PROJECTION_ACTION_REJECTED");
      }
    }
    if (!advanced) throw failure("DOMAIN_DEBUG_ACTIVATION_TIMEOUT");
  }
  throw failure("DOMAIN_DEBUG_ACTIVATION_INCOMPLETE");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const file = process.env["DOMAIN_PRODUCERS_FILE"];
    if (!file) throw failure("DOMAIN_DEBUG_CONFIGURATION_REQUIRED");
    const config = JSON.parse(await readFile(file, "utf8")) as SourceConfig;
    const preflight = await ClickHouseDomainSchemaPreflight.load(
      new ClickHouseClient(configFromEnv()),
    );
    const status = await bootstrapDebugProjection(config, (id) =>
      preflight.expectedMappingHash(id),
    );
    process.stdout.write(
      JSON.stringify({ status, historyBackfill: false }) + "\n",
    );
  } catch (error) {
    process.stderr.write(stableCode(error) + "\n");
    process.exitCode = 1;
  }
}
