import test from "node:test";
import assert from "node:assert/strict";

import {
  ClickHouseClient,
  configFromEnv,
  deterministicInsertDeduplicationToken,
  type ClickHouseConfig,
} from "../../packages/telemetry-clickhouse/src/index.js";

const baseConfig = (password = "test-clickhouse-password"): ClickHouseConfig => ({
  url: "https://192.168.1.7:8443",
  user: "telemetry-test",
  password,
  secure: true,
  connectTimeoutMs: 500,
  requestTimeoutMs: 2_000,
});

test("configFromEnv accepts a direct password and rejects ambiguous credentials", () => {
  withEnvironment(
    {
      SDAR_CLICKHOUSE_ENDPOINT_POLICY: undefined,
      NODE_ENV: undefined,
      TEST_CLICKHOUSE_URL: "https://192.168.1.7:8443",
      TEST_CLICKHOUSE_USER: "telemetry-reader",
      TEST_CLICKHOUSE_PASSWORD: "direct-password",
      TEST_CLICKHOUSE_SECURE: "true",
      TEST_CLICKHOUSE_CONNECT_TIMEOUT_MS: "750",
      TEST_CLICKHOUSE_REQUEST_TIMEOUT_MS: "2500",
    },
    () => {
      const config = configFromEnv("TEST_CLICKHOUSE_");
      assert.equal(config.password, "direct-password");
      assert.equal(config.passwordFile, undefined);
      assert.equal(config.connectTimeoutMs, 750);
      assert.equal(config.requestTimeoutMs, 2_500);
    },
  );

  withEnvironment(
    {
      SDAR_CLICKHOUSE_ENDPOINT_POLICY: undefined,
      NODE_ENV: undefined,
      TEST_CLICKHOUSE_URL: "https://192.168.1.7:8443",
      TEST_CLICKHOUSE_USER: "telemetry-reader",
      TEST_CLICKHOUSE_PASSWORD: "direct-password",
      TEST_CLICKHOUSE_PASSWORD_FILE: "/run/secrets/clickhouse",
      TEST_CLICKHOUSE_SECURE: "true",
    },
    () => assert.throws(() => configFromEnv("TEST_CLICKHOUSE_"), /exactly one/u),
  );
});

test("writer and reader configurations reject every non-approved host", () => {
  withEnvironment(
    {
      SDAR_CLICKHOUSE_ENDPOINT_POLICY: undefined,
      NODE_ENV: undefined,
      TEST_WRITER_URL: "https://127.0.0.1:8443",
      TEST_WRITER_USER: "writer",
      TEST_WRITER_PASSWORD: "password",
      TEST_WRITER_SECURE: "true",
    },
    () => assert.throws(() => configFromEnv("TEST_WRITER_"), /192\.168\.1\.7/u),
  );
  withEnvironment(
    {
      SDAR_CLICKHOUSE_ENDPOINT_POLICY: undefined,
      NODE_ENV: undefined,
      TEST_READER_URL: "https://clickhouse.example:8443",
      TEST_READER_USER: "reader",
      TEST_READER_PASSWORD: "password",
      TEST_READER_SECURE: "true",
    },
    () => assert.throws(() => configFromEnv("TEST_READER_"), /192\.168\.1\.7/u),
  );
});

test("endpoint policy defaults to production-fixed and does not infer development authority", () => {
  for (const selector of [undefined, "production-fixed"] as const) {
    withEnvironment(
      {
        SDAR_CLICKHOUSE_ENDPOINT_POLICY: selector,
        NODE_ENV: "development",
        TEST_CLICKHOUSE_URL: "https://192.168.1.7:8443",
        TEST_CLICKHOUSE_USER: "reader",
        TEST_CLICKHOUSE_PASSWORD: "password",
        TEST_CLICKHOUSE_SECURE: "true",
      },
      () => {
        const config = configFromEnv("TEST_CLICKHOUSE_");
        assert.equal(config.endpointPolicy, "production-fixed");
        assert.equal(config.url, "https://192.168.1.7:8443/");
      },
    );

    withEnvironment(
      {
        SDAR_CLICKHOUSE_ENDPOINT_POLICY: selector,
        NODE_ENV: "development",
        TEST_CLICKHOUSE_URL: "http://clickhouse:8123",
        TEST_CLICKHOUSE_USER: "reader",
        TEST_CLICKHOUSE_PASSWORD: "password",
        TEST_CLICKHOUSE_SECURE: "false",
      },
      () =>
        assert.throws(
          () => configFromEnv("TEST_CLICKHOUSE_"),
          hasErrorCode("CLICKHOUSE_HOST_FORBIDDEN"),
        ),
    );
  }
});

