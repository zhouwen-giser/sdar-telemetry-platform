import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatchDomainAdminCommand,
  parseDomainAdminCommand,
  type DomainAdminPort,
} from "../../apps/admin-api/src/server.js";
import {
  domainProjectionRuntimeReady,
  renderDomainProjectionMetrics,
  type DomainProjectionRuntimeSnapshot,
} from "../../apps/domain-projection-worker/src/server.js";

const HASH = `sha256:${"a".repeat(64)}`;

test("Admin endpoint matrix emits only typed scope-pinned commands", async () => {
  const port = new MemoryAdminPort();
  const envelope = {
    actionId: "action-1",
    projectionVersion: 1,
    expectedRevision: 0,
    expectedDefinitionHash: HASH,
    expectedMappingHash: HASH,
    requestHash: HASH,
    requestedBy: "operator",
    payload: {},
    actionType: "set_mode",
  };
  const routes = [
    ["/v1/admin/domain-projections/application_to_embodied.dp-c01/actions", "projectionAction"],
    ["/v1/admin/domain-projections/application_to_embodied.dp-c01/reconcile", "reconcile"],
    ["/v1/admin/domain-projections/application_to_embodied.dp-c01/replay", "replay"],
    ["/v1/admin/domain-dead-letters/dead-letter-1/actions", "deadLetterAction"],
  ] as const;
  for (const [route, kind] of routes) {
    const command = parseDomainAdminCommand("POST", route, envelope);
    assert.equal(command.kind, kind);
    await dispatchDomainAdminCommand(port, command);
  }
  const producer = parseDomainAdminCommand("POST", "/v1/admin/domain-source-producers", {
    producerId: "producer-1",
    application: "commander",
    tenantId: "tenant",
    projectId: "project",
    contractVersion: "sdar.domain-source/v1",
    credentialRef: "secret:domain-source",
    metadata: {},
  });
  await dispatchDomainAdminCommand(port, producer);
  await dispatchDomainAdminCommand(
    port,
    parseDomainAdminCommand("POST", "/v1/admin/domain-source-producers/producer-1/heartbeat", null),
  );
  assert.deepEqual(port.calls.map((call) => call[0]), [
    "projectionAction", "reconcile", "replay", "deadLetterAction", "registerProducer", "heartbeatProducer",
  ]);
});

test("Admin commands reject missing hashes, stale shape and unknown routes", () => {
  const body = {
    actionId: "action-1",
    projectionVersion: 1,
    expectedRevision: 0,
    expectedDefinitionHash: HASH,
    expectedMappingHash: HASH,
    requestHash: HASH,
    requestedBy: "operator",
    payload: {},
  };
  for (const invalid of [
    { ...body, expectedMappingHash: "bad" },
    { ...body, projectionVersion: 0 },
    { ...body, payload: [] },
    { ...body, arbitrarySql: "SELECT 1" },
  ]) {
    assert.throws(
      () => parseDomainAdminCommand("POST", "/v1/admin/domain-projections/p/actions", invalid),
      /ADMIN_COMMAND_INVALID/u,
    );
  }
  assert.throws(
    () => parseDomainAdminCommand("POST", "/v1/admin/sql", body),
    /ADMIN_ROUTE_NOT_FOUND/u,
  );
});

test("worker readiness covers dependencies and metrics expose every required dimension", () => {
  const snapshot: DomainProjectionRuntimeSnapshot = {
    clickHouseReady: true,
    controlPostgresReady: true,
    schemaContractReady: true,
    projections: [{
      projectionId: 'projection-"unsafe',
      input: 10,
      produced: 7,
      skipped: 1,
      failed: 1,
      duplicate: 1,
      checkpointWatermarkMs: 100,
      lagMs: 20,
      openBlockingDeadLetters: 1,
      schemaDrift: false,
      lastSuccessfulRunMs: 90,
      leaseOwner: "worker\n1",
      leaseExpiryMs: 120,
      readySeals: 1,
      expectedSeals: 2,
    }],
  };
  assert.equal(domainProjectionRuntimeReady(snapshot), true);
  assert.equal(domainProjectionRuntimeReady({ ...snapshot, schemaContractReady: false }), false);
  const metrics = renderDomainProjectionMetrics(snapshot);
  for (const name of ["input_total", "produced_total", "skipped_total", "failed_total", "duplicate_total", "checkpoint_watermark_ms", "lag_ms", "open_blocking_dlq", "schema_drift", "last_successful_run_ms", "lease_expiry_ms", "ready_seals", "expected_seals", "lease_info"]) {
    assert.match(metrics, new RegExp(`sdar_domain_projection_${name}`, "u"));
  }
  assert.match(metrics, /projection_id="projection-\\"unsafe"/u);
  assert.match(metrics, /lease_owner="worker\\n1"/u);
});

class MemoryAdminPort implements DomainAdminPort {
  readonly calls: Array<readonly [string, string]> = [];
  async registerProducer(command: Record<string, unknown>) { this.calls.push(["registerProducer", String(command.producerId)]); return {}; }
  async heartbeatProducer(id: string) { this.calls.push(["heartbeatProducer", id]); return {}; }
  async registerProjectionAction(id: string) { this.calls.push(["projectionAction", id]); return {}; }
  async requestReconciliation(id: string) { this.calls.push(["reconcile", id]); return {}; }
  async requestReplay(id: string) { this.calls.push(["replay", id]); return {}; }
  async applyDeadLetterAction(id: string) { this.calls.push(["deadLetterAction", id]); return {}; }
}
