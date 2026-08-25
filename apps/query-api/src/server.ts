import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { ClickHouseQueryOptions } from "../../../packages/telemetry-clickhouse/src/index.js";
import type {
  TelemetryHttpAuthorizationPolicy,
} from "../../../packages/telemetry-config/src/index.js";
import { envelope } from "../../../packages/telemetry-query-model/src/index.js";
import {
  evaluateMcpProviderReadiness,
  type SmppEntityRelation,
  type SmppProviderFact,
} from "../../../packages/telemetry-smpp-consumer/src/index.js";

export const EVIDENCE_V1_CONTRACT = "sdar.evidence/v1";
export const DOMAIN_PROJECTION_V1_CONTRACT = "sdar.domain-projection/v1";
export const SMPP_PROVIDEROPS_V1_CONTRACT = "smpp.providerops/v1.1";
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
  readonly authorization: TelemetryHttpAuthorizationPolicy;
  readonly maxResultRows?: number;
  readonly onBackendError?: (diagnostic: QueryBackendDiagnostic) => void;
}

export interface QueryBackendDiagnostic {
  readonly event: "query_api.backend_error";
  readonly queryId: string;
  readonly sqlClass: string;
  readonly relation: string;
  readonly contract: string;
  readonly errorClass: "ClickHouseClientError" | "Error" | "TypeError";
  readonly causeCode?: string;
  readonly clickHouseCode?: number;
  readonly httpStatus?: number;
  readonly message: string;
}

type ResolvedAuthorizationPolicy =
  | Readonly<{ profile: "bearer"; expectedCredentialDigest: Buffer }>
  | Readonly<{ profile: "development-anonymous" }>;

