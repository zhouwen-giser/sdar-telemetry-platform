# SDAR Telemetry 消费、Readiness 与 Reconciliation

## 消费来源

只读：

```text
sdar_core.external_provider_fact
sdar_core.external_entity_relation_fact
```

以及 1.5.1-rc.2 既有六个 SMPP View。

## Episode 关联

优先使用：

```text
SDAR remote_task_binding
+ external_entity_relation_fact
+ external task/provider/execution IDs
```

不允许仅按时间窗口猜测 Episode。

## Provider Readiness

```text
not_required
  当前 Episode/Profile 没有 MCP Provider 侧要求

not_ready
  需要 Provider 遥测，但缺少 provider fact、task relation 或关键终态

degraded
  Required 路径存在，但 supporting relation/progress/health 不完整

ready
  需要的 Provider task/command/execution/resource facts 和关系完整，且无冲突

conflict
  同 identity 不同 hash、终态矛盾、关系歧义或 revision 冲突
```

## Reconciliation

对齐：

```text
SDAR remote_task_binding status
Provider task lifecycle
Provider command lifecycle
Provider execution progress
Provider recovery lifecycle
```

需要识别：

```text
provider terminal before SDAR terminal
terminal mismatch
revision mismatch
missing task relation
missing provider observation
duplicate/conflicting provider fact
```

Reconciliation 结论是 Evidence Quality/Consistency，不直接产生 Benchmark HG/F。
