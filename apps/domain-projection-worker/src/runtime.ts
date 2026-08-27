import { randomUUID } from "node:crypto";
import type { ControlPostgres } from "../../../packages/telemetry-control-postgres/src/index.js";
import {
  failure,
  stableCode,
  type DomainRuntimeScope,
} from "../../../packages/telemetry-control-postgres/src/domain-runtime.js";
import {
  DOMAIN_PROJECTION_DESCRIPTORS,
  type DomainProjectionId,
} from "../../../packages/telemetry-projection-registry/src/domain.js";
import type {
  DomainProjectionActivationGuard,
  DomainProjectionLifecycle,
} from "../../../packages/telemetry-projection-registry/src/lifecycle.js";
import { CommanderDomainMapper } from "../../../packages/telemetry-projection-registry/src/commander-mappings.js";
import { NpcDomainMapper } from "../../../packages/telemetry-projection-registry/src/npc-mappings.js";
import type { PlatformConfig } from "../../../packages/telemetry-config/src/index.js";
import { ClickHouseDomainSchemaPreflight } from "./schema-preflight.js";
import {
  ClickHouseDomainTargetWriter,
  type DomainTargetClickHouseClient,
} from "./target-writer.js";
import { readScopedSource, scopedSourceQuery } from "./scoped-source-reader.js";
import type { DomainProjectionRuntimeSnapshot } from "./server.js";

export class DomainRuntime {
  private cycle: Promise<void> | undefined;
  private readonly commander = new CommanderDomainMapper();
  private readonly npc = new NpcDomainMapper();
  private readonly writer: ClickHouseDomainTargetWriter;
  private readonly verified = new Map<string, number>();
  constructor(
    private readonly database: ControlPostgres,
    private readonly clickHouse: DomainTargetClickHouseClient,
    private readonly preflight: ClickHouseDomainSchemaPreflight,
    private readonly scope: DomainRuntimeScope,
    private readonly config: PlatformConfig["domainProjection"],
  ) {
    this.writer = new ClickHouseDomainTargetWriter(clickHouse);
  }

