# 12. Telemetry Console 信息架构

```text
平台概览
Sources
Routes
Schemas & Evidence Policies
WAL & Ingestion
Projection Sets
Targets & Watermarks
Data Quality & DLQ
Replay / Backfill
SDAR Nodes
Tasks & Capability Chain
Skills
SMPP Providers & Resources
Reconciliation
Evaluations
Retention & Storage
Security & Audit
System Operations
```

## 关键界面原则

- 明确区分 Authority Status 与 Observed Projection；
- 显示 occurred/received/projected 三类时间；
- 显示 Source Coverage 和数据缺口；
- 所有 Replay/Drop/Waive 操作二次确认；
- 不提供 Task 状态修改、Provider 导入和 Capability 发布按钮；
- Node Console 可嵌入只读视图，但不能直接访问 ClickHouse。
