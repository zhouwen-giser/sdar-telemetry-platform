# 车长智能体采集 Schema

本目录保存车长智能体专用的领域应用 Schema。公共 Goal、Decision、Action、Receipt、Verification 等定义复用 [`../sdar_runtime/`](../sdar_runtime/)，不在本目录复制。

## 文件

| Schema | 用途 |
|---|---|
| [`commander_state_extension.schema.json`](commander_state_extension.schema.json) | 车长 `UgvState` 领域状态扩展 |
| [`commander_node_record.schema.json`](commander_node_record.schema.json) | LangGraph 节点开始/结束、输入输出和关联证据 |
| [`state_snapshot.schema.json`](state_snapshot.schema.json) | 固定 `agentType=commander` 并约束 `domainState` |
| [`episode_evidence_bundle.schema.json`](episode_evidence_bundle.schema.json) | 车长完整 Episode 校验入口，固定 commander adapter |

## 必采数据

车长 Collector 应覆盖：

```text
Trigger/Goal → StateSnapshot/StateDelta → Event/Node
→ ExecutionBasis/Decision/Gate/Confirmation
→ Action/Receipt/Verification → Trajectory/Outcome
```

控制或写操作必须保存执行依据版本、决策、前置状态、幂等键、门槛/确认、回执和实际 Verification。“MCP 已受理”不能作为车辆移动、侦察或打击完成的证明。

## 存储与投影

```text
车长 Collector
  ├─ raw_record + typed facts（同 record_id/payload_sha256）
  ▼
sdar_commander
  │ P1：ID crosswalk、枚举、环境、Hash、lineage
  ▼
sdar_embodied
  │ P2：通用 raw + typed + sidecar
  ▼
sdar_core
```

应用层评价只读 `sdar_commander`，领域评价只读 `sdar_embodied`，通用评价只读 `sdar_core`。投影事实可以上卷，评价分数不能上卷。

车长完整示例 [`../../examples/commander_episode.example.json`](../../examples/commander_episode.example.json) 使用本目录的 Episode 入口校验。详细字段映射见 [ClickHouse Schema Mapping](../../sdar_clickhouse_schema_v1_0/docs/schema_mapping.md)。