export class QueryApiError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly coverageContract?: string,
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
  const authorization = resolveAuthorizationPolicy(dependencies.authorization);

  return http.createServer((request: IncomingMessage, response: ServerResponse) => {
    void handleRequest(
      request,
      response,
      dependencies.clickHouse,
      maxResultRows,
      authorization,
      dependencies.onBackendError,
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
  authorization: ResolvedAuthorizationPolicy,
  onBackendError?: (diagnostic: QueryBackendDiagnostic) => void,
): Promise<void> {
  const url = parseRequestUrl(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  assertAuthorization(request, authorization);
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    throw new QueryApiError("QUERY_METHOD_INVALID", 405);
  }

  const taskRoute = /^\/v1\/tasks\/([^/]+)\/(timeline|capability-chain)$/u.exec(url.pathname);
  let sql: string;
  let contract = EVIDENCE_V1_CONTRACT;
  let queryIdentity: Readonly<{queryId: string; sqlClass: string; relation: string}> = {
    queryId: "evidence-v1-query",
    sqlClass: "readonly-evidence-v1",
    relation: EVIDENCE_V1_CANONICAL_TABLE,
  };
  let smppEpisodeMode: "telemetry" | "readiness" | undefined;
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
    queryIdentity = domainProjectionQueryIdentity(url.pathname);
  } else if (isSmppRoute(url.pathname)) {
    sql = buildSmppProviderQuery(url.pathname, url.searchParams);
    contract = SMPP_PROVIDEROPS_V1_CONTRACT;
    queryIdentity = {
      queryId: "smpp-providerops-v1-query",
      sqlClass: "readonly-smpp-providerops-v1",
      relation: "sdar_core.providerops_projection",
    };
    if (/\/mcp-provider-telemetry$/u.test(url.pathname)) smppEpisodeMode = "telemetry";
    if (/\/mcp-provider-readiness$/u.test(url.pathname)) smppEpisodeMode = "readiness";
  } else {
    throw new QueryApiError("QUERY_ROUTE_NOT_FOUND", 404);
  }

  let raw: string;
  try {
    raw = await clickHouse.query(sql, { readonly: 2, maxResultRows });
  } catch (cause: unknown) {
    const diagnostic = backendDiagnostic(cause, contract, queryIdentity);
    try {
      onBackendError?.(diagnostic);
    } catch {
      // Observability is best-effort and must never alter the public query result.
    }
    throw new QueryApiError("QUERY_BACKEND_UNAVAILABLE", 503, contract);
  }
  let parsed: ReturnType<typeof parseClickHouseResult>;
  try {
    parsed = parseClickHouseResult(raw, contract === EVIDENCE_V1_CONTRACT);
  } catch (error: unknown) {
    if (error instanceof QueryApiError && error.statusCode === 503) {
      throw new QueryApiError(error.code, error.statusCode, contract);
    }
    throw error;
  }
  const {rows,watermark} = parsed;
  const data =
    smppEpisodeMode === undefined ? rows : assembleSmppEpisodeResult(rows, smppEpisodeMode);
  sendJson(
    response,
    200,
    routeEnvelope(
      data,
      watermark,
      contract,
      rows.length > 0,
    ),
  );
}

function routeEnvelope<T>(
  data: T,
  watermark: string | null,
  contract: string,
  hasRows: boolean,
): unknown {
  const document = envelope(data, watermark, [contract], hasRows ? [contract] : []);
  if (contract !== DOMAIN_PROJECTION_V1_CONTRACT) return document;
  return {
    ...document,
    sourceCoverage: {
      expected: [DOMAIN_PROJECTION_V1_CONTRACT],
      actual: [DOMAIN_PROJECTION_V1_CONTRACT],
    },
  };
}

function domainProjectionQueryIdentity(pathname: string): Readonly<{
  queryId: string;
  sqlClass: string;
  relation: string;
}> {
  if (/^\/v1\/domain-projections(?:\/[^/]+)?$/u.test(pathname)) {
    return {
      queryId: "domain-projection-health",
      sqlClass: "readonly-domain-projection-health",
      relation: "sdar_meta.v_domain_projection_health",
    };
  }
  if (pathname.startsWith("/v1/domain-projection-sets")) {
    return {
      queryId: "domain-projection-set-readiness",
      sqlClass: "readonly-domain-projection-set-readiness",
      relation: "sdar_meta.v_domain_projection_set_readiness",
    };
  }
  return {
    queryId: "domain-projection-detail",
    sqlClass: "readonly-domain-projection-detail",
    relation: "sdar.domain-projection/allowlisted",
  };
}

function backendDiagnostic(
  cause: unknown,
  contract: string,
  identity: Readonly<{queryId: string; sqlClass: string; relation: string}>,
): QueryBackendDiagnostic {
  const causeCode = safeBackendCauseCode(cause);
  const httpStatus = safeNumericMatch(cause, /\bHTTP\s+([1-5][0-9]{2})\b/u);
  const clickHouseCode = safeNumericMatch(cause, /\bCode:\s*([0-9]{1,6})\b/u);
  const errorClass = causeCode === undefined
    ? cause instanceof TypeError
      ? "TypeError"
      : "Error"
    : "ClickHouseClientError";
  const message = httpStatus === undefined
    ? "ClickHouse backend query failed; details redacted."
    : clickHouseCode === undefined
      ? `ClickHouse backend query failed with HTTP status ${httpStatus}; response details redacted.`
      : `ClickHouse backend query failed with HTTP status ${httpStatus} and ClickHouse code ${clickHouseCode}; response details redacted.`;
  return {
    event: "query_api.backend_error",
    ...identity,
    contract,
    errorClass,
    ...(causeCode === undefined ? {} : {causeCode}),
    ...(clickHouseCode === undefined ? {} : {clickHouseCode}),
    ...(httpStatus === undefined ? {} : {httpStatus}),
    message,
  };
}

function safeBackendCauseCode(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== "object") return undefined;
  const value = (cause as {code?: unknown}).code;
  return typeof value === "string" && /^CLICKHOUSE_[A-Z_]{1,48}$/u.test(value) ? value : undefined;
}

function safeNumericMatch(cause: unknown, pattern: RegExp): number | undefined {
  if (!(cause instanceof Error)) return undefined;
  const matched = pattern.exec(cause.message)?.[1];
  if (matched === undefined) return undefined;
  const value = Number(matched);
  return Number.isSafeInteger(value) ? value : undefined;
}

function isSmppRoute(pathname: string): boolean {
  return pathname.startsWith("/v1/smpp/") ||
    /^\/v1\/episodes\/[^/]+\/mcp-provider-(telemetry|readiness)$/u.test(pathname);
}

