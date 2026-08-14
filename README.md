# sdar-telemetry-platform

独立 TypeScript 遥测事实平台。当前主链路接收 Runtime 固化的 `sdar.evidence/v1`（SDAR v1.4.1），入口在持久 WAL `fsync` 后 ACK，Worker 再经中央 Projection Registry 写入外部 ClickHouse。平台不参与任何在线控制，SDAR PostgreSQL 始终保持运行权威。

Runtime contract 的可重复快照位于 `integrations/skill-driven-agent-runtime/v1.4.1`。其中 `source-lock.json` 分别记录 canonical contract/registry hash 和每个源文件的 byte SHA-256；旧的 v1.3 integration 文件仅为 **compatibility-only**。

## 本地门禁

```bash
npm run check:sdar-evidence-contract
npm run verify
```

需要从相邻 Runtime 开发分支刷新快照时执行：

```bash
npm run sync:sdar-evidence-contract
```

## 外部 ClickHouse

```bash
cp .env.example .env
npm run clickhouse:preflight
npm run clickhouse:migrate
npm run clickhouse:verify
npm run clickhouse:smoke
```

`.env` 只保存非提交的本机配置；密码和 bearer token 分别放在 `deploy/secrets/clickhouse_password`、`deploy/secrets/clickhouse_query_password`、`deploy/secrets/evidence_ingest_bearer_token` 和 `deploy/secrets/query_api_bearer_token`。不要把真实凭据写入 `.env.example`、Compose、日志或报告。Gateway 和 Query API 的 inline/token-file 配置各自必须且只能选择一个。当前 ClickHouse HTTP transport 对自定义 `CA_FILE` 采取 fail-closed；在真实支持 TLS dispatcher CA 前不会静默忽略该配置。

## Compose 运行布线

默认 Compose 为 `deploy/compose.external-clickhouse.yaml`，明确不包含 ClickHouse Server。Compose 只向每个服务注入所需的显式环境白名单和独立 secret：Gateway 只能读取 ingest token，Worker 只能读取 writer 密码，Query 只能读取 reader 密码和独立 Query token。Gateway 与 Worker 共享命名卷 `telemetry_wal`，因此 ACK 后的 Evidence batch 不依赖容器生命周期。运行镜像包含固化的 `integrations` contract 和 `migrations`，Gateway 默认从 `/app/integrations/skill-driven-agent-runtime/v1.4.1/schemas/evidence/v1` 加载 100 个 Evidence schemas。

Gateway 与 Query API 的进程默认绑定 `127.0.0.1`。Compose 容器内显式绑定 `0.0.0.0`，但宿主发布地址默认仍为 `127.0.0.1`；只有在已有鉴权网络边界时才应修改 `GATEWAY_PUBLISH_HOST` 或 `QUERY_PUBLISH_HOST`。`/health` 不要求 Query token，其余 Query 路由必须携带 `Authorization: Bearer <query-token>`。

```bash
docker compose -f deploy/compose.external-clickhouse.yaml up --build \
  ingestion-gateway telemetry-worker query-api
```

Runtime v1.4.1 只能通过带 Bearer 和 `x-sdar-evidence-contract: sdar.evidence/v1` 的 `/v1/evidence/batches` HTTP contract 接入。`sdar-outbox-relay` 及 `SDAR_DATABASE_URL` 只保留给 v1.3 `telemetry_outbox`，已隔离在 `legacy-v1.3` profile；它不能读取或更新 v1.4 的 `evidence_outbox`，也不能替代 Evidence v1 Gateway。
