# 06. 投影与数仓冻结

## 1. 六库保持不变

| 数据库 | 职责 |
|---|---|
| `sdar_meta` | 分析元数据、Schema、Projection、Lineage、DQ、Evaluation Definition |
| `sdar_core` | SDAR 通用事实、Skill/Capability、SMPP 外部事实 |
| `sdar_commander` | 车长应用原始语义 |
| `sdar_npc` | NPC 应用原始语义 |
| `sdar_embodied` | 归一后的具身领域事实 |
| `sdar_mart` | 三层评价结果和证据快照 |

## 2. Projection Set

```text
sdar-runtime-core-v1
sdar-runtime-skill-aware-v1
sdar-node-capability-v1
commander-application-v1
npc-application-v1
application-to-embodied-v1
embodied-to-core-v1
smpp-provider-audit-v1
smpp-resource-state-v1
smpp-resource-measurement-v1
smpp-external-relations-v1
evaluation-application-v1
evaluation-embodied-v1
evaluation-general-v1
```

## 3. Checkpoint

- Source WAL Checkpoint 和 Projection Checkpoint 位于 Platform Control DB；
- `sdar_meta.projection_checkpoint` 是审计镜像；
- 每 Target/Projection 独立失败、重试和 DLQ；
- Run 固定 Projection Version、Mapping Hash、Contract Version 和 ID Namespace Version；
- Run 内禁止热切换版本。

## 4. ClickHouse Schema 目标

```text
1.2.0：191 tables / 63 views / migrations 00..10
Migration 11：v1.3 event handling，目标 191 / 64
Migration 12：SMPP ProviderOps，目标 193 / 70
Migration 13：v1.4 Capability chain，目标 200 / 76
最终：migrations 00..13
```

以上为设计冻结目标，必须通过 ClickHouse 24.8 与 25.3 编译后才能标记 Implementation Frozen。
