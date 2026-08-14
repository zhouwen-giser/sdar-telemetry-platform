import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

import {assertSafeSqlIdentifier} from "../../telemetry-validation/src/index.js";

const REQUIRED_CLICKHOUSE_HOST = "192.168.1.7";

export interface ClickHouseConfig {
  url: string;
  user: string;
  passwordFile?: string;
  password?: string;
  caFile?: string;
  secure: boolean;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface ClickHouseQueryOptions {
  readonly?: 2;
  maxResultRows?: number;
}

export interface ClickHouseInsertOptions {
  deduplicationToken?: string;
}

interface ExecuteOptions extends ClickHouseQueryOptions {
  insertDeduplicationToken?: string;
  dateTimeInputFormat?: "best_effort";
}

export class ClickHouseClient {
  private readonly c: ClickHouseConfig;

  constructor(config: ClickHouseConfig) {
    this.c = validateConfig(config);
  }

  private async password(): Promise<string> {
    if (this.c.passwordFile === undefined) return this.c.password ?? "";
    try {
      const value = (await readFile(this.c.passwordFile, "utf8")).trim();
      if (value === "") throw new Error("empty credential");
      return value;
    } catch {
      throw clientError("CLICKHOUSE_CREDENTIAL_UNAVAILABLE", "ClickHouse credential is unavailable.");
    }
  }

  async query(sql: string, options: ClickHouseQueryOptions = {}): Promise<string> {
    return this.execute(sql, options);
  }

  async insert(
    table: string,
    rows: Record<string, unknown>[],
    options: ClickHouseInsertOptions = {},
  ): Promise<void> {
    assertSafeSqlIdentifier(table);
    if (rows.length === 0) return;
    const deduplicationToken =
      options.deduplicationToken ?? deterministicInsertDeduplicationToken(table, rows);
    assertDeduplicationToken(deduplicationToken);
    const body = rows.map((row) => JSON.stringify(row)).join("\n");
    await this.execute(`INSERT INTO ${table} FORMAT JSONEachRow\n${body}`, {
      insertDeduplicationToken: deduplicationToken,
      dateTimeInputFormat: "best_effort",
    });
  }

  private async execute(sql: string, options: ExecuteOptions): Promise<string> {
    if (sql.trim() === "") throw clientError("CLICKHOUSE_QUERY_INVALID", "ClickHouse query is empty.");
    validateQueryOptions(options);

    const endpoint = new URL(this.c.url);
    if (options.readonly !== undefined) endpoint.searchParams.set("readonly", String(options.readonly));
    if (options.maxResultRows !== undefined) {
      endpoint.searchParams.set("max_result_rows", String(options.maxResultRows));
      endpoint.searchParams.set("result_overflow_mode", "throw");
    }
    if (options.insertDeduplicationToken !== undefined) {
      endpoint.searchParams.set("insert_deduplication_token", options.insertDeduplicationToken);
    }
    if (options.dateTimeInputFormat !== undefined) {
      endpoint.searchParams.set("date_time_input_format", options.dateTimeInputFormat);
    }

    const credential = await this.password();
    const abortController = new AbortController();
    let timeoutKind: "connect" | "request" | undefined;
    const connectTimer = setTimeout(() => {
      timeoutKind = "connect";
      abortController.abort();
    }, this.c.connectTimeoutMs);
    const requestTimer = setTimeout(() => {
      timeoutKind = "request";
      abortController.abort();
    }, this.c.requestTimeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "text/plain",
            "x-clickhouse-user": this.c.user,
            "x-clickhouse-key": credential,
          },
          body: sql,
          signal: abortController.signal,
        });
      } catch {
        if (timeoutKind === "connect") {
          throw clientError(
            "CLICKHOUSE_CONNECT_TIMEOUT",
            "ClickHouse connection timed out before response headers were received.",
          );
        }
        if (timeoutKind === "request") {
          throw clientError("CLICKHOUSE_REQUEST_TIMEOUT", "ClickHouse request timed out.");
        }
        throw clientError("CLICKHOUSE_REQUEST_FAILED", "ClickHouse request failed.");
      } finally {
        clearTimeout(connectTimer);
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        if (timeoutKind === "request") {
          throw clientError("CLICKHOUSE_REQUEST_TIMEOUT", "ClickHouse request timed out.");
        }
        throw clientError("CLICKHOUSE_RESPONSE_INVALID", "ClickHouse response could not be read.");
      }
      if (!response.ok) {
        const detail = redactCredential(text, credential).slice(0, 4_096).trim();
        const suffix = detail === "" ? "" : `: ${detail}`;
        throw clientError(
          "CLICKHOUSE_RESPONSE_ERROR",
          `ClickHouse request failed with HTTP ${String(response.status)}${suffix}`,
        );
      }
      return text;
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(requestTimer);
    }
  }
}

export function configFromEnv(prefix = "CLICKHOUSE_"): ClickHouseConfig {
  const password = process.env[prefix + "PASSWORD"];
  const passwordFile = process.env[prefix + "PASSWORD_FILE"];
  if (password !== undefined && passwordFile !== undefined) {
    throw configurationError(
      "CLICKHOUSE_CREDENTIAL_AMBIGUOUS",
      "Configure exactly one of ClickHouse PASSWORD or PASSWORD_FILE.",
    );
  }

  return validateConfig({
    url: process.env[prefix + "URL"] ?? "",
    user: process.env[prefix + "USER"] ?? "",
    ...(password === undefined ? {} : {password}),
    ...(passwordFile === undefined ? {} : {passwordFile}),
    ...(process.env[prefix + "CA_FILE"] === undefined
      ? {}
      : {caFile: process.env[prefix + "CA_FILE"]}),
    secure: parseBoolean(process.env[prefix + "SECURE"], true),
    connectTimeoutMs: parsePositiveInteger(
      process.env[prefix + "CONNECT_TIMEOUT_MS"],
      5_000,
      "CONNECT_TIMEOUT_MS",
    ),
    requestTimeoutMs: parsePositiveInteger(
      process.env[prefix + "REQUEST_TIMEOUT_MS"],
      30_000,
      "REQUEST_TIMEOUT_MS",
    ),
  });
}