export function buildSmppProviderQuery(pathname: string, parameters = new URLSearchParams()): string {
  let match: RegExpExecArray | null;
  if (pathname === "/v1/smpp/provider-facts") {
    const filters = smppFilters(parameters, {
      smppSourceId: "smpp_source_id", providerId: "provider_id", externalTaskId: "external_task_id",
      resourceId: "resource_id", externalExecutionId: "external_execution_id",
    });
    return smppQuery("sdar_core.external_provider_fact FINAL", filters, "occurred_at, fact_id", "projected_at");
  }
  match = /^\/v1\/smpp\/provider-facts\/([^/]+)$/u.exec(pathname);
  if (match !== null) {
    assertNoParameters(parameters);
    return smppQuery("sdar_core.external_provider_fact FINAL", `fact_id = toUUID(${clickHouseStringExpression(decodeQueryValue(match[1]!))})`, "occurred_at, fact_id", "projected_at");
  }
  if (pathname === "/v1/smpp/relations") {
    const filters = smppFilters(parameters, {
      smppSourceId: "smpp_source_id", relationType: "relation_type",
      sourceEntityType: "source_entity_type", sourceEntityId: "source_entity_id",
      targetEntityType: "target_entity_type", targetEntityId: "target_entity_id",
    });
    return smppQuery("sdar_core.external_entity_relation_fact FINAL", filters, "valid_from, relation_id", "projected_at");
  }
  match = /^\/v1\/smpp\/tasks\/([^/]+)\/timeline$/u.exec(pathname);
  if (match !== null) return fixedSmppView(parameters, "sdar_core.v_smpp_provider_task_timeline", "external_task_id", match[1]!, "occurred_at, projected_at", "projected_at");
  match = /^\/v1\/smpp\/resources\/([^/]+)\/(state|health)$/u.exec(pathname);
  if (match !== null) return fixedSmppView(parameters, match[2] === "state" ? "sdar_core.v_smpp_resource_current_state" : "sdar_core.v_smpp_resource_current_health", "resource_id", match[1]!, "smpp_source_id, provider_id, resource_id", match[2] === "state" ? "last_projected_at" : "last_projected_at");
  match = /^\/v1\/smpp\/executions\/([^/]+)\/progress$/u.exec(pathname);
  if (match !== null) return fixedSmppView(parameters, "sdar_core.v_smpp_execution_latest_progress", "external_execution_id", match[1]!, "smpp_source_id, provider_id, external_execution_id", "last_projected_at");
  if (pathname === "/v1/smpp/reconciliation") {
    assertNoParameters(parameters);
    return smppQuery("sdar_core.v_sdar_smpp_task_reconciliation", "", "tenant_id, project_id, binding_id", "last_provider_fact_time");
  }
  match = /^\/v1\/episodes\/([^/]+)\/mcp-provider-(telemetry|readiness)$/u.exec(pathname);
  if (match !== null) {
    assertNoParameters(parameters);
    return smppEpisodeQuery(decodeQueryValue(match[1]!));
  }
  if (pathname === "/v1/smpp/projection-status") {
    assertNoParameters(parameters);
    return `SELECT
  'smpp_provider_ops_to_sdar_core' AS projection_id,
  1 AS projection_version,
  count() AS provider_fact_count,
  uniqExact(smpp_source_id) AS source_count,
  max(projected_at) AS last_projected_at,
  toUnixTimestamp64Milli(max(projected_at)) AS ${WATERMARK_COLUMN},
  'producer_owned_independent_checkpoint' AS checkpoint_authority,
  '1.5.1-rc.2' AS clickhouse_release,
  'sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8' AS schema_contract_hash
FROM sdar_core.external_provider_fact FINAL
FORMAT JSON`;
  }
  throw new QueryApiError("QUERY_ROUTE_NOT_FOUND", 404);
}

function fixedSmppView(parameters: URLSearchParams, table: string, column: string, rawValue: string, order: string, watermark: string): string {
  assertNoParameters(parameters);
  return smppQuery(table, `${column} = ${clickHouseStringExpression(decodeQueryValue(rawValue))}`, order, watermark);
}

function smppFilters(parameters: URLSearchParams, fields: Readonly<Record<string, string>>): string {
  const filters: string[] = [];
  for (const key of parameters.keys()) {
    const column = fields[key];
    if (column === undefined || parameters.getAll(key).length !== 1) throw new QueryApiError("QUERY_ARGUMENT_INVALID", 400);
    filters.push(`${column} = ${clickHouseStringExpression(assertQueryValue(parameters.get(key)!))}`);
  }
  return filters.join("\n  AND ");
}

function assertNoParameters(parameters: URLSearchParams): void {
  if ([...parameters.keys()].length !== 0) throw new QueryApiError("QUERY_ARGUMENT_INVALID", 400);
}

function smppQuery(table: string, predicate: string, order: string, watermarkColumn: string): string {
  return `SELECT
  *,
  toUnixTimestamp64Milli(max(${watermarkColumn}) OVER ()) AS ${WATERMARK_COLUMN}
FROM ${table}${predicate === "" ? "" : `\nWHERE ${predicate}`}
ORDER BY ${order}
FORMAT JSON`;
}

