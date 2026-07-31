# 02. 产品范围与总体架构

## 1. 产品职责

### 采集

- SDAR Runtime 正式证据；
- SDAR Node Control Plane 发布、应用和审计事实；
- Commander/NPC 应用证据；
- SMPP ProviderOps；
- 设备和资源状态/测量；
- OTel Trace/Metric/Log 诊断信号。

### 处理

- Source Identity 与 Tenant/Project/Environment 映射；
- Schema 与 Evidence Policy 校验；
- 脱敏、规范化、Hash 和幂等；
- Projection Registry；
- DLQ、Replay、Checkpoint 和 Watermark；
- 质量检查、对账和评价。

### 提供

- ClickHouse 六库；
- 大对象/图像/文件引用；
- Query API；
- Telemetry Console；
- Supervisor/Interaction Hub 的只读投影。

## 2. 非目标

- 在线 Task、Workflow、Skill、Capability 状态权威；
- Provider Registry、Catalog 或 Availability；
- 设备控制；
- 全局监督纠错决策；
- Node Control Plane 配置发布；
- 替代 PostgreSQL 事务状态；
- 完全实时的毫秒级控制数据总线。

## 3. 总体组件

```text
apps/
├─ telemetry-admin-api
├─ telemetry-ingestion-gateway
├─ telemetry-query-api
├─ telemetry-worker
└─ telemetry-console

packages/
├─ telemetry-domain
├─ telemetry-control-persistence-postgres
├─ telemetry-wal
├─ source-adapters
├─ schema-policy-registry
├─ canonical-normalizer
├─ projection-registry
├─ clickhouse-projections
├─ data-quality-engine
├─ reconciliation-engine
├─ evaluation-engine
├─ query-model
└─ telemetry-contracts
```

## 4. 控制面与数据面

### 平台控制面 PostgreSQL

保存：

- Source、Route、Projection Set；
- Schema/Policy 发布引用；
- CredentialRef；
- Replay/Backfill Job；
- Worker Lease；
- WAL/Projection Checkpoint 权威；
- RBAC、Audit、Retention Policy。

### ClickHouse `sdar_meta`

保存：

- 可分析的 Schema、Projection、Lineage、Watermark 和评价定义镜像；
- 不作为 Worker 恢复的唯一权威；
- 不保存平台管理员 Session、Secret 或 Worker Lease。
