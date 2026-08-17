import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { ClickHouseQueryOptions } from "../../../packages/telemetry-clickhouse/src/index.js";
import { envelope } from "../../../packages/telemetry-query-model/src/index.js";

export const EVIDENCE_V1_CONTRACT = "sdar.evidence/v1";
export const DOMAIN_PROJECTION_V1_CONTRACT = "sdar.domain-projection/v1";
export const EVIDENCE_V1_CANONICAL_TABLE = "sdar_core.sdar_evidence_v1_record";
export const DEFAULT_QUERY_MAX_RESULT_ROWS = 10_000;

const WATERMARK_COLUMN = "__sdar_watermark_ms";
const TRACE_ROUTE = "/v1/evidence/trace";
const MAXIMUM_QUERY_VALUE_BYTES = 4_096;

export interface QueryClickHouseClient {
  query(sql: string, options?: ClickHouseQueryOptions): Promise<string>;
}

export interface QueryApiDependencies {
  readonly clickHouse: QueryClickHouseClient;
  readonly bearerCredential: string;
  readonly maxResultRows?: number;
}

export class QueryApiError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "QueryApiError";
  }
}

export function createQueryApi(dependencies: QueryApiDependencies): Server {
  const maxResultRows = dependencies.maxResultRows ?? DEFAULT_QUERY_MAX_RESULT_ROWS;
  if (!Number.isSafeInteger(maxResultRows) || maxResultRows < 1) {
    throw new QueryApiError("QUERY_RESULT_LIMIT_INVALID", 500);
  }
  if (dependencies.bearerCredential.length < 16 || dependencies.bearerCredential.length > 4_096) {
    throw new QueryApiError("QUERY_CREDENTIAL_CONFIGURATION_INVALID", 500);
  }
  const expectedCredentialDigest = credentialDigest(dependencies.bearerCredential);

  return http.createServer((request: IncomingMessage, response: ServerResponse) => {
    void handleRequest(
      request,
      response,
      dependencies.clickHouse,
      maxResultRows,
      expectedCredentialDigest,
    ).catch((error: unknown) => sendError(response, error));
  });
}

export async function loadQueryBearerCredential(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const inline = environment["QUERY_API_BEARER_TOKEN"];
  const file = environment["QUERY_API_BEARER_TOKEN_FILE"];
  if ((inline === undefined) === (file === undefined)) {
    throw new QueryApiError("QUERY_CREDENTIAL_CONFIGURATION_INVALID", 500);
  }
  const credential = inline ?? (await readFile(file as string, "utf8")).trim();
  if (credential.length < 16 || credential.length > 4_096) {
    throw new QueryApiError("QUERY_CREDENTIAL_CONFIGURATION_INVALID", 500);
  }
  return credential;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  clickHouse: QueryClickHouseClient,
  maxResultRows: number,
  expectedCredentialDigest: Buffer,
): Promise<void> {
  const url = parseRequestUrl(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  assertAuthorization(request, expectedCredentialDigest);
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    throw new QueryApiError("QUERY_METHOD_INVALID", 405);
  }

  const taskRoute = /^\/v1\/tasks\/([^/]+)\/(timeline|capability-chain)$/u.exec(url.pathname);
  let sql: string;
  let contract = EVIDENCE_V1_CONTRACT;
  if (taskRoute !== null) {
    const taskId = decodeQueryValue(taskRoute[1] as string);
    sql =
      taskRoute[2] === "timeline"
        ? buildTaskTimelineQuery(taskId)
        : buildTaskCapabilityChainQuery(taskId);
  } else if (url.pathname === TRACE_ROUTE) {
    sql = buildEvidenceTraceQuery(url.searchParams);
  } else if (url.pathname.startsWith("/v1/domain-")) {
    if ([...url.searchParams.keys()].length !== 0) {
      throw new QueryApiError("QUERY_ARGUMENT_INVALID", 400);
    }
    sql = buildDomainProjectionQuery(url.pathname);
    contract = DOMAIN_PROJECTION_V1_CONTRACT;
  } else {
    throw new QueryApiError("QUERY_ROUTE_NOT_FOUND", 404);
  }

  let raw: string;
  try {
    raw = await clickHouse.query(sql, { readonly: 2, maxResultRows });
  } catch {
    throw new QueryApiError("QUERY_BACKEND_UNAVAILABLE", 503);
  }
  const { rows, watermark } = parseClickHouseResult(raw, contract === EVIDENCE_V1_CONTRACT);
  sendJson(
    response,
    200,
    envelope(
      rows,
      watermark,
      [contract],
      rows.length === 0 ? [] : [contract],
    ),
  );
}

