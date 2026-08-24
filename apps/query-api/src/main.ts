import {
  ClickHouseClient,
  configFromEnv,
} from "../../../packages/telemetry-clickhouse/src/index.js";
import {
  loadConfig,
  type TelemetryHttpAuthorizationPolicy,
} from "../../../packages/telemetry-config/src/index.js";
import { createQueryApi, loadQueryBearerCredential } from "./server.js";

const configuration = loadConfig();
const clickHouse = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));
const authorization: TelemetryHttpAuthorizationPolicy =
  configuration.authProfile === "development-anonymous"
    ? Object.freeze({ profile: "development-anonymous" })
    : Object.freeze({
        profile: "bearer",
        bearerCredential: await loadQueryBearerCredential(),
      });
const server = createQueryApi({
  clickHouse,
  authorization,
  maxResultRows: Number(process.env["QUERY_MAX_RESULT_ROWS"] ?? 10_000),
});

const bindHost = process.env["QUERY_BIND_HOST"] ?? "127.0.0.1";
server.listen(configuration.queryPort, bindHost, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "query_api.ready", host: bindHost, port: configuration.queryPort })}\n`,
  );
});
