# SDAR Telemetry Platform 独立遥测平台完整设计冻结基线 V1.0

## 状态

- 平台版本：`sdar-telemetry-platform 1.0.0`
- 设计状态：`DESIGN_FROZEN_IMPLEMENTATION_PENDING`
- ClickHouse 目标 Schema：`sdar-clickhouse-schema 1.3.0`
- 仓储来源基线：`sdar-clickhouse-schema 1.2.0`
- SDAR 正式证据族：`sdar.evidence/v1`
- SMPP ProviderOps 合同：`ProviderOpsEnvelope 1.1.0`
- 冻结日期：2026-07-31
- 来源 ZIP SHA-256：`501f43e714a6f28a2ec6f4643662ee4b577dff5fa3b8df1440c544a63c2bd5f3`

## 核心定位

SDAR Telemetry Platform 是独立于 SDAR Runtime、SDAR Node Control Plane 和 SMPP Provider Platform 的事实采集、投影、仓储、质量、评价、对账和查询平台。

```text
SDAR Runtime / Node Control Plane / Commander / NPC / SMPP / Device
                         │
                         ▼
                Telemetry Ingestion Gateway
                         │
                 Durable WAL + ACK
                         │
       Schema/Policy → Normalize → Projection Registry
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
  ClickHouse         Object Storage      DLQ
       │
       ├─ Data Quality / Reconciliation / Evaluation
       └─ Query API / Telemetry Console
```

## 四条硬边界

1. 遥测平台不参与在线 Provider 发现、Availability 和任务接纳。
2. 遥测平台不写 SDAR Runtime PostgreSQL、SMPP Runtime Database 或控制面权威表。
3. ClickHouse、Collector、WAL 后续投影失败不影响 SDAR/SMPP 已运行任务。
4. 遥测事实可以产生告警、质量问题和监督输入，但不能直接改变 Task、Workflow、Capability 或 Provider 状态。

## 来源基线结论

仓储 1.2.0 已形成六库、191 张物理表、63 个视图，以及投影、血缘、水位、质量和三层独立评价合同。v1.3 Skill-aware 证据已经进入 `sdar_core.skill_*`。本冻结版保留这些仓储语义，并新增独立平台边界、SMPP 外部事实和 v1.4 Capability 关系事实。
