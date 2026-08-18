import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Pool } from "pg";

import {
  DomainProjectionControlError,
  DomainProjectionControlRepository,
  type ClaimDomainProjectionLease,
} from "../../packages/telemetry-control-postgres/src/index.js";

const databaseUrl = process.env.SDAR_TEST_CONTROL_POSTGRES_URL;
const mappingHash = `sha256:${"1".repeat(64)}`;
const requestHash = `sha256:${"2".repeat(64)}`;

test(
  "Control PostgreSQL lease permits one writer and fences every stale owner",
  { skip: databaseUrl === undefined ? "SDAR_TEST_CONTROL_POSTGRES_URL is not configured" : false },
  async () => {
    assert.ok(databaseUrl);
    const migrationPool = new Pool({ connectionString: databaseUrl, max: 2 });
    const clients = Array.from(
      { length: 12 },
      () => new Pool({ connectionString: databaseUrl, max: 1 }),
    );
    try {
      await migrate(migrationPool);
      const key: ClaimDomainProjectionLease = {
        targetId: "clickhouse-primary",
        projectionId: "application_to_embodied.dp-c01",
        projectionVersion: 1,
        mappingHash,
        sourceStream: "sdar.domain-source/v1",
        partitionId: `phase4-${process.pid}`,
        leaseOwner: "placeholder",
        durationMs: 30_000,
      };
      const contenders = clients.map(
        (pool, index) =>
          new DomainProjectionControlRepository(pool).claimLease({
            ...key,
            leaseOwner: `worker-${index}`,
          }),
      );
      const claimed = (await Promise.all(contenders)).filter((lease) => lease !== null);
      assert.equal(claimed.length, 1);
      const first = claimed[0]!;
      assert.equal(first.fencingToken, 1);

      const blocked = await new DomainProjectionControlRepository(clients[0]!).claimLease({
        ...key,
        leaseOwner: "blocked-worker",
      });
      assert.equal(blocked, null);

      const renewed = await new DomainProjectionControlRepository(clients[1]!).renewLease(
        first,
        30_000,
      );
      assert.equal(renewed?.fencingToken, first.fencingToken);
      assert.equal(renewed?.leaseToken, first.leaseToken);
      assert.equal(
        await new DomainProjectionControlRepository(clients[2]!).releaseLease(renewed!),
        true,
      );

      const reclaimed = await Promise.all([
        new DomainProjectionControlRepository(clients[3]!).claimLease({
          ...key,
          leaseOwner: "reclaimer-a",
        }),
        new DomainProjectionControlRepository(clients[4]!).claimLease({
          ...key,
          leaseOwner: "reclaimer-b",
        }),
      ]);
      const secondWinners = reclaimed.filter((lease) => lease !== null);
      assert.equal(secondWinners.length, 1);
      assert.equal(secondWinners[0]!.fencingToken, 2);

      assert.equal(
        await new DomainProjectionControlRepository(clients[5]!).renewLease(first, 30_000),
        null,
      );
      assert.equal(
        await new DomainProjectionControlRepository(clients[6]!).releaseLease(first),
        false,
      );

      const independent = await new DomainProjectionControlRepository(clients[7]!).claimLease({
        ...key,
        partitionId: `${key.partitionId}-independent`,
        leaseOwner: "independent-worker",
      });
      assert.equal(independent?.fencingToken, 1);
    } finally {
      await Promise.allSettled(clients.map((pool) => pool.end()));
      await migrationPool.end();
    }
  },
);

test(
  "Control PostgreSQL stores idempotent actions, bounded replay requests and producers",
  { skip: databaseUrl === undefined ? "SDAR_TEST_CONTROL_POSTGRES_URL is not configured" : false },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const repository = new DomainProjectionControlRepository(pool);
    const suffix = `${process.pid}-${Date.now()}`;
    try {
      await migrate(pool);
      const actionInput = {
        actionId: `phase4-action-${suffix}`,
        projectionId: "application_to_embodied.dp-c01",
        projectionVersion: 1,
        actionType: "set_mode" as const,
        expectedRevision: 0,
        requestedBy: "phase4-integration",
        requestHash,
        payload: { mode: "shadow" },
      };
      const action = await repository.registerManagementAction(actionInput);
      const duplicateAction = await repository.registerManagementAction(actionInput);
      assert.equal(action.actionId, duplicateAction.actionId);
      assert.equal(action.status, "pending");
      await assert.rejects(
        repository.registerManagementAction({
          ...actionInput,
          requestHash: `sha256:${"3".repeat(64)}`,
        }),
        (error: unknown) =>
          error instanceof DomainProjectionControlError &&
          error.code === "DOMAIN_PROJECTION_ACTION_ID_CONFLICT",
      );

      const replayInput = {
        replayRequestId: `phase4-replay-${suffix}`,
        projectionId: "application_to_embodied.dp-c01",
        projectionVersion: 1,
        mappingHash,
        tenantId: "phase4-tenant",
        projectId: "phase4-project",
        episodeId: "phase4-episode",
        fromCursor: { occurredAt: "2026-08-17T00:00:00.000Z", sourceRecordId: "a" },
        toCursor: { occurredAt: "2026-08-17T00:01:00.000Z", sourceRecordId: "z" },
        requestedBy: "phase4-integration",
        requestHash,
      };
      const replay = await repository.registerReplayRequest(replayInput);
      const duplicateReplay = await repository.registerReplayRequest(replayInput);
      assert.equal(replay.replayRequestId, duplicateReplay.replayRequestId);
      assert.equal(replay.status, "requested");

      const reconciliationInput = {
        reconciliationRequestId: `phase12-reconcile-${suffix}`,
        projectionId: replayInput.projectionId,
        projectionVersion: replayInput.projectionVersion,
        mappingHash,
        tenantId: replayInput.tenantId,
        projectId: replayInput.projectId,
        episodeId: replayInput.episodeId,
        fromCursor: replayInput.fromCursor,
        toCursor: replayInput.toCursor,
        requestedBy: "phase12-integration",
        requestHash,
      };
      const reconciliation = await repository.registerReconciliationRequest(reconciliationInput);
      const duplicateReconciliation = await repository.registerReconciliationRequest(
        reconciliationInput,
      );
      assert.equal(
        reconciliation.reconciliationRequestId,
        duplicateReconciliation.reconciliationRequestId,
      );
      assert.equal(reconciliation.status, "requested");

      const producer = await repository.registerProducer({
        producerId: `phase4-producer-${suffix}`,
        application: "commander",
        tenantId: "phase4-tenant",
        projectId: `phase4-project-${suffix}`,
        contractVersion: "sdar.domain-source/v1",
        credentialRef: "secret:phase4-domain-source",
        metadata: { qualificationMode: "fixture" },
      });
      assert.equal(producer.status, "active");
      const heartbeat = await repository.heartbeatProducer(producer.producerId);
      assert.ok(heartbeat?.lastHeartbeatAt);
    } finally {
      await pool.end();
    }
  },
);

async function migrate(pool: Pool): Promise<void> {
  for (const filename of [
    "001_init.sql",
    "002_domain_projection_runtime.sql",
    "003_domain_projection_reconciliation.sql",
  ]) {
    const sql = await readFile(path.join(process.cwd(), "migrations/control-postgres", filename),
      "utf8",
    );
    await pool.query(sql);
  }
}
