# sdar-telemetry-platform

独立 TypeScript 遥测事实平台。接收 SDAR v1.3 Transactional Outbox、预实现 v1.4 Node Control/Capability/A2A 合同，并兼容 SMPP ProviderOpsEnvelope 1.1.0。入口在 WAL `fsync` 后 ACK；Worker 经中央 Projection Registry 写入外部 ClickHouse。平台不参与任何在线控制，SDAR PostgreSQL 保持运行权威。

## 本地门禁

```bash
npm run verify
```

## 外部 ClickHouse

```bash
cp .env.example .env
npm run clickhouse:preflight
npm run clickhouse:migrate
npm run clickhouse:verify
npm run clickhouse:smoke
```

默认 Compose：`deploy/compose.external-clickhouse.yaml`，明确不包含 ClickHouse Server。
