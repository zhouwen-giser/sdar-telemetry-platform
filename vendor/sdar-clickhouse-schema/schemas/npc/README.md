# NPC 智能体采集 Schema

本目录保存 NPC 智能体专用的领域应用 Schema。公共 Goal、Decision、Action、Receipt、Verification 等定义复用 [`../sdar_runtime/`](../sdar_runtime/)，不复制公共文件。

## 文件

| Schema | 用途 |
|---|---|
| [`npc_state_extension.schema.json`](npc_state_extension.schema.json) | NPC Blackboard、感知、威胁、战术、Mission 和通信状态扩展 |
| [`npc_tick_record.schema.json`](npc_tick_record.schema.json) | Tick 时序、活动分支、状态版本和关联证据 |
| [`state_snapshot.schema.json`](state_snapshot.schema.json) | 固定 `agentType=npc` 并约束 `domainState` |
| [`episode_evidence_bundle.schema.json`](episode_evidence_bundle.schema.json) | NPC 完整 Episode 校验入口，固定 npc adapter |

## 必采数据

NPC Collector 应覆盖：

```text
Trigger/Goal → Blackboard State/Tick/Delta → Event
→ BehaviorTree/Utility ExecutionBasis → Decision/Preemption
→ Gate/Approval → Action/Receipt/Verification
→ Trajectory/Recovery/Outcome
```

必须区分行为树选择、唯一控制权、Mission 抢占、攻击审批、工具受理与物理结果。Tick 不要求逐帧全量写入，但分支、意图、控制权、状态版本或业务结果变化时必须追加证据。

## 完整与 minimal 两种采集

| 模式 | Schema | 评价能力 |
|---|---|---|
| 完整 | 本目录 `episode_evidence_bundle.schema.json` | 可经 P1/P2 形成领域和通用评价所需证据 |
| minimal | [`../../npc_minimal_runtime_schema_v1/`](../../npc_minimal_runtime_schema_v1/) | 仅支持受限 NPC application 离线回归；domain/general 必须 NE |

最小测试案例定义见 [`../../npc_minimal_case_schema_v1/`](../../npc_minimal_case_schema_v1/)。案例 expected/assertion 不是运行事实，必须通过 `caseId` 与实际运行记录关联。

## 存储与投影

完整或 minimal 记录均先写 `sdar_npc.raw_record` 和对应 typed 表，两者必须共享 `record_id/payload_sha256`。P1 只投影无 Hash 冲突的记录；minimal 来源不得生成物理 Verification pass、状态新鲜度 pass 或完整轨迹。

NPC 完整示例 [`../../examples/npc_episode.example.json`](../../examples/npc_episode.example.json) 使用本目录的 Episode 入口校验。详细映射见 [ClickHouse Schema Mapping](../../sdar_clickhouse_schema_v1_0/docs/schema_mapping.md)。