test("writer and reader accept only the explicit development Compose endpoint", () => {
  for (const prefix of ["TEST_WRITER_", "TEST_READER_"]) {
    withEnvironment(
      {
        SDAR_CLICKHOUSE_ENDPOINT_POLICY: "development-compose",
        NODE_ENV: "development",
        [prefix + "URL"]: "http://clickhouse:8123",
        [prefix + "USER"]: "telemetry",
        [prefix + "PASSWORD"]: "password",
        [prefix + "SECURE"]: "false",
      },
      () => {
        const config = configFromEnv(prefix);
        assert.equal(config.endpointPolicy, "development-compose");
        assert.equal(config.url, "http://clickhouse:8123/");
        assert.equal(config.secure, false);
      },
    );
  }
});

test("endpoint policy selector rejects empty, whitespace, unknown, and case variants", () => {
  for (const selector of ["", " ", "unknown", "Development-compose", "PRODUCTION-FIXED"]) {
    withEnvironment(
      {
        SDAR_CLICKHOUSE_ENDPOINT_POLICY: selector,
        NODE_ENV: "development",
        TEST_CLICKHOUSE_URL: "https://192.168.1.7:8443",
        TEST_CLICKHOUSE_USER: "reader",
        TEST_CLICKHOUSE_PASSWORD: "password",
        TEST_CLICKHOUSE_SECURE: "true",
      },
      () =>
        assert.throws(
          () => configFromEnv("TEST_CLICKHOUSE_"),
          hasErrorCode("CLICKHOUSE_ENDPOINT_POLICY_INVALID"),
        ),
    );
  }
});

test("development Compose policy requires exact NODE_ENV=development", () => {
  for (const nodeEnv of [undefined, "", "production", "test", "Development"]) {
    withEnvironment(
      {
        SDAR_CLICKHOUSE_ENDPOINT_POLICY: "development-compose",
        NODE_ENV: nodeEnv,
        TEST_CLICKHOUSE_URL: "http://clickhouse:8123",
        TEST_CLICKHOUSE_USER: "reader",
        TEST_CLICKHOUSE_PASSWORD: "password",
        TEST_CLICKHOUSE_SECURE: "false",
      },
      () =>
        assert.throws(
          () => configFromEnv("TEST_CLICKHOUSE_"),
          hasErrorCode("CLICKHOUSE_DEVELOPMENT_ENVIRONMENT_REQUIRED"),
        ),
    );
  }
});

test("development Compose policy rejects every drift from the exact endpoint tuple", () => {
  const rejected = [
    {url: "http://clickhouse", secure: "false"},
    {url: "http://clickhouse:8124", secure: "false"},
    {url: "https://clickhouse:8123", secure: "true"},
    {url: "http://192.168.1.7:8123", secure: "false"},
    {url: "http://127.0.0.1:8123", secure: "false"},
    {url: "http://localhost:8123", secure: "false"},
    {url: "http://clickhouse.example:8123", secure: "false"},
    {url: "http://clickhouse.:8123", secure: "false"},
    {url: "http://arbitrary:8123", secure: "false"},
    {url: "http://user:password@clickhouse:8123", secure: "false"},
    {url: "http://clickhouse:8123/non-root", secure: "false"},
    {url: "http://clickhouse:8123?readonly=2", secure: "false"},
    {url: "http://clickhouse:8123#fragment", secure: "false"},
    {url: "http://clickhouse:8123", secure: "true"},
  ];
  for (const {url, secure} of rejected) {
    withEnvironment(
      {
        SDAR_CLICKHOUSE_ENDPOINT_POLICY: "development-compose",
        NODE_ENV: "development",
        TEST_CLICKHOUSE_URL: url,
        TEST_CLICKHOUSE_USER: "reader",
        TEST_CLICKHOUSE_PASSWORD: "password",
        TEST_CLICKHOUSE_SECURE: secure,
      },
      () => assert.throws(() => configFromEnv("TEST_CLICKHOUSE_")),
    );
  }
});

