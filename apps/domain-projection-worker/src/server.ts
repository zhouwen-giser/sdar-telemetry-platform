import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export type DomainProjectionMetric = Readonly<{
  projectionId: string;
  lifecycle?: string;
  dataStatus?: string;
  revision?: number;
  lastErrorCode?: string | null;
  pendingRecords?: number | null;
  checkpoint?: unknown;
  input: number;
  produced: number;
  skipped: number;
  failed: number;
  duplicate: number;
  checkpointWatermarkMs: number;
  lagMs: number | null;
  openBlockingDeadLetters: number | null;
  schemaDrift: boolean;
  lastSuccessfulRunMs: number | null;
  leaseOwner: string;
  leaseExpiryMs: number;
  readySeals: number | null;
  expectedSeals: number | null;
}>;

export type DomainProjectionRuntimeSnapshot = Readonly<{
  scope?: Readonly<{ tenantId: string; projectId: string }>;
  sources?: readonly Readonly<{
    producerId: string;
    application: string;
    contractVersion: string;
  }>[];
  actions?: readonly Readonly<{ actionId: string; status: string }>[];
  clickHouseReady: boolean;
  controlPostgresReady: boolean;
  schemaContractReady: boolean;
  projections: readonly DomainProjectionMetric[];
}>;

export interface DomainProjectionRuntimeStatusPort {
  snapshot(): Promise<DomainProjectionRuntimeSnapshot>;
}

export function createDomainProjectionWorkerApi(
  port: DomainProjectionRuntimeStatusPort,
): Server {
  return http.createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      void (async () => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        if (request.url === "/health") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ status: "ok" }));
          return;
        }
        const snapshot = await port.snapshot();
        if (request.url === "/status") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(snapshot));
          return;
        }
        if (request.url === "/ready") {
          const ready = domainProjectionRuntimeReady(snapshot);
          response.writeHead(ready ? 200 : 503, {
            "content-type": "application/json",
          });
          response.end(
            JSON.stringify({ status: ready ? "ready" : "not_ready" }),
          );
          return;
        }
        if (request.url === "/metrics") {
          response.writeHead(200, {
            "content-type": "text/plain; version=0.0.4; charset=utf-8",
          });
          response.end(renderDomainProjectionMetrics(snapshot));
          return;
        }
        response.writeHead(404, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ errorCode: "DOMAIN_WORKER_ROUTE_NOT_FOUND" }),
        );
      })().catch(() => {
        if (!response.headersSent)
          response.writeHead(503, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ errorCode: "DOMAIN_WORKER_DEPENDENCY_UNAVAILABLE" }),
        );
      });
    },
  );
}

export function domainProjectionRuntimeReady(
  snapshot: DomainProjectionRuntimeSnapshot,
): boolean {
  return (
    snapshot.clickHouseReady &&
    snapshot.controlPostgresReady &&
    snapshot.schemaContractReady &&
    snapshot.projections.every(
      (p) =>
        p.lifecycle === undefined ||
        (p.lifecycle === "ACTIVE" && !p.lastErrorCode),
    )
  );
}

export function renderDomainProjectionMetrics(
  snapshot: DomainProjectionRuntimeSnapshot,
): string {
  const lines = [
    `sdar_domain_dependency_ready{dependency="clickhouse"} ${snapshot.clickHouseReady ? 1 : 0}`,
    `sdar_domain_dependency_ready{dependency="control_postgres"} ${snapshot.controlPostgresReady ? 1 : 0}`,
    `sdar_domain_dependency_ready{dependency="schema_contract"} ${snapshot.schemaContractReady ? 1 : 0}`,
  ];
  for (const metric of [...snapshot.projections].sort((left, right) =>
    left.projectionId.localeCompare(right.projectionId),
  )) {
    const label = `projection_id="${escapeLabel(metric.projectionId)}"`;
    for (const [name, value] of Object.entries({
      input_total: metric.input,
      produced_total: metric.produced,
      skipped_total: metric.skipped,
      failed_total: metric.failed,
      duplicate_total: metric.duplicate,
      checkpoint_watermark_ms: metric.checkpointWatermarkMs,
      lag_ms: metric.lagMs,
      open_blocking_dlq: metric.openBlockingDeadLetters,
      schema_drift: metric.schemaDrift ? 1 : 0,
      last_successful_run_ms: metric.lastSuccessfulRunMs,
      lease_expiry_ms: metric.leaseExpiryMs,
      ready_seals: metric.readySeals,
      expected_seals: metric.expectedSeals,
    })) {
      // Unknown observations are absent from Prometheus, never fabricated zeroes.
      if (value === null) continue;
      assertMetric(value);
      lines.push(`sdar_domain_projection_${name}{${label}} ${String(value)}`);
    }
    lines.push(
      `sdar_domain_projection_lease_info{${label},lease_owner="${escapeLabel(metric.leaseOwner)}"} 1`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function assertMetric(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw Object.assign(new Error("DOMAIN_WORKER_METRIC_INVALID"), {
      code: "DOMAIN_WORKER_METRIC_INVALID",
    });
  }
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}