function smppEpisodeQuery(episodeId: string): string {
  const value = clickHouseStringExpression(episodeId);
  return `WITH episode_bindings AS
(
  SELECT DISTINCT arrayJoin(arrayFilter(value -> value != '', [a2a_task_id, remote_task_id])) AS task_id
  FROM sdar_core.remote_task_binding FINAL
  WHERE toString(episode_id) = ${value}
), episode_relations AS
(
  SELECT r.*
  FROM sdar_core.external_entity_relation_fact AS r FINAL
  WHERE (r.source_entity_type = 'task' AND r.source_entity_id IN (SELECT task_id FROM episode_bindings))
     OR (r.target_entity_type = 'task' AND r.target_entity_id IN (SELECT task_id FROM episode_bindings))
)
SELECT
  p.*,
  r.relation_id AS __relation_id,
  r.relation_type AS __relation_type,
  r.source_entity_type AS __source_entity_type,
  r.source_entity_id AS __source_entity_id,
  r.target_entity_type AS __target_entity_type,
  r.target_entity_id AS __target_entity_id,
  r.evidence_fact_ids AS __evidence_fact_ids,
  r.source_record_hash AS __relation_source_hash,
  r.projection_id AS __relation_projection_id,
  r.projection_version AS __relation_projection_version,
  toUnixTimestamp64Milli(max(p.projected_at) OVER ()) AS ${WATERMARK_COLUMN}
FROM episode_relations AS r
ARRAY JOIN r.evidence_fact_ids AS evidence_fact_id
INNER JOIN sdar_core.external_provider_fact AS p FINAL
  ON p.tenant_id = r.tenant_id AND p.project_id = r.project_id
 AND p.environment = r.environment AND p.smpp_source_id = r.smpp_source_id
 AND p.fact_id = evidence_fact_id
ORDER BY p.occurred_at, p.fact_id, r.relation_id
FORMAT JSON`;
}

function assembleSmppEpisodeResult(rows: Record<string, unknown>[], mode: "telemetry" | "readiness"): unknown {
  const facts = new Map<string, SmppProviderFact>();
  const relations = new Map<string, SmppEntityRelation>();
  for (const row of rows) {
    const factId = String(row["fact_id"] ?? "");
    if (factId !== "") facts.set(factId, row as unknown as SmppProviderFact);
    const relationId = String(row["__relation_id"] ?? "");
    if (relationId !== "") {
      relations.set(relationId, {
        relation_id: relationId,
        relation_type: String(row["__relation_type"] ?? ""),
        source_entity_type: String(row["__source_entity_type"] ?? ""),
        source_entity_id: String(row["__source_entity_id"] ?? ""),
        target_entity_type: String(row["__target_entity_type"] ?? ""),
        target_entity_id: String(row["__target_entity_id"] ?? ""),
        evidence_fact_ids: Array.isArray(row["__evidence_fact_ids"]) ? row["__evidence_fact_ids"].map(String) : [],
        source_record_hash: String(row["__relation_source_hash"] ?? ""),
        projection_id: String(row["__relation_projection_id"] ?? ""),
        projection_version: Number(row["__relation_projection_version"] ?? 0),
      });
    }
  }
  const providerFacts = [...facts.values()];
  const entityRelations = [...relations.values()];
  const readiness = evaluateMcpProviderReadiness({required: true, facts: providerFacts, relations: entityRelations});
  return mode === "readiness" ? readiness : {providerFacts, relations: entityRelations, readiness};
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

function assertAuthorization(
  request: IncomingMessage,
  authorization: ResolvedAuthorizationPolicy,
): void {
  if (authorization.profile === "development-anonymous") return;
  const header = request.headers.authorization;
  const matched = typeof header === "string" ? /^Bearer ([^\s]+)$/u.exec(header) : null;
  const actualDigest = credentialDigest(matched?.[1] ?? "");
  if (!timingSafeEqual(actualDigest, authorization.expectedCredentialDigest)) {
    throw new QueryApiError("QUERY_CREDENTIAL_INVALID", 401);
  }
}

function credentialDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function resolveAuthorizationPolicy(
  authorization: TelemetryHttpAuthorizationPolicy,
): ResolvedAuthorizationPolicy {
  if (authorization.profile === "development-anonymous") {
    return Object.freeze({ profile: "development-anonymous" });
  }
  if (
    authorization.bearerCredential.length < 16 ||
    authorization.bearerCredential.length > 4_096
  ) {
    throw new QueryApiError("QUERY_CREDENTIAL_CONFIGURATION_INVALID", 500);
  }
  return Object.freeze({
    profile: "bearer",
    expectedCredentialDigest: credentialDigest(authorization.bearerCredential),
  });
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
      routeEnvelope(
        { errorCode: queryError.code },
        null,
        queryError.coverageContract ?? EVIDENCE_V1_CONTRACT,
        false,
      ),
    );
    return;
  }
  sendJson(response, queryError.statusCode, { errorCode: queryError.code });
}