export function deterministicInsertDeduplicationToken(
  table: string,
  rows: readonly Record<string, unknown>[],
): string {
  assertSafeSqlIdentifier(table);
  const canonicalRows = rows.map((row) => canonicalJson(row)).join("\n");
  return createHash("sha256").update(`${table}\n${canonicalRows}`, "utf8").digest("hex");
}

function validateConfig(config: ClickHouseConfig): ClickHouseConfig {
  if (config.password !== undefined && config.passwordFile !== undefined) {
    throw configurationError(
      "CLICKHOUSE_CREDENTIAL_AMBIGUOUS",
      "Configure exactly one of ClickHouse PASSWORD or PASSWORD_FILE.",
    );
  }
  if (config.passwordFile !== undefined && config.passwordFile.trim() === "") {
    throw configurationError(
      "CLICKHOUSE_CREDENTIAL_FILE_INVALID",
      "ClickHouse PASSWORD_FILE must be non-empty.",
    );
  }
  if (config.caFile !== undefined) {
    throw configurationError(
      "CLICKHOUSE_CUSTOM_CA_UNSUPPORTED",
      "ClickHouse CA_FILE is not supported by the current HTTP transport; refusing to ignore it.",
    );
  }
  if (config.user.trim() === "" || /[\r\n]/u.test(config.user)) {
    throw configurationError("CLICKHOUSE_USER_INVALID", "ClickHouse user is invalid.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(config.url);
  } catch {
    throw configurationError("CLICKHOUSE_URL_INVALID", "ClickHouse URL is invalid.");
  }
  if (endpoint.username !== "" || endpoint.password !== "") {
    throw configurationError(
      "CLICKHOUSE_URL_CREDENTIALS_FORBIDDEN",
      "ClickHouse URL must not contain credentials.",
    );
  }
  if (endpoint.hostname !== REQUIRED_CLICKHOUSE_HOST) {
    throw configurationError(
      "CLICKHOUSE_HOST_FORBIDDEN",
      `ClickHouse hostname must be ${REQUIRED_CLICKHOUSE_HOST}.`,
    );
  }
  const expectedProtocol = config.secure ? "https:" : "http:";
  if (endpoint.protocol !== expectedProtocol) {
    throw configurationError(
      "CLICKHOUSE_SECURE_MISMATCH",
      `ClickHouse URL protocol must be ${expectedProtocol}`,
    );
  }
  if (!Number.isSafeInteger(config.connectTimeoutMs) || config.connectTimeoutMs <= 0) {
    throw configurationError(
      "CLICKHOUSE_CONNECT_TIMEOUT_INVALID",
      "ClickHouse connect timeout must be a positive integer.",
    );
  }
  if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) {
    throw configurationError(
      "CLICKHOUSE_REQUEST_TIMEOUT_INVALID",
      "ClickHouse request timeout must be a positive integer.",
    );
  }
  if (config.connectTimeoutMs > config.requestTimeoutMs) {
    throw configurationError(
      "CLICKHOUSE_TIMEOUT_ORDER_INVALID",
      "ClickHouse connect timeout must not exceed request timeout.",
    );
  }

  return Object.freeze({
    ...config,
    url: endpoint.toString(),
    user: config.user.trim(),
    ...(config.passwordFile === undefined ? {} : {passwordFile: config.passwordFile.trim()}),
  });
}

function validateQueryOptions(options: ExecuteOptions): void {
  if (options.readonly !== undefined && options.readonly !== 2) {
    throw clientError(
      "CLICKHOUSE_READONLY_INVALID",
      "Only ClickHouse readonly=2 is supported by this client option.",
    );
  }
  if (
    options.maxResultRows !== undefined &&
    (!Number.isSafeInteger(options.maxResultRows) || options.maxResultRows <= 0)
  ) {
    throw clientError(
      "CLICKHOUSE_MAX_RESULT_ROWS_INVALID",
      "ClickHouse maxResultRows must be a positive integer.",
    );
  }
}

function assertDeduplicationToken(value: string): void {
  if (value.trim() === "" || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw clientError(
      "CLICKHOUSE_DEDUPLICATION_TOKEN_INVALID",
      "ClickHouse deduplication token is invalid.",
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite values cannot be inserted.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Unsupported value cannot be inserted.");
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw configurationError(
    "CLICKHOUSE_BOOLEAN_INVALID",
    "ClickHouse boolean configuration must be true or false.",
  );
}

function parsePositiveInteger(value: string | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw configurationError(
      "CLICKHOUSE_TIMEOUT_INVALID",
      `ClickHouse ${field} must be a positive integer.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw configurationError(
      "CLICKHOUSE_TIMEOUT_INVALID",
      `ClickHouse ${field} must be a positive integer.`,
    );
  }
  return parsed;
}

function redactCredential(value: string, credential: string): string {
  let redacted = credential === "" ? value : value.split(credential).join("[REDACTED]");
  redacted = redacted.replace(
    /((?:password|passwd|x-clickhouse-key|authorization|bearer)\s*[:=]\s*)[^\s,;]+/giu,
    "$1[REDACTED]",
  );
  return redacted;
}

function configurationError(code: string, message: string): Error {
  return Object.assign(new Error(message), {code});
}

function clientError(code: string, message: string): Error {
  return Object.assign(new Error(message), {code});
}