export function buildDomainProjectionQuery(pathname: string): string {
  if (pathname === "/v1/domain-projections") {
    return domainQuery("sdar_meta.v_domain_projection_health", "", "projection_id, projection_version", "last_run_updated_at");
  }
  let match = /^\/v1\/domain-projections\/([^/]+)$/u.exec(pathname);
  if (match !== null) {
    return domainQuery(
      "sdar_meta.v_domain_projection_health",
      `projection_id = ${clickHouseStringExpression(decodeQueryValue(match[1]!))}`,
      "projection_id, projection_version",
      "last_run_updated_at",
    );
  }
  if (pathname === "/v1/domain-projection-sets") {
    return domainQuery(
      "sdar_meta.v_domain_projection_set_readiness",
      "",
      "projection_set_id, projection_set_version",
      null,
    );
  }
  match = /^\/v1\/domain-projection-sets\/([^/]+)\/([^/]+)$/u.exec(pathname);
  if (match !== null) {
    return domainQuery(
      "sdar_meta.v_domain_projection_set_readiness",
      `projection_set_id = ${clickHouseStringExpression(decodeQueryValue(match[1]!))}\n  AND projection_set_version = ${clickHouseStringExpression(decodeQueryValue(match[2]!))}`,
      "projection_set_id, projection_set_version",
      null,
    );
  }
  match = /^\/v1\/domain-episodes\/([^/]+)\/(readiness|facts)$/u.exec(pathname);
  if (match !== null) {
    const episodeId = clickHouseStringExpression(decodeQueryValue(match[1]!));
    return match[2] === "readiness"
      ? domainQuery(
          "sdar_mart.v_episode_domain_readiness",
          `episode_id = ${episodeId}`,
          "projection_set_id, projection_set_version",
          "as_of_watermark",
        )
      : domainQuery(
          "sdar_embodied.v_episode_domain_fact_index",
          `episode_key = ${episodeId}`,
          "occurred_at, projection_id, target_table, target_record_id",
          "ingested_at",
        );
  }
  match = /^\/v1\/domain-projections\/([^/]+)\/(runs|checkpoints|lineage|dead-letters)$/u.exec(pathname);
  if (match !== null) {
    const projectionId = clickHouseStringExpression(decodeQueryValue(match[1]!));
    const resources = {
      runs: ["sdar_meta.projection_run", "updated_at", "updated_at, projection_run_id"],
      checkpoints: ["sdar_meta.projection_checkpoint", "updated_at", "updated_at, source_partition"],
      lineage: ["sdar_meta.projection_lineage", "projected_at", "projected_at, lineage_id"],
      "dead-letters": ["sdar_meta.projection_dead_letter", "updated_at", "updated_at, dead_letter_id"],
    } as const;
    const resource = resources[match[2] as keyof typeof resources];
    return domainQuery(resource[0], `projection_id = ${projectionId}`, resource[2], resource[1]);
  }
  throw new QueryApiError("QUERY_ROUTE_NOT_FOUND", 404);
}

function domainQuery(
  table: string,
  predicate: string,
  order: string,
  watermarkColumn: string | null,
): string {
  const watermark = watermarkColumn === null
    ? `CAST(NULL, 'Nullable(Int64)')`
    : `toUnixTimestamp64Milli(max(${watermarkColumn}) OVER ())`;
  return `SELECT
  *,
  ${watermark} AS ${WATERMARK_COLUMN}
FROM ${table}${predicate === "" ? "" : `\nWHERE ${predicate}`}
ORDER BY ${order}
FORMAT JSON`;
}

function assertAuthorization(request: IncomingMessage, expectedCredentialDigest: Buffer): void {
  const authorization = request.headers.authorization;
  const matched = typeof authorization === "string" ? /^Bearer ([^\s]+)$/u.exec(authorization) : null;
  const actualDigest = credentialDigest(matched?.[1] ?? "");
  if (!timingSafeEqual(actualDigest, expectedCredentialDigest)) {
    throw new QueryApiError("QUERY_CREDENTIAL_INVALID", 401);
  }
}

function credentialDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function buildTaskTimelineQuery(taskId: string): string {
  return canonicalQuery(`task_id = ${clickHouseStringExpression(taskId)}`);
}

export function buildTaskCapabilityChainQuery(taskId: string): string {
  return canonicalQuery(
    [
      `task_id = ${clickHouseStringExpression(taskId)}`,
      "(record_type LIKE 'capability.%' OR record_type LIKE 'node_control.capability%')",
    ].join("\n  AND "),
  );
}

