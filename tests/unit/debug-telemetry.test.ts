import assert from "node:assert/strict";
import test from "node:test";
import {
  DiagnosticFederation,
  diagnosticPath,
} from "../../apps/query-api/src/diagnostic-federation.js";
import { trustedDevelopment } from "../../packages/telemetry-config/src/development.js";
import { scopedSourceQuery } from "../../apps/domain-projection-worker/src/scoped-source-reader.js";
import { DOMAIN_PROJECTION_DESCRIPTORS } from "../../packages/telemetry-projection-registry/src/domain.js";
import { bootstrapDebugProjection } from "../../scripts/bootstrap-ugv-debug.js";
import {
  domainProjectionRuntimeReady,
  renderDomainProjectionMetrics,
} from "../../apps/domain-projection-worker/src/server.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createQueryApi } from "../../apps/query-api/src/server.js";
import {
  createDomainAdminApi,
  type DomainAdminPort,
} from "../../apps/admin-api/src/server.js";
import type { Server } from "node:http";

test("diagnostic federation bounds every request and cannot choose a SQL/upstream", async () => {
  for (const path of [
    "/v1/metrics?sql=SELECT+1",
    "/v1/traces?limit=1001",
    "/v1/traces?offset=100001",
    "/v1/metrics?limit=1&limit=2",
    "/v1/traces/../secret",
    "/v1/traces/not-a-trace",
    "/v1/metrics?type=anything",
    "/v1/traces?from=bad",
  ]) {
    if (path.includes("../")) continue;
    assert.throws(
      () => diagnosticPath(new URL(path, "http://local")),
      /DIAGNOSTIC_ARGUMENT_INVALID/,
    );
  }
  assert.throws(
    () => new DiagnosticFederation("http://upstream/some-path"),
    /CONFIGURATION_INVALID/,
  );
  const calls: string[] = [];
  const upstream: typeof fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.method, "GET");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.headers, undefined);
    return Response.json({
      data: [{ metricName: "real-upstream-fixture" }],
      pagination: { limit: 1 },
      source: "otlp",
    });
  };
  const result = await new DiagnosticFederation(
    "http://internal:8088",
    upstream,
  ).query(new URL("http://public/v1/metrics?limit=1"));
  assert.deepEqual(calls, ["http://internal:8088/api/v1/metrics?limit=1"]);
  assert.equal(result["source"], "otlp");
  assert.equal((result["federation"] as { readOnly: boolean }).readOnly, true);
  await assert.rejects(
    new DiagnosticFederation(
      "http://internal",
      async () => new Response("bad", { status: 500 }),
    ).query(new URL("http://public/v1/traces")),
    /UNAVAILABLE/,
  );
});
test("development opt-in leaves production authentication unchanged", () => {
  assert.equal(trustedDevelopment({}), false);
  assert.equal(
    trustedDevelopment({ TELEMETRY_TRUSTED_DEVELOPMENT: "true" }),
    true,
  );
  assert.throws(
    () => trustedDevelopment({ TELEMETRY_TRUSTED_DEVELOPMENT: "YES" }),
    /INVALID/,
  );
});
test("anonymous development Query/Admin and authenticated production use the same real HTTP routes", async () => {
  let actor = "";
  const port: DomainAdminPort = {
    registerProducer: async () => ({}),
    heartbeatProducer: async () => ({}),
    registerProjectionAction: async (_id, body) => {
      actor = String(body["requestedBy"]);
      return {};
    },
    requestReconciliation: async () => ({}),
    requestReplay: async () => ({}),
    applyDeadLetterAction: async () => ({}),
  };
  const hash = `sha256:${"a".repeat(64)}`;
  for (const development of [false, true]) {
    const query = createQueryApi({
      clickHouse: { query: async () => JSON.stringify({ data: [] }) },
      bearerCredential: "test-only-query-token",
      trustedDevelopment: development,
      diagnostics: new DiagnosticFederation("http://internal", async () =>
        Response.json({ data: [] }),
      ),
    });
    const admin = createDomainAdminApi({
      port,
      bearerCredential: "test-only-admin-token",
      trustedDevelopment: development,
    });
    await withServer(query, async (base) => {
      assert.equal(
        (await fetch(base + "/v1/metrics?limit=1")).status,
        development ? 200 : 401,
      );
    });
    await withServer(admin, async (base) => {
      const response = await fetch(
        base +
          "/v1/admin/domain-projections/application_to_embodied.dp-c01/actions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actionId: "test-action",
            projectionVersion: 1,
            expectedRevision: 0,
            expectedDefinitionHash: hash,
            expectedMappingHash: hash,
            requestHash: hash,
            requestedBy: "spoofed-admin",
            payload: { tenantId: "test", projectId: "test" },
            actionType: "approve_definition",
          }),
        },
      );
      assert.equal(response.status, development ? 202 : 401);
    });
  }
  assert.equal(actor, "ugv-debug-development");
});
async function withServer(
  server: Server,
  action: (base: string) => Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test listen failed");
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
test("domain reads always have tenant, project, producer and durable ingestion floor", () => {
  const input = {
    scope: { tenantId: "tenant-1", projectId: "project-1" },
    producerId: "actual-producer",
    activatedAt: "2026-08-26T10:00:00.123456Z",
    descriptor: DOMAIN_PROJECTION_DESCRIPTORS[0]!,
    cursor: null,
    limit: 100,
  };
  const sql = scopedSourceQuery(input);
  for (const predicate of [
    "tenant_id=unhex",
    "project_id=unhex",
    "producer_id=unhex",
    "ingested_at>=",
    "LIMIT 100",
  ])
    assert.ok(sql.includes(predicate));
  assert.ok(!sql.includes("1970"));
  assert.ok(!sql.includes("occurred_at>"));
  assert.throws(
    () => scopedSourceQuery({ ...input, activatedAt: "" }),
    /CURSOR_INVALID/,
  );
  assert.throws(
    () => scopedSourceQuery({ ...input, limit: 1001 }),
    /SCOPE_INVALID/,
  );
});
test("bootstrap performs four real management transitions and repeat activation sends zero actions", async () => {
  const hash = `sha256:${"a".repeat(64)}`;
  const projections = DOMAIN_PROJECTION_DESCRIPTORS.map((d) => ({
    projectionId: d.definition.projectionId,
    definitionHash: d.definitionHash,
    mappingHash: hash,
    lifecycle: "MAPPING_CONTRACT_BLOCKED",
    revision: 0,
    lastErrorCode: null,
  }));
  let writes = 0;
  let registered = true;
  let drift = false;
  const request: typeof fetch = async (url, options) => {
    if (options?.method === "POST") {
      writes++;
      const action = JSON.parse(String(options.body)) as {
        expectedRevision: number;
        actionType: string;
        payload: { mode: string };
      };
      const row = projections.find((row) =>
        String(url).includes(row.projectionId),
      )!;
      assert.equal(row.revision, action.expectedRevision);
      row.revision++;
      row.lifecycle =
        action.actionType === "approve_definition"
          ? "APPROVED_DISABLED"
          : ({
              shadow: "SHADOW_READ_ONLY",
              dry_run: "DRY_RUN",
              active: "ACTIVE",
            }[action.payload.mode] ?? "invalid");
      return Response.json({ status: "applied" });
    }
    return Response.json({
      scope: { tenantId: "t", projectId: "p" },
      sources: registered
        ? [{ application: "commander" }, { application: "npc" }]
        : [],
      actions: [],
      projections: drift
        ? projections.map((row) => ({ ...row, mappingHash: "drift" }))
        : projections,
    });
  };
  const config = { tenantId: "t", projectId: "p", producers: [] };
  await bootstrapDebugProjection(
    config,
    () => hash,
    request,
    async () => {},
  );
  assert.equal(writes, 40);
  assert.ok(
    projections.every(
      (row) => row.lifecycle === "ACTIVE" && row.revision === 4,
    ),
  );
  await bootstrapDebugProjection(
    config,
    () => hash,
    request,
    async () => {},
  );
  assert.equal(writes, 40);
  registered = false;
  assert.equal(
    await bootstrapDebugProjection(config, () => hash, request),
    "waiting_configuration",
  );
  assert.equal(writes, 40);
  registered = true;
  drift = true;
  await assert.rejects(
    bootstrapDebugProjection(config, () => hash, request),
    /HASH_MISMATCH/,
  );
  assert.equal(writes, 40);
  assert.equal(
    domainProjectionRuntimeReady({
      clickHouseReady: true,
      controlPostgresReady: true,
      schemaContractReady: true,
      projections: [],
    }),
    true,
  );
});
test("debug composition is active, internal-PG, no Grafana and only the reviewed additive warehouse migration", async () => {
  const compose = await readFile("deploy/ugv-debug/compose.yaml", "utf8");
  for (const value of [
    'DOMAIN_PROJECTION_ENABLED: "true"',
    "DOMAIN_PROJECTION_MAX_MODE: active",
    'TELEMETRY_TRUSTED_DEVELOPMENT: "true"',
    "dist/scripts/apply-evidence-v1-migration.js",
    "ALLOW_CLICKHOUSE_ADDITIVE_MIGRATION: sdar.evidence/v1",
    "dist/scripts/apply-provider-closure-v2-migration.js",
    "ALLOW_CLICKHOUSE_ADDITIVE_MIGRATION: sdar.provider-closure/v2",
    "dist/scripts/provider-closure-debug.js, bootstrap",
    "dist/scripts/provider-closure-debug.js, status",
    "smpp-telemetry-query:8088",
  ])
    assert.ok(compose.includes(value));
  assert.ok(!/grafana|3000|5432:5432/iu.test(compose));
  for (const port of [8080, 8081, 8082, 8083])
    assert.ok(compose.includes(`0.0.0.0:${port}:${port}`));
  const ddl = await readFile(
    "migrations/clickhouse/014_sdar_evidence_v1_canonical.sql",
  );
  assert.equal(
    createHash("sha256").update(ddl).digest("hex"),
    "fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9",
  );
  const providerDdl = await readFile("migrations/clickhouse/015_provider_closure_v2.sql");
  assert.equal(
    createHash("sha256").update(providerDdl).digest("hex"),
    "dba7693c2ee3fe52bc4ea61182cce87244c6f83dbf2f5a94048da9fb9ed9740a",
  );
});
test("unknown lag, seal and DLQ measurements are omitted rather than fabricated zeroes", () => {
  const value = renderDomainProjectionMetrics({
    clickHouseReady: true,
    controlPostgresReady: true,
    schemaContractReady: true,
    projections: [
      {
        projectionId: "test",
        input: 0,
        produced: 0,
        skipped: 0,
        failed: 0,
        duplicate: 0,
        checkpointWatermarkMs: 0,
        lagMs: null,
        openBlockingDeadLetters: null,
        schemaDrift: false,
        lastSuccessfulRunMs: null,
        leaseOwner: "",
        leaseExpiryMs: 0,
        readySeals: null,
        expectedSeals: null,
      },
    ],
  });
  assert.ok(value.includes("produced_total"));
  assert.ok(
    !/lag_ms|open_blocking_dlq|ready_seals|expected_seals/u.test(value),
  );
});
