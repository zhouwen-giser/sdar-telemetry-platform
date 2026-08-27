import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { DomainRuntimeRepository } from "../../packages/telemetry-control-postgres/src/domain-runtime.js";
import { DomainProjectionControlRepository } from "../../packages/telemetry-control-postgres/src/index.js";
import { ControlPostgres } from "../../packages/telemetry-control-postgres/src/index.js";
import { DomainRuntime } from "../../apps/domain-projection-worker/src/runtime.js";
import { ClickHouseDomainSchemaPreflight } from "../../apps/domain-projection-worker/src/schema-preflight.js";
import { DOMAIN_PROJECTION_DESCRIPTORS } from "../../packages/telemetry-projection-registry/src/domain.js";
import { loadConfig } from "../../packages/telemetry-config/src/index.js";
import type { DomainSourceBatchRequest } from "../../packages/telemetry-contracts/src/index.js";
import { hashCanonicalDomainProjectionJson } from "../../packages/telemetry-contracts/src/index.js";
import type {
  DomainProjectionActivationGuard,
  DomainProjectionLifecycle,
} from "../../packages/telemetry-projection-registry/src/lifecycle.js";

const url = process.env["SDAR_TEST_CONTROL_POSTGRES_URL"];
test(
  "real PG persists lifecycle, ingestion origin, fencing and restart-safe completion",
  { skip: !url },
  async () => {
    const pool = new Pool({ connectionString: url });
    const scope = {
      tenantId: "isolated-test",
      projectId: `runtime-${Date.now()}`,
    };
    const hash = `sha256:${"a".repeat(64)}` as const;
    const initial: DomainProjectionLifecycle = {
      projectionId: "application_to_embodied.dp-c01",
      projectionVersion: 1,
      state: "MAPPING_CONTRACT_BLOCKED",
      revision: 0,
      definitionHash: hash,
      mappingHash: hash,
      lastActionId: "",
      lastActionHash: null,
    };
    const guard: DomainProjectionActivationGuard = {
      expectedSchemaHash: hash,
      actualSchemaHash: hash,
      expectedReleaseHash: hash,
      actualReleaseHash: hash,
      expectedDefinitionHash: hash,
      expectedMappingHash: hash,
      sourceContractApproved: true,
      payloadContractApproved: true,
      targetContractApproved: true,
      activeProducerRegistered: true,
      fixtureQualificationMode: false,
      schemaDrift: false,
      maxMode: "active",
    };
    try {
      const files: string[] = await readdir("migrations/control-postgres");
      for (const file of files.filter((f) => /^\d{3}.*\.sql$/u.test(f)).sort())
        await pool.query(
          await readFile(`migrations/control-postgres/${file}`, "utf8"),
        );
      const runtime = new DomainRuntimeRepository(pool),
        control = new DomainProjectionControlRepository(pool);
      await runtime.initialize(scope, initial);
      const origin = (await runtime.list(scope))[0]!.activatedAt;
      await runtime.initialize(scope, initial);
      assert.equal((await runtime.list(scope))[0]!.activatedAt, origin);
      for (const [suffix, projectionId, projectionVersion] of [
        ["unknown", "unknown.mapping", 1],
        ["version", initial.projectionId, 2],
      ] as const) {
        const actionId = `${scope.projectId}-${suffix}`;
        await control.registerManagementAction({
          actionId,
          projectionId,
          projectionVersion,
          actionType: "approve_definition",
          expectedRevision: 0,
          requestedBy: "isolated-test",
          payload: {
            ...scope,
            expectedDefinitionHash: hash,
            expectedMappingHash: hash,
          },
          requestHash: hash,
        });
        await runtime.applyAction(scope, actionId, async () => guard);
        assert.equal(
          (await runtime.actions(scope)).find((a) => a.actionId === actionId)
            ?.status,
          "rejected",
        );
        assert.equal((await runtime.list(scope))[0]!.lifecycle.revision, 0);
      }
      for (const [index, mode] of [
        "approve",
        "shadow",
        "dry_run",
        "active",
      ].entries()) {
        const payload = {
          ...scope,
          mode,
          expectedDefinitionHash: hash,
          expectedMappingHash: hash,
        };
        const action = {
          actionId: `${scope.projectId}-${index}`,
          projectionId: initial.projectionId,
          projectionVersion: 1,
          actionType:
            index === 0
              ? ("approve_definition" as const)
              : ("set_mode" as const),
          expectedRevision: index,
          requestedBy: "test",
          payload,
          requestHash: hashCanonicalDomainProjectionJson(payload),
        };
        await control.registerManagementAction(action);
        await runtime.applyAction(scope, action.actionId, async () => guard);
        await runtime.applyAction(scope, action.actionId, async () => guard);
        assert.equal(
          (await runtime.list(scope))[0]!.lifecycle.revision,
          index + 1,
        );
      }
      assert.equal((await runtime.list(scope))[0]!.lifecycle.state, "ACTIVE");
      const key = {
        targetId: "test-target",
        projectionId: initial.projectionId,
        projectionVersion: 1,
        mappingHash: hash,
        sourceStream: "sdar.domain-source/v1",
        partitionId: scope.projectId,
        leaseOwner: "test-worker",
        durationMs: 30000,
      };
      const lease = await control.claimLease(key);
      assert.ok(lease);
      if (!lease) throw new Error("test lease missing");
      const record = {
        identityHash: hash,
        contentHash: hash,
        cursor: {
          ingestedAt: new Date().toISOString(),
          recordId: "test-only",
          sourceRevision: "1",
        },
      };
      await assert.rejects(
        runtime.complete(
          scope,
          initial.projectionId,
          lease,
          record,
          async () => {
            throw new Error("TARGET_WRITE_FAILED");
          },
        ),
        /TARGET_WRITE_FAILED/,
      );
      assert.equal((await runtime.list(scope))[0]!.completedCursor, null);
      let writes = 0;
      await runtime.complete(
        scope,
        initial.projectionId,
        lease,
        record,
        async () => {
          writes++;
          return { outcome: "produced", checkpointEligible: true };
        },
      );
      const resumed = new DomainRuntimeRepository(pool);
      await resumed.initialize(scope, initial);
      await resumed.complete(
        scope,
        initial.projectionId,
        lease,
        record,
        async () => {
          writes++;
          return { outcome: "produced", checkpointEligible: true };
        },
      );
      assert.equal(writes, 1);
      assert.equal((await resumed.list(scope))[0]!.activatedAt, origin);
      assert.deepEqual(
        (await resumed.list(scope))[0]!.completedCursor,
        record.cursor,
      );
      // Fractional timestamp spelling must not reverse the durable completion frontier.
      const precise = {
        ...record,
        identityHash: `sha256:${"b".repeat(64)}`,
        cursor: { ...record.cursor, ingestedAt: "2099-01-01T00:00:00.123Z" },
      };
      await resumed.complete(
        scope,
        initial.projectionId,
        lease,
        precise,
        async () => ({ outcome: "produced", checkpointEligible: true }),
      );
      const later = {
        ...precise,
        identityHash: `sha256:${"c".repeat(64)}`,
        cursor: { ...record.cursor, ingestedAt: "2099-01-01T00:00:00.123456Z" },
      };
      await resumed.complete(
        scope,
        initial.projectionId,
        lease,
        later,
        async () => ({ outcome: "produced", checkpointEligible: true }),
      );
      assert.deepEqual(
        (await resumed.list(scope))[0]!.completedCursor,
        later.cursor,
      );
      await control.releaseLease(lease);
      await assert.rejects(
        resumed.complete(
          scope,
          initial.projectionId,
          lease,
          record,
          async () => ({ outcome: "produced", checkpointEligible: true }),
        ),
        /LEASE_LOST/,
      );
    } finally {
      await pool.end();
    }
  },
);
test(
  "worker actually executes ten active mappings, waiting-source, write failure, restart and contract drift",
  { skip: !url },
  async () => {
    const database = new ControlPostgres(url!);
    const scope = { tenantId: "worker-test", projectId: `loop-${Date.now()}` };
    const objects = JSON.parse(
      await readFile(
        "integrations/sdar-clickhouse/1.5.1-rc.2/required-object-descriptors.json",
        "utf8",
      ),
    ) as {
      objects: {
        name: string;
        table: Record<string, unknown>;
        columns: Record<string, unknown>[];
      }[];
    };
    const records: DomainSourceBatchRequest["records"][number][] = [];
    for (const application of ["commander", "npc"]) {
      const batch = JSON.parse(
        await readFile(
          `integrations/domain-source/contracts/v1/fixtures/valid/${application}-five-records.batch.json`,
          "utf8",
        ),
      ) as DomainSourceBatchRequest;
      records.push(
        ...batch.records.map((record) => ({
          ...record,
          ...scope,
          producerId: `test-${application}`,
        })),
      );
    }
    const writes: string[] = [];
    let available = false;
    let failWrites = false;
    let drift = false;
    const clickHouse = {
      query: async (sql: string): Promise<string> => {
        let data: unknown[] = [];
        if (sql.includes("FROM system.tables"))
          data = objects.objects
            .filter((o) =>
              sql.includes(
                `database='${o.table["database"]}' AND name='${o.table["name"]}'`,
              ),
            )
            .map((o) => o.table);
        else if (sql.includes("FROM system.columns"))
          data = objects.objects
            .filter((o) =>
              sql.includes(
                `database='${o.table["database"]}' AND table='${o.table["name"]}'`,
              ),
            )
            .flatMap((o) => o.columns);
        else if (sql.includes("v_schema_contract_release_current"))
          data = [
            {
              release_version: drift ? "drift" : "1.5.1-rc.2",
              schema_contract_hash:
                "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8",
              release_descriptor_hash:
                "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335",
            },
          ];
        else if (sql.includes("uniqExact"))
          data = [{ count: available ? 1 : 0 }];
        else if (sql.startsWith("SELECT * FROM sdar_") && available) {
          assert.ok(
            sql.includes("tenant_id=unhex") &&
              sql.includes("ingested_at>=") &&
              sql.includes("producer_id=unhex"),
          );
          const descriptor = DOMAIN_PROJECTION_DESCRIPTORS.find((d) =>
            sql.includes(`FROM ${d.sourceQualifiedTable}\n`),
          );
          const record = records.find(
            (record) =>
              record.sourceContractId === descriptor?.sourceContractId,
          );
          if (record) data = [sourceRow(record)];
        }
        return JSON.stringify({ data });
      },
      insert: async (table: string, _rows: Record<string, unknown>[]) => {
        if (failWrites)
          throw Object.assign(new Error("TARGET_WRITE_FAILED"), {
            code: "TARGET_WRITE_FAILED",
          });
        writes.push(table);
      },
    };
    try {
      const preflight = await ClickHouseDomainSchemaPreflight.load(clickHouse);
      const config = loadConfig({
        DOMAIN_PROJECTION_MAX_MODE: "active",
      }).domainProjection;
      const runtime = new DomainRuntime(
        database,
        clickHouse,
        preflight,
        scope,
        config,
      );
      await runtime.initialize();
      await runtime.processOnce();
      assert.ok(
        (await runtime.snapshot()).projections.every(
          (p) => p.lastErrorCode === "DOMAIN_SOURCE_PRODUCER_NOT_REGISTERED",
        ),
      );
      for (const application of ["commander", "npc"] as const)
        await database.domainProjections.registerProducer({
          producerId: `${scope.projectId}-${application}`,
          application,
          ...scope,
          contractVersion: "sdar.domain-source/v1",
          credentialRef: "test-only",
          metadata: { fixture: true },
        });
      // Test source identity is exactly the registered identity; no live source is written.
      for (const record of records)
        (record as { producerId: string }).producerId =
          `${scope.projectId}-${record.producerId.endsWith("npc") ? "npc" : "commander"}`;
      for (const [index, mode] of [
        "approve",
        "shadow",
        "dry_run",
        "active",
      ].entries()) {
        for (const row of await database.domainRuntime.list(scope)) {
          const payload = {
            ...scope,
            mode,
            expectedDefinitionHash: row.lifecycle.definitionHash,
            expectedMappingHash: row.lifecycle.mappingHash,
          };
          await database.domainProjections.registerManagementAction({
            actionId: `${scope.projectId}-${row.lifecycle.projectionId}-${index}`,
            projectionId: row.lifecycle.projectionId,
            projectionVersion: 1,
            actionType: index === 0 ? "approve_definition" : "set_mode",
            expectedRevision: index,
            requestedBy: "isolated-test",
            requestHash: hashCanonicalDomainProjectionJson(payload),
            payload,
          });
        }
        await runtime.processOnce();
      }
      const empty = await runtime.snapshot();
      assert.ok(
        empty.projections.every(
          (p) =>
            p.lifecycle === "ACTIVE" &&
            p.dataStatus === "waiting_source" &&
            p.pendingRecords === 0,
        ),
      );
      assert.equal(writes.length, 0);
      available = true;
      failWrites = true;
      await runtime.processOnce();
      // The formal target adapter normalizes transport errors to this stable boundary code.
      const failed = await runtime.snapshot();
      assert.ok(
        failed.projections.every(
          (p) =>
            p.lastErrorCode === "TARGET_WRITE_TRANSIENT" &&
            p.checkpoint === null,
        ),
      );
      failWrites = false;
      await runtime.processOnce();
      const observed = await runtime.snapshot();
      assert.ok(
        observed.projections.every(
          (p) => p.dataStatus === "observed" && p.pendingRecords === 0,
        ),
      );
      assert.equal(
        writes.filter((table) => table === "sdar_meta.projection_lineage")
          .length,
        10,
      );
      assert.equal(writes.length, 20);
      const restarted = new DomainRuntime(
        database,
        clickHouse,
        preflight,
        scope,
        config,
      );
      await restarted.initialize();
      await restarted.processOnce();
      assert.equal(writes.length, 20);
      drift = true;
      await restarted.processOnce();
      assert.ok(
        (await restarted.snapshot()).projections.every(
          (p) => p.lastErrorCode === "SCHEMA_CONTRACT_DRIFT",
        ),
      );
      assert.equal(writes.length, 20);
    } finally {
      await database.close();
    }
  },
);
function sourceRow(
  record: DomainSourceBatchRequest["records"][number],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of [
    "tenantId",
    "projectId",
    "environment",
    "recordId",
    "episodeId",
    "taskId",
    "contextId",
    "agentId",
    "agentVersion",
    "scenarioId",
    "correlationId",
    "sequence",
    "sourceRevision",
    "sourceContractId",
    "sourceContractVersion",
    "producerId",
    "producerVersion",
  ])
    row[key.replace(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`)] =
      (record as unknown as Record<string, unknown>)[key] ?? "";
  return {
    ...row,
    payload_json: JSON.stringify(record.payload),
    payload_sha256: record.payloadHash.slice(7),
    occurred_at: record.occurredAt,
    ingested_at: new Date().toISOString(),
    state_snapshot_version: "1",
  };
}