  async initialize(): Promise<void> {
    for (const descriptor of DOMAIN_PROJECTION_DESCRIPTORS) {
      await this.database.domainRuntime.initialize(this.scope, {
        projectionId: descriptor.definition.projectionId as DomainProjectionId,
        projectionVersion: 1,
        state: "MAPPING_CONTRACT_BLOCKED",
        revision: 0,
        definitionHash: descriptor.definitionHash,
        mappingHash: this.preflight.expectedMappingHash(descriptor.mappingId),
        lastActionId: "",
        lastActionHash: null,
      });
    }
  }
  processOnce(): Promise<void> {
    if (this.cycle !== undefined) return this.cycle;
    const promise = this.run();
    this.cycle = promise;
    void promise.then(
      () => {
        this.cycle = undefined;
      },
      () => {
        this.cycle = undefined;
      },
    );
    return promise;
  }
  private async guard(
    state: DomainProjectionLifecycle,
  ): Promise<DomainProjectionActivationGuard> {
    const descriptor = DOMAIN_PROJECTION_DESCRIPTORS.find(
      (d) => d.definition.projectionId === state.projectionId,
    );
    if (
      descriptor === undefined ||
      descriptor.definitionHash !== state.definitionHash
    )
      throw failure("PROJECTION_ACTIVATION_HASH_MISMATCH");
    const producers = await this.database.domainRuntime.producers(this.scope);
    const application = descriptor.mappingId.startsWith("DP-C")
      ? "commander"
      : "npc";
    if (producers.filter((p) => p.application === application).length !== 1)
      throw failure("DOMAIN_SOURCE_PRODUCER_NOT_REGISTERED");
    if (Date.now() - (this.verified.get(state.projectionId) ?? 0) > 30000) {
      await this.preflight.verify({
        descriptor,
        mappingHash: state.mappingHash,
      });
      this.verified.set(state.projectionId, Date.now());
    }
    const document: unknown = JSON.parse(
      await this.clickHouse.query(
        `SELECT release_version,schema_contract_hash,release_descriptor_hash
      FROM sdar_meta.v_schema_contract_release_current LIMIT 1 FORMAT JSON`,
        { readonly: 2, maxResultRows: 1 },
      ),
    );
    const expectedSchemaHash =
      "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8";
    const expectedReleaseHash =
      "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335";
    if (
      document === null ||
      typeof document !== "object" ||
      !("data" in document) ||
      !Array.isArray(document.data)
    )
      throw failure("SCHEMA_CONTRACT_DRIFT");
    const row: unknown = document.data[0];
    if (
      row === null ||
      typeof row !== "object" ||
      !("release_version" in row) ||
      row.release_version !== "1.5.1-rc.2" ||
      !("schema_contract_hash" in row) ||
      row.schema_contract_hash !== expectedSchemaHash ||
      !("release_descriptor_hash" in row) ||
      row.release_descriptor_hash !== expectedReleaseHash
    )
      throw failure("SCHEMA_CONTRACT_DRIFT");
    return {
      expectedSchemaHash,
      actualSchemaHash: expectedSchemaHash,
      expectedReleaseHash,
      actualReleaseHash: expectedReleaseHash,
      expectedDefinitionHash: descriptor.definitionHash,
      expectedMappingHash: this.preflight.expectedMappingHash(
        descriptor.mappingId,
      ),
      sourceContractApproved: true,
      payloadContractApproved: true,
      targetContractApproved: true,
      activeProducerRegistered: true,
      fixtureQualificationMode: false,
      schemaDrift: false,
      maxMode: this.config.maxMode,
    };
  }
  private async run(): Promise<void> {
    if (!this.config.enabled) return;
    for (const action of await this.database.domainRuntime.pendingActions(
      this.scope,
    )) {
      await this.database.domainRuntime.applyAction(
        this.scope,
        action,
        (state) => this.guard(state),
      );
    }
    const producers = await this.database.domainRuntime.producers(this.scope);
    for (const row of await this.database.domainRuntime.list(this.scope)) {
      const state = row.lifecycle;
      const descriptor = DOMAIN_PROJECTION_DESCRIPTORS.find(
        (d) => d.definition.projectionId === state.projectionId,
      )!;
      const producer = producers.find(
        (p) =>
          p.application ===
          (descriptor.mappingId.startsWith("DP-C") ? "commander" : "npc"),
      );
      if (producer === undefined) {
        await this.database.domainRuntime.error(
          this.scope,
          state.projectionId,
          "DOMAIN_SOURCE_PRODUCER_NOT_REGISTERED",
        );
        continue;
      }
      if (state.state !== "ACTIVE" || this.config.maxMode !== "active")
        continue;
      let lease = null;
      try {
        await this.guard(state);
        lease = await this.database.domainProjections.claimLease({
          targetId: "sdar-warehouse",
          projectionId: state.projectionId,
          projectionVersion: 1,
          mappingHash: state.mappingHash,
          sourceStream: "sdar.domain-source/v1",
          partitionId: JSON.stringify([
            this.scope.tenantId,
            this.scope.projectId,
            producer.producerId,
          ]),
          leaseOwner: this.config.workerId,
          durationMs: this.config.leaseMs,
        });
        if (lease === null) continue;
        const records = await readScopedSource(this.clickHouse, {
          scope: this.scope,
          producerId: producer.producerId,
          activatedAt: row.activatedAt,
          descriptor,
          cursor: row.scanCursor,
          limit: this.config.batchSize,
        });
        if (records.length === 0) {
          // Scan position may wrap; immutable activation floor and completed identity ledger never do.
          // Revisiting only post-activation input also catches out-of-order landing after a WAL outage.
          await this.database.domainRuntime.resetScan(
            this.scope,
            state.projectionId,
            lease,
          );
        }
        for (const source of records) {
          const renewed = await this.database.domainProjections.renewLease(
            lease,
            this.config.leaseMs,
          );
          if (renewed === null) throw failure("PROJECTION_LEASE_LOST");
          lease = renewed;
          await this.database.domainRuntime.complete(
            this.scope,
            state.projectionId,
            lease,
            {
              identityHash: source.identityHash,
              contentHash: source.contentHash,
              cursor: source.ingestionCursor,
            },
            () =>
              this.writer.close({
                descriptor,
                source: source.record,
                decision:
                  producer.application === "commander"
                    ? this.commander.map(source.record)
                    : this.npc.map(source.record),
                projectionRunId: randomUUID(),
                mappingHash: state.mappingHash,
                sourceCursor: JSON.stringify(source.ingestionCursor),
                projectedAt: new Date().toISOString(),
              }),
          );
        }
        await this.database.domainRuntime.error(
          this.scope,
          state.projectionId,
          "",
        );
      } catch (error) {
        await this.database.domainRuntime.error(
          this.scope,
          state.projectionId,
          stableCode(error),
        );
      } finally {
        if (lease !== null)
          await this.database.domainProjections.releaseLease(lease);
      }
    }
  }
  async snapshot(): Promise<DomainProjectionRuntimeSnapshot> {
    const rows = await this.database.domainRuntime.list(this.scope);
    const projections = rows.map((row) => ({
      projectionId: row.lifecycle.projectionId,
      lifecycle: row.lifecycle.state,
      revision: row.lifecycle.revision,
      definitionHash: row.lifecycle.definitionHash,
      mappingHash: row.lifecycle.mappingHash,
      activatedAt: row.activatedAt,
      dataStatus: row.lastErrorCode
        ? "blocked"
        : row.lifecycle.state !== "ACTIVE"
          ? "inactive"
          : row.completedCursor === null
            ? "waiting_source"
            : "observed",
      checkpoint: row.completedCursor,
      pendingRecords: null as number | null,
      lastErrorCode: row.lastErrorCode || null,
      input: row.produced + row.skipped + row.failed,
      produced: row.produced,
      skipped: row.skipped,
      failed: row.failed,
      duplicate: row.duplicates,
      checkpointWatermarkMs:
        row.completedCursor === null
          ? 0
          : Date.parse(row.completedCursor.ingestedAt),
      lagMs: null,
      openBlockingDeadLetters: null,
      schemaDrift: row.lastErrorCode?.includes("DRIFT") ?? false,
      lastSuccessfulRunMs: null,
      leaseOwner: "",
      leaseExpiryMs: 0,
      readySeals: null,
      expectedSeals: null,
    }));
    let clickHouseReady = false;
    try {
      await this.clickHouse.query("SELECT 1 FORMAT JSON", {
        readonly: 2,
        maxResultRows: 1,
      });
      clickHouseReady = true;
    } catch {
      clickHouseReady = false;
    }
    const sources = await this.database.domainRuntime.producers(this.scope);
    for (const [index, metric] of projections.entries()) {
      const row = rows[index]!;
      const descriptor = DOMAIN_PROJECTION_DESCRIPTORS.find(
        (d) => d.definition.projectionId === metric.projectionId,
      )!;
      const producer = sources.find(
        (p) =>
          p.application ===
          (descriptor.mappingId.startsWith("DP-C") ? "commander" : "npc"),
      );
      if (!producer) continue;
      const lease = await this.database.domainProjections.readActiveLease({
        targetId: "sdar-warehouse",
        projectionId: metric.projectionId,
        projectionVersion: 1,
        mappingHash: row.lifecycle.mappingHash,
        sourceStream: "sdar.domain-source/v1",
        partitionId: JSON.stringify([
          this.scope.tenantId,
          this.scope.projectId,
          producer.producerId,
        ]),
      });
      metric.leaseOwner = lease?.leaseOwner ?? "";
      metric.leaseExpiryMs = lease === null ? 0 : Date.parse(lease.leaseUntil);
      try {
        const bounded = scopedSourceQuery({
          scope: this.scope,
          producerId: producer.producerId,
          activatedAt: row.activatedAt,
          descriptor,
          cursor: null,
          limit: 1,
        });
        const sql = bounded
          .replace(
            "SELECT *",
            "SELECT uniqExact(tuple(record_id,source_revision)) AS count",
          )
          .replace(
            /ORDER BY ingested_at,record_id,source_revision LIMIT 1/u,
            "",
          );
        const value = JSON.parse(
          await this.clickHouse.query(sql, { readonly: 2, maxResultRows: 1 }),
        ) as { data: { count: string | number }[] };
        const count = Number(value.data[0]?.count);
        if (!Number.isSafeInteger(count) || count < 0)
          throw failure("DOMAIN_BACKLOG_RESPONSE_INVALID");
        metric.pendingRecords = Math.max(
          0,
          count -
            (await this.database.domainRuntime.completedCount(
              this.scope,
              metric.projectionId,
            )),
        );
      } catch {
        metric.pendingRecords = null;
      }
    }
    return {
      scope: this.scope,
      actions: await this.database.domainRuntime.actions(this.scope),
      sources: sources.map((source) => ({
        producerId: source.producerId,
        application: source.application,
        contractVersion: source.contractVersion,
      })),
      controlPostgresReady: await this.database.health(),
      clickHouseReady,
      schemaContractReady:
        projections.length === DOMAIN_PROJECTION_DESCRIPTORS.length &&
        projections.every(
          (p) => this.verified.has(p.projectionId) && !p.schemaDrift,
        ),
      projections,
    };
  }
}
