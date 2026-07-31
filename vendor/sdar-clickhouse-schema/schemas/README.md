# 三系统 JSON Schema 目录

本目录按采集系统分为 SDAR Runtime、车长智能体和 NPC 智能体三个子目录。通用证据合同只在 `sdar_runtime` 中维护一份；车长和 NPC 目录通过 `$ref` 复用通用合同，并用各自入口 Schema 收紧 `agentType`、`adapter` 和 `domainState`。

## 目录结构

| 目录 | 采集系统 | 内容 | 主要 ClickHouse 去向 |
|---|---|---|---|
| [`sdar_runtime/`](sdar_runtime/) | SDAR Runtime / 通用范式 | v1.3 Canonical Evidence Envelope、Skill-aware 一级事实，以及原有 Episode/Goal/State/Action/Verification 兼容合同 | `sdar_core`、`sdar_meta`、`sdar_mart.general_*` |
| [`commander/`](commander/) | 车长智能体 / 领域应用范式 | LangGraph 节点、UgvState 扩展、车长状态和 Episode 专用入口 | `sdar_commander → sdar_embodied → sdar_core` |
| [`npc/`](npc/) | NPC 智能体 / 领域应用范式 | Tick、Blackboard 扩展、NPC 状态和 Episode 专用入口 | `sdar_npc → sdar_embodied → sdar_core` |

```text
schemas/sdar_runtime  ← 通用合同单一来源
          ▲                         ▲
          │ $ref                    │ $ref
schemas/commander              schemas/npc
          │                         │
          └──── P1 → sdar_embodied ←┘
                         │
                         P2
                         ▼
                     sdar_core
```

这只是 Schema 依赖关系，不表示三层评价可以复用分数。application、domain、general 仍须分别读取本层事实、固定本层规则集并独立评价。

## 采集入口

| 系统 | 完整 Episode 入口 | 原始/轻量入口 | 专用状态入口 |
|---|---|---|---|
| SDAR Runtime | [`sdar_runtime/v1_3_skill_aware/canonical-evidence-envelope.schema.json`](sdar_runtime/v1_3_skill_aware/canonical-evidence-envelope.schema.json) | [`sdar_runtime/raw_record.schema.json`](sdar_runtime/raw_record.schema.json)（Embodied 兼容入口） | Runtime payload Schema 由 `recordType + schemaName/schemaVersion` 选择 |
| 车长 | [`commander/episode_evidence_bundle.schema.json`](commander/episode_evidence_bundle.schema.json) | 通用 raw + 车长 Collector 信封 | [`commander/state_snapshot.schema.json`](commander/state_snapshot.schema.json) |
| NPC | [`npc/episode_evidence_bundle.schema.json`](npc/episode_evidence_bundle.schema.json) | 通用 raw；minimal 另见 [`../npc_minimal_runtime_schema_v1/`](../npc_minimal_runtime_schema_v1/) | [`npc/state_snapshot.schema.json`](npc/state_snapshot.schema.json) |

车长和 NPC 的完整示例必须分别使用各自 Episode 入口，不能直接使用宽泛的通用入口规避领域状态校验。

## `$id` 和 `$ref` 规则

- 原 Embodied-Control Schema 的 `$id` 保持不变，避免已发布的 `schemaRef` 和证据索引失效。
- v1.3 Runtime Schema 使用 `https://schemas.sdar.io/evidence/v1/` 命名空间；`record-catalog.json` 是记录策略目录，不是 JSON Schema。
- 新增的系统入口使用 `/v1/commander/` 或 `/v1/npc/` 命名空间。
- 通用 Schema 之间继续按稳定 `$id` 解析；不要根据物理目录重新拼接远程 URI。
- Collector 必须把实际入口 `$id`、Schema 版本和载荷 Hash 写入原始信封。
- 物理目录调整不等于 Schema 版本升级；语义或约束变化才升级版本。

## 版本和覆盖边界

本目录的 Embodied-Control JSON Schema 版本仍为 `1.0.0`；Runtime 采用 SDAR `v1.3.0`、Schema 文档修订 `V1.2`、Evidence Family `sdar.evidence/v1`。v1.3 冻结决策明确取代 v1.2 遥测入口，不并行维护第二套 Runtime 信封。完整冻结依据见 [`../SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/`](../SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/)；原 v1.2 文档只用于历史数据解释。

三个系统与 ClickHouse 表的字段、ID、环境和投影版本映射见[字段映射合同](../sdar_clickhouse_schema_v1_0/docs/schema_mapping.md)。

## 校验

在仓库根目录执行：

```bash
python3 validate_examples.py
```

校验器递归加载三个目录中的全部 Schema，并分别用车长/NPC 专用入口校验完整示例。