export function buildEvidenceTraceQuery(parameters: URLSearchParams): string {
  const supported = new Set(["episodeId", "exportId", "sourceId", "nodeId", "recordId"]);
  for (const key of parameters.keys()) {
    if (!supported.has(key)) throw new QueryApiError("QUERY_ARGUMENT_INVALID", 400);
    if (parameters.getAll(key).length !== 1) {
      throw new QueryApiError("QUERY_ARGUMENT_INVALID", 400);
    }
  }

  const filters: string[] = [];
  addTraceFilter(filters, parameters, "episodeId", "episode_id");
  addTraceFilter(filters, parameters, "exportId", "export_id");
  addTraceFilter(filters, parameters, "sourceId", "source_id");
  addTraceFilter(filters, parameters, "recordId", "record_id");
  const nodeId = parameters.get("nodeId");
  if (nodeId !== null) {
    const encoded = clickHouseStringExpression(assertQueryValue(nodeId));
    filters.push(`(node_id = ${encoded} OR batch_node_id = ${encoded})`);
  }
  if (filters.length === 0) throw new QueryApiError("QUERY_ARGUMENT_REQUIRED", 400);
  return canonicalQuery(filters.join("\n  AND "));
}

/**
 * ClickHouse has no value-parameter hook in the shared HTTP client. Encoding UTF-8 bytes as hex
 * leaves only [0-9a-f] inside the SQL literal, so caller data cannot alter SQL syntax.
 */
export function clickHouseStringExpression(value: string): string {
  const checked = assertQueryValue(value);
  return `unhex('${Buffer.from(checked, "utf8").toString("hex")}')`;
}

function canonicalQuery(predicate: string): string {
  return `SELECT
  *,
  toUnixTimestamp64Milli(max(projected_at) OVER ()) AS ${WATERMARK_COLUMN}
FROM ${EVIDENCE_V1_CANONICAL_TABLE} FINAL
WHERE ${predicate}
ORDER BY occurred_at, length(evidence_sequence), evidence_sequence, record_id
FORMAT JSON`;
}

function addTraceFilter(
  filters: string[],
  parameters: URLSearchParams,
  parameter: string,
  column: string,
): void {
  const value = parameters.get(parameter);
  if (value !== null) filters.push(`${column} = ${clickHouseStringExpression(value)}`);
}

function assertQueryValue(value: string): string {
  if (value.length === 0 || Buffer.byteLength(value, "utf8") > MAXIMUM_QUERY_VALUE_BYTES) {
    throw new QueryApiError("QUERY_ARGUMENT_INVALID", 400);
  }
  return value;
}

function decodeQueryValue(value: string): string {
  try {
    return assertQueryValue(decodeURIComponent(value));
  } catch (error: unknown) {
    if (error instanceof QueryApiError) throw error;
    throw new QueryApiError("QUERY_ARGUMENT_INVALID", 400);
  }
}

function parseRequestUrl(value: string | undefined): URL {
  try {
    return new URL(value ?? "/", "http://query-api.local");
  } catch {
    throw new QueryApiError("QUERY_REQUEST_INVALID", 400);
  }
}

function parseClickHouseResult(raw: string, requireWatermark = true): {
  rows: Record<string, unknown>[];
  watermark: string | null;
} {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
  }
  if (!isObject(value) || !Array.isArray(value["data"])) {
    throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
  }

  let watermark: string | null = null;
  const rows = value["data"].map((candidate: unknown) => {
    if (!isObject(candidate)) throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
    const copy = { ...candidate };
    const rawWatermark = copy[WATERMARK_COLUMN];
    delete copy[WATERMARK_COLUMN];
    if (rawWatermark !== undefined && rawWatermark !== null) {
      const candidateWatermark = timestampMillisecondsToIso(rawWatermark);
      if (watermark !== null && watermark !== candidateWatermark) {
        throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
      }
      watermark = candidateWatermark;
    }
    return copy;
  });
  if (requireWatermark && rows.length > 0 && watermark === null) {
    throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
  }
  return { rows, watermark };
}

function timestampMillisecondsToIso(value: unknown): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^[0-9]+$/u.test(String(value))
  ) {
    throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
  }
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
  }
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    throw new QueryApiError("QUERY_BACKEND_RESPONSE_INVALID", 503);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: unknown): void {
  const queryError =
    error instanceof QueryApiError
      ? error
      : new QueryApiError("QUERY_REQUEST_FAILED", 500);
  if (queryError.statusCode === 401) response.setHeader("www-authenticate", "Bearer");
  if (queryError.statusCode === 503) {
    sendJson(
      response,
      queryError.statusCode,
      envelope(
        { errorCode: queryError.code },
        null,
        [EVIDENCE_V1_CONTRACT],
        [],
      ),
    );
    return;
  }
  sendJson(response, queryError.statusCode, { errorCode: queryError.code });
}