test("direct construction cannot bypass endpoint policy validation", () => {
  withEnvironment(
    {NODE_ENV: "development"},
    () =>
      assert.doesNotThrow(
        () =>
          new ClickHouseClient({
            ...baseConfig(),
            endpointPolicy: "development-compose",
            url: "http://clickhouse:8123",
            secure: false,
          }),
      ),
  );
  assert.throws(
    () =>
      new ClickHouseClient({
        ...baseConfig(),
        url: "http://clickhouse:8123",
        secure: false,
      }),
    hasErrorCode("CLICKHOUSE_HOST_FORBIDDEN"),
  );
  withEnvironment(
    {NODE_ENV: undefined},
    () =>
      assert.throws(
        () =>
          new ClickHouseClient({
            ...baseConfig(),
            endpointPolicy: "development-compose",
            url: "http://clickhouse:8123",
            secure: false,
          }),
        hasErrorCode("CLICKHOUSE_DEVELOPMENT_ENVIRONMENT_REQUIRED"),
      ),
  );
  assert.throws(
    () =>
      new ClickHouseClient({
        ...baseConfig(),
        endpointPolicy: "unknown",
      } as unknown as ClickHouseConfig),
    hasErrorCode("CLICKHOUSE_ENDPOINT_POLICY_INVALID"),
  );
});

test("custom CA configuration fails closed until the HTTP transport can apply it", () => {
  withEnvironment(
    {
      SDAR_CLICKHOUSE_ENDPOINT_POLICY: undefined,
      NODE_ENV: undefined,
      TEST_CLICKHOUSE_URL: "https://192.168.1.7:8443",
      TEST_CLICKHOUSE_USER: "reader",
      TEST_CLICKHOUSE_PASSWORD: "password",
      TEST_CLICKHOUSE_CA_FILE: "/run/config/clickhouse-ca.pem",
      TEST_CLICKHOUSE_SECURE: "true",
    },
    () => assert.throws(() => configFromEnv("TEST_CLICKHOUSE_"), /CA_FILE is not supported/u),
  );
});

test("query puts readonly and result limits in the request URL", async () => {
  let requestUrl: URL | undefined;
  let requestHeaders: Headers | undefined;
  await withMockFetch(
    async (input, init) => {
      requestUrl = new URL(String(input));
      requestHeaders = new Headers(init?.headers);
      return new Response("1\n", {status: 200});
    },
    async () => {
      const client = new ClickHouseClient(baseConfig());
      assert.equal(await client.query("SELECT 1", {readonly: 2, maxResultRows: 123}), "1\n");
    },
  );
  assert.equal(requestUrl?.searchParams.get("readonly"), "2");
  assert.equal(requestUrl?.searchParams.get("max_result_rows"), "123");
  assert.equal(requestUrl?.searchParams.get("result_overflow_mode"), "throw");
  assert.equal(requestHeaders?.get("x-clickhouse-user"), "telemetry-test");
});

test("insert uses a stable deduplication token for canonical-equivalent rows", async () => {
  const left = deterministicInsertDeduplicationToken("sdar_core.example", [{b: 2, a: 1}]);
  const right = deterministicInsertDeduplicationToken("sdar_core.example", [{a: 1, b: 2}]);
  assert.equal(left, right);

  let requestUrl: URL | undefined;
  await withMockFetch(
    async (input) => {
      requestUrl = new URL(String(input));
      return new Response("", {status: 200});
    },
    async () => {
      await new ClickHouseClient(baseConfig()).insert("sdar_core.example", [{b: 2, a: 1}]);
    },
  );
  assert.equal(requestUrl?.searchParams.get("insert_deduplication_token"), left);
  assert.equal(requestUrl?.searchParams.get("date_time_input_format"), "best_effort");
});

test("ClickHouse failures never expose credentials", async () => {
  const credential = "credential-that-must-not-leak";
  await withMockFetch(
    async () => new Response(`authentication failed password=${credential}`, {status: 401}),
    async () => {
      const client = new ClickHouseClient(baseConfig(credential));
      await assert.rejects(client.query("SELECT 1"), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(credential), false);
        return true;
      });
    },
  );

  await withMockFetch(
    async () => {
      throw new Error(credential);
    },
    async () => {
      const client = new ClickHouseClient(baseConfig(credential));
      await assert.rejects(client.query("SELECT 1"), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(credential), false);
        return true;
      });
    },
  );
});

function hasErrorCode(expected: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & {code?: unknown}).code, expected);
    return true;
  };
}

function withEnvironment<T>(
  values: Record<string, string | undefined>,
  operation: () => T,
): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withMockFetch<T>(mock: typeof fetch, operation: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await operation();
  } finally {
    globalThis.fetch = original;
  }
}
