export type DomainProjectionMode = "disabled" | "shadow" | "dry_run" | "active";

export type TelemetryAuthProfile = "bearer" | "development-anonymous";

export type TelemetryHttpAuthorizationPolicy =
  | Readonly<{ profile: "bearer"; bearerCredential: string }>
  | Readonly<{ profile: "development-anonymous" }>;

const HTTP_BEARER_ENVIRONMENT_FIELDS = [
  "EVIDENCE_INGEST_BEARER_TOKEN",
  "EVIDENCE_INGEST_BEARER_TOKEN_FILE",
  "DOMAIN_SOURCE_INGEST_BEARER_TOKEN",
  "DOMAIN_SOURCE_INGEST_BEARER_TOKEN_FILE",
  "QUERY_API_BEARER_TOKEN",
  "QUERY_API_BEARER_TOKEN_FILE",
] as const;

export interface PlatformConfig {
  authProfile: TelemetryAuthProfile;
  walDir: string;
  walHighWaterBytes: number;
  gatewayPort: number;
  queryPort: number;
  adminPort: number;
  workerIntervalMs: number;
  domainProjection: Readonly<{
    schemaRoot: string;
    enabled: boolean;
    maxMode: DomainProjectionMode;
    batchSize: number;
    pollIntervalMs: number;
    lookbackMs: number;
    leaseMs: number;
    heartbeatMs: number;
    workerId: string;
    healthPort: number;
    environmentMapVersion: "identity/1";
  }>;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const authProfile = enumeration(
    environment["SDAR_TELEMETRY_AUTH_PROFILE"],
    "bearer",
    ["bearer", "development-anonymous"] as const,
    "SDAR_TELEMETRY_AUTH_PROFILE_INVALID",
  );
  assertAuthProfileEnvironment(authProfile, environment);
  const leaseMs = integer(environment, "DOMAIN_PROJECTION_LEASE_MS", 30_000, 1_000, 300_000);
  const heartbeatMs = integer(
    environment,
    "DOMAIN_PROJECTION_HEARTBEAT_MS",
    10_000,
    100,
    299_999,
  );
  if (heartbeatMs >= leaseMs) throw configError("DOMAIN_PROJECTION_HEARTBEAT_RANGE_INVALID");
  return Object.freeze({
    authProfile,
    walDir: nonEmpty(environment["WAL_DIR"] ?? "./runtime/wal", "WAL_DIR_INVALID"),
    walHighWaterBytes: integer(
      environment,
      "WAL_HIGH_WATER_BYTES",
      536_870_912,
      1_048_576,
      Number.MAX_SAFE_INTEGER,
    ),
    gatewayPort: integer(environment, "GATEWAY_PORT", 8080, 1, 65_535),
    queryPort: integer(environment, "QUERY_PORT", 8081, 1, 65_535),
    adminPort: integer(environment, "ADMIN_PORT", 8082, 1, 65_535),
    workerIntervalMs: integer(environment, "WORKER_INTERVAL_MS", 1_000, 10, 300_000),
    domainProjection: Object.freeze({
      schemaRoot: nonEmpty(
        environment["DOMAIN_SOURCE_SCHEMA_ROOT"] ??
          environment["SDAR_DOMAIN_SOURCE_SCHEMA_ROOT"] ??
          "integrations/domain-source/contracts/v1/schemas",
        "DOMAIN_SOURCE_SCHEMA_ROOT_INVALID",
      ),
      enabled: boolean(environment, "DOMAIN_PROJECTION_ENABLED", true),
      maxMode: enumeration(
        environment["DOMAIN_PROJECTION_MAX_MODE"],
        "shadow",
        ["disabled", "shadow", "dry_run", "active"] as const,
        "DOMAIN_PROJECTION_MAX_MODE_INVALID",
      ),
      batchSize: integer(environment, "DOMAIN_PROJECTION_BATCH_SIZE", 500, 1, 1_000),
      pollIntervalMs: integer(
        environment,
        "DOMAIN_PROJECTION_POLL_INTERVAL_MS",
        1_000,
        10,
        300_000,
      ),
      lookbackMs: integer(
        environment,
        "DOMAIN_PROJECTION_LOOKBACK_MS",
        1_800_000,
        1_000,
        86_400_000,
      ),
      leaseMs,
      heartbeatMs,
      workerId: nonEmpty(
        environment["DOMAIN_PROJECTION_WORKER_ID"] ?? `domain-projection-worker:${String(process.pid)}`,
        "DOMAIN_PROJECTION_WORKER_ID_INVALID",
      ),
      healthPort: integer(environment, "DOMAIN_PROJECTION_HEALTH_PORT", 8083, 1, 65_535),
      environmentMapVersion: enumeration(
        environment["DOMAIN_ENVIRONMENT_MAP_VERSION"],
        "identity/1",
        ["identity/1"] as const,
        "DOMAIN_ENVIRONMENT_MAP_VERSION_INVALID",
      ),
    }),
  });
}

function assertAuthProfileEnvironment(
  authProfile: TelemetryAuthProfile,
  environment: NodeJS.ProcessEnv,
): void {
  if (authProfile !== "development-anonymous") return;
  if (environment["NODE_ENV"] !== "development") {
    throw configError("SDAR_TELEMETRY_DEVELOPMENT_ANONYMOUS_ENVIRONMENT_INVALID");
  }
  if (HTTP_BEARER_ENVIRONMENT_FIELDS.some((field) => environment[field] !== undefined)) {
    throw configError("SDAR_TELEMETRY_DEVELOPMENT_ANONYMOUS_CREDENTIAL_CONFIGURED");
  }
}

function integer(
  environment: NodeJS.ProcessEnv,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[field];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[0-9]+$/u.test(raw)) throw configError(`${field}_INVALID`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw configError(`${field}_INVALID`);
  }
  return value;
}

function boolean(
  environment: NodeJS.ProcessEnv,
  field: string,
  fallback: boolean,
): boolean {
  const value = environment[field];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw configError(`${field}_INVALID`);
}

function enumeration<const T extends string>(
  value: string | undefined,
  fallback: T,
  allowed: readonly T[],
  code: string,
): T {
  if (value === undefined || value === "") return fallback;
  if (!allowed.includes(value as T)) throw configError(code);
  return value as T;
}

function nonEmpty(value: string, code: string): string {
  if (value.trim() === "" || /[\r\n]/u.test(value)) throw configError(code);
  return value;
}

function configError(code: string): Error & {code: string} {
  return Object.assign(new Error(code), {code});
}
