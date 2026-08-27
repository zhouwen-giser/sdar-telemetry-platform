/** Read-only federation. The caller controls filters, never the upstream host, path or SQL. */
export class DiagnosticFederationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

const common = [
  "limit",
  "offset",
  "from",
  "to",
  "serviceName",
  "runtimeInstanceId",
  "providerId",
  "deploymentId",
  "collectionProtocol",
];
const metricTypes = [
  "gauge",
  "sum",
  "histogram",
  "exponential_histogram",
  "summary",
];
export function diagnosticPath(url: URL): string | undefined {
  const metrics = url.pathname === "/v1/metrics";
  const trace = /^\/v1\/traces\/([a-f0-9]{32})$/u.exec(url.pathname);
  if (!metrics && url.pathname !== "/v1/traces" && trace === null) {
    if (url.pathname.startsWith("/v1/traces/")) invalid();
    return undefined;
  }
  const allowed = new Set([
    ...common,
    ...(metrics ? ["type", "metricName"] : ["spanName", "traceId"]),
  ]);
  for (const [key, value] of url.searchParams) {
    if (
      !allowed.has(key) ||
      url.searchParams.getAll(key).length !== 1 ||
      value.length === 0 ||
      value.length > 512
    )
      invalid();
  }
  for (const [key, min, max] of [
    ["limit", 1, 1000],
    ["offset", 0, 100000],
  ] as const) {
    const value = url.searchParams.get(key);
    if (
      value !== null &&
      (!/^\d+$/u.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < min ||
        Number(value) > max)
    )
      invalid();
  }
  if (metrics && !metricTypes.includes(url.searchParams.get("type") ?? "gauge"))
    invalid();
  const traceId = url.searchParams.get("traceId");
  if (
    traceId !== null &&
    (!/^[a-f0-9]{32}$/u.test(traceId) ||
      (trace !== null && traceId !== trace[1]))
  )
    invalid();
  for (const key of ["from", "to"]) {
    const value = url.searchParams.get(key);
    if (value !== null && !Number.isFinite(Date.parse(value))) invalid();
  }
  if (
    url.searchParams.has("from") &&
    url.searchParams.has("to") &&
    Date.parse(url.searchParams.get("from")!) >
      Date.parse(url.searchParams.get("to")!)
  )
    invalid();
  return `/api${url.pathname}${url.search}`;
}

export class DiagnosticFederation {
  private readonly origin: string;
  constructor(
    endpoint: string,
    private readonly request: typeof fetch = fetch,
  ) {
    const url = new URL(endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new DiagnosticFederationError(
        "DIAGNOSTIC_UPSTREAM_CONFIGURATION_INVALID",
        500,
      );
    this.origin = url.origin;
  }
  async query(url: URL): Promise<Readonly<Record<string, unknown>>> {
    const path = diagnosticPath(url);
    if (path === undefined) invalid();
    try {
      const response = await this.request(this.origin + path, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (
        response.status !== 200 ||
        !response.headers.get("content-type")?.includes("application/json") ||
        response.body === null
      )
        throw new Error("UPSTREAM_RESPONSE_INVALID");
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          size += result.value.byteLength;
          if (size > 4 * 1024 * 1024)
            throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
          chunks.push(result.value);
        }
      } finally {
        await reader.cancel();
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !isObject(value) ||
        !Array.isArray(value["data"]) ||
        value["data"].length > Number(url.searchParams.get("limit") ?? 100)
      )
        throw new Error("UPSTREAM_RESPONSE_INVALID");
      return Object.freeze({
        ...value,
        federation: {
          source: "smpp-telemetry-platform",
          storage: "telemetry_observability",
          readOnly: true,
        },
      });
    } catch {
      throw new DiagnosticFederationError(
        "DIAGNOSTIC_UPSTREAM_UNAVAILABLE",
        503,
      );
    }
  }
}
function invalid(): never {
  throw new DiagnosticFederationError("DIAGNOSTIC_ARGUMENT_INVALID", 400);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
