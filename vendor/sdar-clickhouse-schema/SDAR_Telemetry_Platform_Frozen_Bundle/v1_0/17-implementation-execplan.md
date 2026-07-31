# 17. 实施 ExecPlan

## P0 来源锁与仓库独立

- 导入 ClickHouse 1.2.0 来源包和 SHA；
- 建立 telemetry-platform 仓库；
- 保留 DDL/Schema/Examples 验证；
- 拆分平台控制 DB 与 `sdar_meta`。

## P1 Platform Control Plane

- Source、Route、Projection、Target、Retention；
- Draft/Publish/Apply/Ack/LKG；
- RBAC/Audit/SecretRef。

## P2 Ingestion/WAL

- Evidence Batch；
- ProviderOps Batch；
- WAL fsync ACK；
- Backpressure、DLQ；
- Source SDK/Outbox Client。

## P3 Normalizer/Projection Registry

- Schema/Policy Registry；
- Canonical Identity；
- P1/P2；
- Runtime Core/Skill；
- Multi-target Worker。

## P4 ClickHouse 1.3.0

- Migration 11；
- Migration 12 External ProviderOps；
- Migration 13 Capability Chain；
- Build Package、Manifest、24.8/25.3 编译。

## P5 Query/Data Quality

- Watermark；
- Timeline/Lineage；
- Capability Chain；
- Reconciliation；
- DQ Issue Lifecycle。

## P6 Evaluation

- Application/Embodied/General；
- 固定 Evidence Snapshot；
- Replay 和结果版本。

## P7 Console 与集成

- Telemetry Console；
- Node Console Query Adapter；
- Supervision/Interaction Read API；
- 2 SDAR × 2 SMPP E2E。

## P8 发布

- 容量、故障、安全；
- Backup/Restore；
- Operations Runbook；
- Implementation Frozen 报告。
