# 14. 部署、高可用与故障隔离

## 1. V1.0 部署

```text
PostgreSQL Control DB
OpenTelemetry Collector
Ingestion Gateway
Segmented WAL
Normalizer/Projection Workers
ClickHouse
Object Storage
Query API
Admin API
Console
```

## 2. 扩展模型

- Ingestion Route 按 Source/Partition Hash 分配单一活动 Writer；
- Worker 通过 Lease 获取 WAL Partition；
- Query API 可无状态横向扩展；
- Projection Target 独立 Checkpoint；
- 不宣称跨节点 exactly-once。

## 3. 故障

### ClickHouse 不可用

- WAL 保留；
- Source 在容量范围内继续 ACK；
- 达高水位后停止 ACK，由源端 Outbox 保留；
- 不影响 Runtime/SMPP Task。

### Platform Control DB 不可用

- 已运行 Worker 使用 LKG；
- 不允许新配置和 Replay；
- 不停止已安全运行的 Projection，除非 Lease 到期策略要求停止。

### Source 断线

- 不生成虚假心跳；
- Watermark/Freshness 变为 degraded；
- Query 明确显示 coverage gap。

### Telemetry Platform 全停

- SDAR/SMPP 继续运行；
- 源端 Journal/Outbox 保留；
- 恢复后重放。
