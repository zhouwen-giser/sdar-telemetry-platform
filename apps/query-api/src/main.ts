import {
  ClickHouseClient,
  configFromEnv,
} from "../../../packages/telemetry-clickhouse/src/index.js";
import { loadConfig } from "../../../packages/telemetry-config/src/index.js";
import { createQueryApi, loadQueryBearerCredential } from "./server.js";

const configuration = loadConfig();
const clickHouse = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));
const bearerCredential = await loadQueryBearerCredential();
const server = createQueryApi({
  clickHouse,
  bearerCredential,
  maxResultRows: Number(process.env["QUERY_MAX_RESULT_ROWS"] ?? 10_000),
});

const bindHost = process.env["QUERY_BIND_HOST"] ?? "127.0.0.1";
server.listen(configuration.queryPort, bindHost, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "query_api.ready", host: bindHost, port: configuration.queryPort })}\n`,
  );
});
