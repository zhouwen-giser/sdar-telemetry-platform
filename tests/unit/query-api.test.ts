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
  buildDomainProjectionQuery,
  clickHouseStringExpression,
  createQueryApi,
  loadQueryBearerCredential,
  type QueryClickHouseClient,
} from "../../apps/query-api/src/server.js";
import type { ClickHouseQueryOptions } from "../../packages/telemetry-clickhouse/src/index.js";

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
    () => createQueryApi({ clickHouse: new FakeClickHouse(), bearerCredential: "short" }),
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

interface QueryCall {
  readonly sql: string;
  readonly options: ClickHouseQueryOptions | undefined;
}

interface QueryEnvelope {
  readonly data: unknown;
  readonly watermark: string | null;
  readonly sourceCoverage: { expected: string[]; observed: string[] };
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
): Promise<void> {
  const server = createQueryApi({
    clickHouse,
    bearerCredential: queryCredential,
    maxResultRows: 321,
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
