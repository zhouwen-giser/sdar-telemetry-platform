import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EVIDENCE_V1_CANONICAL_TABLE,
  EVIDENCE_V1_CONTRACT,
  DOMAIN_PROJECTION_V1_CONTRACT,
  SMPP_PROVIDEROPS_V1_CONTRACT,
  buildDomainProjectionQuery,
  buildSmppProviderQuery,
  clickHouseStringExpression,
  createQueryApi,
  loadQueryBearerCredential,
  type QueryClickHouseClient,
  type QueryBackendDiagnostic,
} from "../../apps/query-api/src/server.js";
import type { ClickHouseQueryOptions } from "../../packages/telemetry-clickhouse/src/index.js";
import type {
  TelemetryHttpAuthorizationPolicy,
} from "../../packages/telemetry-config/src/index.js";

const watermark = "2026-08-14T04:05:06.123Z";
const watermarkMilliseconds = Date.parse(watermark);
const queryCredential = "query-api-test-credential";

test("health remains independent of ClickHouse", async () => {
  const clickHouse = new FakeClickHouse();
  await withQueryApi(clickHouse, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
  assert.deepEqual(clickHouse.calls, []);
});

test("Query API credential configuration accepts exactly one inline or file source", async () => {
  assert.equal(
    await loadQueryBearerCredential({ QUERY_API_BEARER_TOKEN: queryCredential }),
    queryCredential,
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "query-credential-"));
  const filename = path.join(directory, "token");
  await writeFile(filename, `${queryCredential}\n`, { mode: 0o600 });
  assert.equal(
    await loadQueryBearerCredential({ QUERY_API_BEARER_TOKEN_FILE: filename }),
    queryCredential,
  );
  await assert.rejects(
    loadQueryBearerCredential({
      QUERY_API_BEARER_TOKEN: queryCredential,
      QUERY_API_BEARER_TOKEN_FILE: filename,
    }),
    /QUERY_CREDENTIAL_CONFIGURATION_INVALID/u,
  );
  assert.throws(
    () =>
      createQueryApi({
        clickHouse: new FakeClickHouse(),
        authorization: { profile: "bearer", bearerCredential: "short" },
      }),
    /QUERY_CREDENTIAL_CONFIGURATION_INVALID/u,
  );
  await rm(directory, { recursive: true });
});

