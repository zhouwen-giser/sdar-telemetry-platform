# 01. 来源基线与独立平台增量

## 1. ClickHouse 1.2.0 基线

| 项目 | 基线 |
|---|---|
| 数据库 | 6 |
| 物理表 | 191 |
| 逻辑视图 | 63 |
| 迁移 | 00～10 |
| ClickHouse | 24.8+，推荐 25.3 LTS+ |
| 证据族 | `sdar.evidence/v1` |
| 来源 ZIP SHA-256 | `501f43e714a6f28a2ec6f4643662ee4b577dff5fa3b8df1440c544a63c2bd5f3` |

六库：

```text
sdar_meta
sdar_core
sdar_commander
sdar_npc
sdar_embodied
sdar_mart
```

## 2. 可直接继承

- Canonical Envelope；
- transactional / buffered 与 required / supporting / diagnostic 正交语义；
- Journal/Outbox → Collector 的至少一次投递；
- Canonical UUIDv5、ID Crosswalk、Lineage；
- P1 application→embodied 与 P2 embodied→core；
- Projection Definition/Version/Run/Checkpoint/DLQ；
- 应用、领域、通用三层独立评价；
- Skill-aware 17 类事实及 evaluation readiness；
- 质量视图、发布水位与结果可重放合同。

## 3. 原方案不足

现有包是“仓库 Schema 与证据规范”，不是完整遥测平台，缺少：

- 平台控制数据库；
- Source、Route、CredentialRef 和 Projection Set 管理；
- 统一 Ingestion Gateway；
- 平台级 Durable WAL、ACK 和 Replay；
- 独立 Query API；
- 独立 Telemetry Console；
- SMPP ProviderOps 统一接入；
- v1.4 Capability/A2A/Task Binding 事实；
- 多节点、多 SMPP N×N 隔离；
- 平台部署、RBAC 和运维接口。

## 4. 对 SMPP 主动多目标投影方案的修订

早期方案由每个 SMPP Telemetry Platform 直接持有 SDAR ClickHouse Credential，并执行 SDAR 专用 Projection。

独立平台冻结后改为：

```text
SMPP ProviderOps Outbox / Edge Relay
→ SDAR Telemetry Ingestion Gateway
→ Platform WAL
→ Central Projection Registry
→ SDAR ClickHouse
```

SMPP 本地 ClickHouse 可继续作为可选本地 Target，但 SDAR 专用规范化和 Projection 的唯一权威进入 SDAR Telemetry Platform，避免 N 个 SMPP 复制 N 套映射代码。
