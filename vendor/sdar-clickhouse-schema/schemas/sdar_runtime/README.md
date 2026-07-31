# SDAR Runtime 与通用证据 Schema

本目录是三个采集系统共享的通用 JSON Schema 单一来源，对应 `sdar_core` 可消费的通用证据语义。车长和 NPC 的专用 Schema 通过稳定 `$id` 引用这里的定义。

## 文件分组

| 分组 | Schema |
|---|---|
| v1.3 Runtime 正式入口 | `v1_3_skill_aware/canonical-evidence-envelope`、`common-definitions`、`record-catalog` |
| v1.3 Skill 事实 | `v1_3_skill_aware/skill-*`（17 类）与 `evaluation-readiness` |
| 公共与原始采集 | `common`、`raw_record`、`episode_metadata` |
| 触发和目标 | `trigger`、`goal`、`success_criterion`、`constraint` |
| 状态和轨迹 | `state_snapshot`、`state_delta`、`event`、`trajectory_step` |
| 执行与控制 | `execution_basis`、`decision`、`gate_decision`、`confirmation`、`action` |
| 回执和验证 | `receipt`、`verification`、`failure`、`recovery` |
| 闭环和性能 | `remaining_item`、`final_outcome`、`operational_metric` |
| 聚合入口/输出 | `episode_evidence_bundle`、`evaluation_result` |

## 入口边界

- `v1_3_skill_aware/canonical-evidence-envelope.schema.json`：SDAR Runtime v1.3 唯一正式采集入口，固定 `evidenceFamily=sdar.evidence/v1`、`agentType=sdar`；`transactional` 记录必须携带 `evidenceSequence`。
- `raw_record.schema.json`：Embodied-Control 追加式原始记录兼容入口。
- `episode_evidence_bundle.schema.json`：车长/NPC 共用证据包基线；两个应用系统仍应使用各自的收紧入口。
- `state_snapshot.schema.json`：车长/NPC 共用状态外壳和领域状态分派。
- `evaluation_result.schema.json`：旧版统一评价结果兼容格式，不代替 ClickHouse 1.1 中三层独立、版本化的 Mart 四表合同。

Runtime v1.3 的 `transactional|required` 证据禁止采样，必须先与 PostgreSQL 权威事务一起进入 Journal/Outbox，再由 Exporter/Collector 至少一次投递到 ClickHouse；ClickHouse 以 `recordId + payloadHash` 幂等收敛。业务 Domain/Application 不直接调用遥测 API，OTel 只承载 trace/span 上下文，不把普通 span 当正式评价证据。完整合同见[冻结 Schema 文档](../../SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/SDAR_v1.3_Skill_Aware_Evidence_Schema_V1.2_FROZEN_CN.md)。

## 与应用系统的关系

Runtime 原生信封固定 `agentType=sdar`；Embodied-Control 公共类型中的 `AgentType` 保持 `commander/npc`，避免在原 `1.0.0` `$id` 下放宽约束。车长和 NPC 入口分别固定自己的类型。P2 投影到通用层时，来源 adapter、根来源和映射版本必须保存在 projection sidecar，不能只靠 `agentType` 反推。

Runtime 信封示例见 [`../../examples/v1_3_skill_aware/canonical-envelope.skill-execution.example.json`](../../examples/v1_3_skill_aware/canonical-envelope.skill-execution.example.json)。

目录中的相对 `$ref` 依据 Schema `$id` 解析。移动文件时不得修改已有 `$id`，否则历史 EvidenceRef 无法重放。