test("timeline reads only canonical Evidence v1 rows with safe task identity", async () => {
  const taskId = "task-' OR 1 = 1 --\\unicode-任务";
  const clickHouse = new FakeClickHouse(
    clickHouseJson([
      {
        task_id: taskId,
        record_id: `evidence_${"a".repeat(64)}`,
        record_type: "runtime.task",
      },
    ]),
  );
  await withQueryApi(clickHouse, async (baseUrl) => {
    const response = await queryFetch(
      `${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}/timeline`,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as QueryEnvelope;
    assert.equal(body.watermark, watermark);
    assert.deepEqual(body.sourceCoverage, {
      expected: [EVIDENCE_V1_CONTRACT],
      observed: [EVIDENCE_V1_CONTRACT],
    });
    assert.deepEqual(body.data, [
      {
        task_id: taskId,
        record_id: `evidence_${"a".repeat(64)}`,
        record_type: "runtime.task",
      },
    ]);
  });

  assert.equal(clickHouse.calls.length, 1);
  const call = clickHouse.calls[0] as QueryCall;
  assert.deepEqual(call.options, { readonly: 2, maxResultRows: 321 });
  assert.match(call.sql, new RegExp(`FROM ${escapeRegExp(EVIDENCE_V1_CANONICAL_TABLE)} FINAL`, "u"));
  assert.match(call.sql, /task_id = unhex\('[0-9a-f]+'\)/u);
  assert.match(call.sql, /ORDER BY occurred_at, length\(evidence_sequence\)/u);
  assert.equal(call.sql.includes(taskId), false);
  assert.equal(call.sql.includes("sdar_mart"), false);
  assert.equal(call.sql.includes("sdar-v1.3"), false);
});

test("capability-chain limits canonical rows to capability record types", async () => {
  const clickHouse = new FakeClickHouse(clickHouseJson([]));
  await withQueryApi(clickHouse, async (baseUrl) => {
    const response = await queryFetch(`${baseUrl}/v1/tasks/task-42/capability-chain`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as QueryEnvelope;
    assert.deepEqual(body.data, []);
    assert.equal(body.watermark, null);
    assert.deepEqual(body.sourceCoverage, {
      expected: [EVIDENCE_V1_CONTRACT],
      observed: [],
    });
  });

  const sql = (clickHouse.calls[0] as QueryCall).sql;
  assert.match(sql, /record_type LIKE 'capability\.%'/u);
  assert.match(sql, /record_type LIKE 'node_control\.capability%'/u);
  assert.equal(sql.includes("task_capability_chain"), false);
  assert.equal(sql.includes("sdar_mart"), false);
});

test("evidence trace supports every lineage key and both node identities", async () => {
  const values = {
    episodeId: "episode-1",
    exportId: "export-2",
    sourceId: "source-3",
    nodeId: "node-'unsafe",
    recordId: `evidence_${"b".repeat(64)}`,
  };
  const clickHouse = new FakeClickHouse(clickHouseJson([]));
  await withQueryApi(clickHouse, async (baseUrl) => {
    const url = new URL(`${baseUrl}/v1/evidence/trace`);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    const response = await queryFetch(url);
    assert.equal(response.status, 200);
  });

  const sql = (clickHouse.calls[0] as QueryCall).sql;
  assert.match(sql, /episode_id = unhex\('[0-9a-f]+'\)/u);
  assert.match(sql, /export_id = unhex\('[0-9a-f]+'\)/u);
  assert.match(sql, /source_id = unhex\('[0-9a-f]+'\)/u);
  assert.match(sql, /record_id = unhex\('[0-9a-f]+'\)/u);
  assert.match(
    sql,
    /\(node_id = unhex\('[0-9a-f]+'\) OR batch_node_id = unhex\('[0-9a-f]+'\)\)/u,
  );
  for (const value of Object.values(values)) assert.equal(sql.includes(value), false);
});

test("trace rejects missing, unknown, duplicate, and empty filters without querying", async () => {
  const clickHouse = new FakeClickHouse();
  await withQueryApi(clickHouse, async (baseUrl) => {
    const cases: Array<[string, string]> = [
      ["missing", `${baseUrl}/v1/evidence/trace`],
      ["unknown", `${baseUrl}/v1/evidence/trace?taskId=task-1`],
      ["duplicate", `${baseUrl}/v1/evidence/trace?sourceId=one&sourceId=two`],
      ["empty", `${baseUrl}/v1/evidence/trace?episodeId=`],
    ];
    for (const [name, url] of cases) {
      const response = await queryFetch(url);
      assert.equal(response.status, 400, name);
      const body = (await response.json()) as { errorCode: string };
      assert.match(body.errorCode, /^QUERY_ARGUMENT_/u, name);
    }
  });
  assert.deepEqual(clickHouse.calls, []);
});

test("backend failures and malformed results return a v1 degraded envelope", async () => {
  const clickHouse = new FakeClickHouse(new Error("backend secret"), "{not-json");
  await withQueryApi(clickHouse, async (baseUrl) => {
    for (const taskId of ["backend-error", "invalid-json"]) {
      const response = await queryFetch(`${baseUrl}/v1/tasks/${taskId}/timeline`);
      assert.equal(response.status, 503);
      const body = (await response.json()) as QueryEnvelope & {
        data: { errorCode: string };
      };
      assert.equal(body.data.errorCode.startsWith("QUERY_"), true);
      assert.equal(JSON.stringify(body).includes("backend secret"), false);
      assert.equal(body.watermark, null);
      assert.deepEqual(body.sourceCoverage, {
        expected: [EVIDENCE_V1_CONTRACT],
        observed: [],
      });
    }
  });
});

test("domain projection backend failure preserves a safe typed cause and route-correct coverage", async () => {
  const cause = Object.assign(
    new Error(
      "ClickHouse request failed with HTTP 500: Code: 60. SELECT secret_body FROM hidden password=hunter2 https://user:token@clickhouse:8123/?authorization=Bearer-secret (UNKNOWN_TABLE)",
    ),
    {code: "CLICKHOUSE_RESPONSE_ERROR",stack: "secret stack SELECT secret_body"},
  );
  const clickHouse = new FakeClickHouse(cause);
  const diagnostics: QueryBackendDiagnostic[] = [];
  await withQueryApi(
    clickHouse,
    async (baseUrl) => {
      const response = await queryFetch(`${baseUrl}/v1/domain-projections`);
      assert.equal(response.status, 503);
      const body = (await response.json()) as QueryEnvelope & {data: {errorCode: string}};
      assert.deepEqual(body.data, {errorCode: "QUERY_BACKEND_UNAVAILABLE"});
      assert.equal(body.watermark, null);
      assert.deepEqual(body.sourceCoverage, {
        expected: [DOMAIN_PROJECTION_V1_CONTRACT],
        actual: [DOMAIN_PROJECTION_V1_CONTRACT],
      });
      assert.equal("observed" in body.sourceCoverage, false);
    },
    undefined,
    (diagnostic) => diagnostics.push(diagnostic),
  );

  assert.equal(clickHouse.calls.length, 1);
  assert.match(clickHouse.calls[0]!.sql, /FROM sdar_meta\.v_domain_projection_health/u);
  assert.deepEqual(clickHouse.calls[0]!.options, {readonly: 2,maxResultRows: 321});
  assert.deepEqual(diagnostics, [{
    event: "query_api.backend_error",
    queryId: "domain-projection-health",
    sqlClass: "readonly-domain-projection-health",
    relation: "sdar_meta.v_domain_projection_health",
    contract: DOMAIN_PROJECTION_V1_CONTRACT,
    errorClass: "ClickHouseClientError",
    causeCode: "CLICKHOUSE_RESPONSE_ERROR",
    clickHouseCode: 60,
    httpStatus: 500,
    message: "ClickHouse backend query failed with HTTP status 500 and ClickHouse code 60; response details redacted.",
  }]);
  const serialized = JSON.stringify(diagnostics);
  for (const forbidden of [
    "SELECT",
    "secret_body",
    "hunter2",
    "clickhouse:8123",
    "user:token",
    "authorization",
    "Bearer-secret",
    "UNKNOWN_TABLE",
    "stack",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("domain projection success uses the exact V3 expected and actual coverage fields", async () => {
  const rows = Array.from({length: 10}, (_, index) => ({
    projection_id: `application_to_embodied.dp-${index < 5 ? "c" : "n"}${String((index % 5) + 1).padStart(2, "0")}`,
    projection_version: "1",
    health_status: "defined_disabled",
  }));
  const clickHouse = new FakeClickHouse(clickHouseJson(rows));
  await withQueryApi(clickHouse, async (baseUrl) => {
    const response = await queryFetch(`${baseUrl}/v1/domain-projections`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as QueryEnvelope;
    assert.deepEqual(body.data, rows);
    assert.deepEqual(body.sourceCoverage, {
      expected: [DOMAIN_PROJECTION_V1_CONTRACT],
      actual: [DOMAIN_PROJECTION_V1_CONTRACT],
    });
    assert.equal("observed" in body.sourceCoverage, false);
  });
  assert.equal(clickHouse.calls.length, 1);
  assert.match(clickHouse.calls[0]!.sql, /FROM sdar_meta\.v_domain_projection_health/u);
});

test("unsupported methods and routes are rejected without querying", async () => {
  const clickHouse = new FakeClickHouse();
  await withQueryApi(clickHouse, async (baseUrl) => {
    const method = await queryFetch(`${baseUrl}/v1/tasks/task-1/timeline`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET");
    assert.deepEqual(await method.json(), { errorCode: "QUERY_METHOD_INVALID" });

    const route = await queryFetch(`${baseUrl}/v1/unknown`);
    assert.equal(route.status, 404);
    assert.deepEqual(await route.json(), { errorCode: "QUERY_ROUTE_NOT_FOUND" });
  });
  assert.deepEqual(clickHouse.calls, []);
});

test("all evidence queries require the independent Query API Bearer credential", async () => {
  const clickHouse = new FakeClickHouse();
  await withQueryApi(clickHouse, async (baseUrl) => {
    for (const headers of [undefined, { authorization: "Bearer wrong-credential" }]) {
      const response = await fetch(`${baseUrl}/v1/tasks/task-1/timeline`, { headers });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.deepEqual(await response.json(), { errorCode: "QUERY_CREDENTIAL_INVALID" });
    }
  });
  assert.deepEqual(clickHouse.calls, []);
});

test("development-anonymous skips only Query API Bearer verification", async () => {
  const clickHouse = new FakeClickHouse(clickHouseJson([]));
  await withQueryApi(
    clickHouse,
    async (baseUrl) => {
      const timeline = await fetch(`${baseUrl}/v1/tasks/task-1/timeline`);
      assert.equal(timeline.status, 200);
      assert.deepEqual(((await timeline.json()) as QueryEnvelope).data, []);

      const method = await fetch(`${baseUrl}/v1/tasks/task-1/timeline`, { method: "POST" });
      assert.equal(method.status, 405);
      assert.equal(method.headers.get("allow"), "GET");
      assert.deepEqual(await method.json(), { errorCode: "QUERY_METHOD_INVALID" });

      const route = await fetch(`${baseUrl}/v1/unknown`);
      assert.equal(route.status, 404);
      assert.deepEqual(await route.json(), { errorCode: "QUERY_ROUTE_NOT_FOUND" });
    },
    { profile: "development-anonymous" },
  );
  assert.equal(clickHouse.calls.length, 1);
});

test("ClickHouse string expressions contain only a fixed function and UTF-8 hex", () => {
  const value = "'\\); SELECT secret FROM system.tables -- 零";
  const expectedHex = Buffer.from(value, "utf8").toString("hex");
  assert.equal(clickHouseStringExpression(value), `unhex('${expectedHex}')`);
});

test("Domain Query matrix is typed, bounded and never embeds caller values", () => {
  const malicious = "projection-' OR 1=1 -- 零";
  const encoded = encodeURIComponent(malicious);
  const routes = [
    "/v1/domain-projections",
    `/v1/domain-projections/${encoded}`,
    "/v1/domain-projection-sets",
    "/v1/domain-projection-sets/embodied-standard/1",
    "/v1/domain-episodes/episode-1/readiness",
    "/v1/domain-episodes/episode-1/facts",
    `/v1/domain-projections/${encoded}/runs`,
    `/v1/domain-projections/${encoded}/checkpoints`,
    `/v1/domain-projections/${encoded}/lineage`,
    `/v1/domain-projections/${encoded}/dead-letters`,
  ];
  for (const route of routes) {
    const sql = buildDomainProjectionQuery(route);
    assert.match(sql, /^SELECT\n  \*,/u);
    assert.match(sql, /ORDER BY/u);
    assert.match(sql, /FORMAT JSON$/u);
    assert.equal(sql.includes(malicious), false);
    assert.doesNotMatch(sql, /\$\{|;|\bINSERT\b|\bALTER\b|\bDROP\b/iu);
  }
  assert.throws(
    () => buildDomainProjectionQuery("/v1/domain-projections/x/arbitrary-sql"),
    /QUERY_ROUTE_NOT_FOUND/u,
  );
});

test("all 11 SMPP delta endpoints are allowlisted, bounded, and use only frozen targets/views", () => {
  const unsafe = "id-' OR 1=1 -- 零";
  const encoded = encodeURIComponent(unsafe);
  const routes = [
    ["/v1/smpp/provider-facts", new URLSearchParams({providerId: unsafe})],
    [`/v1/smpp/provider-facts/${encoded}`, new URLSearchParams()],
    ["/v1/smpp/relations", new URLSearchParams({sourceEntityId: unsafe})],
    [`/v1/smpp/tasks/${encoded}/timeline`, new URLSearchParams()],
    [`/v1/smpp/resources/${encoded}/state`, new URLSearchParams()],
    [`/v1/smpp/resources/${encoded}/health`, new URLSearchParams()],
    [`/v1/smpp/executions/${encoded}/progress`, new URLSearchParams()],
    ["/v1/smpp/reconciliation", new URLSearchParams()],
    [`/v1/episodes/${encoded}/mcp-provider-telemetry`, new URLSearchParams()],
    [`/v1/episodes/${encoded}/mcp-provider-readiness`, new URLSearchParams()],
    ["/v1/smpp/projection-status", new URLSearchParams()],
  ] as const;
  for (const [route, parameters] of routes) {
    const sql = buildSmppProviderQuery(route, parameters);
    assert.match(sql, /FORMAT JSON$/u);
    assert.equal(sql.includes(unsafe), false);
    assert.doesNotMatch(sql, /\b(INSERT|ALTER|DROP|TRUNCATE)\b/iu);
    assert.match(sql, /sdar_core\.(external_provider_fact|external_entity_relation_fact|remote_task_binding|v_smpp_|v_sdar_smpp_)/u);
  }
  assert.throws(
    () => buildSmppProviderQuery("/v1/smpp/provider-facts", new URLSearchParams({sql: "SELECT 1"})),
    /QUERY_ARGUMENT_INVALID/u,
  );
});

test("episode readiness follows exact task relations and provider completed remains non-Goal evidence", async () => {
  const relation = {
    __relation_id: "22222222-2222-5222-8222-222222222222",
    __relation_type: "invokes",
    __source_entity_type: "task",
    __source_entity_id: "sdar-task-1",
    __target_entity_type: "task",
    __target_entity_id: "provider-task-1",
    __evidence_fact_ids: ["11111111-1111-5111-8111-111111111111"],
    __relation_source_hash: "b".repeat(64),
    __relation_projection_id: "smpp_relations_to_sdar_core",
    __relation_projection_version: 1,
  };
  const base = {
    fact_id: "11111111-1111-5111-8111-111111111111",
    fact_hash: "a".repeat(64), smpp_source_id: "smpp.test.provider-one",
    external_task_id: "provider-task-1", occurred_at: watermark, projected_at: watermark,
    ...relation,
  };
  const clickHouse = new FakeClickHouse(clickHouseJson([
    {...base, fact_type: "provider.task.lifecycle", lifecycle_status: "completed"},
    {...base, fact_id: "33333333-3333-5333-8333-333333333333", fact_hash: "c".repeat(64), fact_type: "provider.command.lifecycle"},
    {...base, fact_id: "44444444-4444-5444-8444-444444444444", fact_hash: "d".repeat(64), fact_type: "provider.execution.progress"},
  ]));
  await withQueryApi(clickHouse, async (baseUrl) => {
    const response = await queryFetch(`${baseUrl}/v1/episodes/episode-1/mcp-provider-readiness`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as QueryEnvelope & {data: {status: string; goalSuccessProven: boolean; physicalSuccessProven: boolean}};
    assert.equal(body.data.status, "ready");
    assert.equal(body.data.goalSuccessProven, false);
    assert.equal(body.data.physicalSuccessProven, false);
    assert.deepEqual(body.sourceCoverage, {expected: [SMPP_PROVIDEROPS_V1_CONTRACT], observed: [SMPP_PROVIDEROPS_V1_CONTRACT]});
  });
  const sql = (clickHouse.calls[0] as QueryCall).sql;
  assert.match(sql, /episode_bindings/u);
  assert.match(sql, /FROM sdar_core\.remote_task_binding FINAL/u);
  assert.match(sql, /source_entity_type = 'task'/u);
  assert.match(sql, /target_entity_type = 'task'/u);
  assert.doesNotMatch(sql, /dateDiff|time.?window/iu);
});

interface QueryCall {
  readonly sql: string;
  readonly options: ClickHouseQueryOptions | undefined;
}

interface QueryEnvelope {
  readonly data: unknown;
  readonly watermark: string | null;
  readonly sourceCoverage: { expected: string[]; observed?: string[]; actual?: string[] };
}

class FakeClickHouse implements QueryClickHouseClient {
  readonly calls: QueryCall[] = [];
  private readonly responses: Array<string | Error>;

  constructor(...responses: Array<string | Error>) {
    this.responses = [...responses];
  }

  async query(sql: string, options?: ClickHouseQueryOptions): Promise<string> {
    this.calls.push({ sql, options });
    const response = this.responses.shift() ?? clickHouseJson([]);
    if (response instanceof Error) throw response;
    return response;
  }
}

function clickHouseJson(rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    data: rows.map((row) => ({
      ...row,
      __sdar_watermark_ms: String(watermarkMilliseconds),
    })),
  });
}

async function withQueryApi(
  clickHouse: QueryClickHouseClient,
  operation: (baseUrl: string) => Promise<void>,
  authorization: TelemetryHttpAuthorizationPolicy | undefined = undefined,
  onBackendError?: (diagnostic: QueryBackendDiagnostic) => void,
): Promise<void> {
  const server = createQueryApi({
    clickHouse,
    authorization: authorization ?? {
      profile: "bearer",
      bearerCredential: queryCredential,
    },
    maxResultRows: 321,
    onBackendError,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("TEST_SERVER_INVALID");
  try {
    await operation(`http://127.0.0.1:${String(address.port)}`);
  } finally {
    await closeServer(server);
  }
}

function queryFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${queryCredential}`);
  return fetch(input, { ...init, headers });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
