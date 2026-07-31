# 19. ClickHouse 1.3.0 目标增量目录

## Migration 12

新增表：

```text
sdar_core.external_provider_fact
sdar_core.external_entity_relation_fact
```

新增视图：

```text
v_smpp_provider_task_timeline
v_smpp_resource_current_state
v_smpp_resource_current_health
v_smpp_execution_latest_progress
v_sdar_smpp_task_reconciliation
v_sdar_smpp_execution_topology
```

## Migration 13

新增表：

```text
sdar_core.node_capability_version_fact
sdar_core.capability_implementation_binding_fact
sdar_core.capability_readiness_fact
sdar_core.a2a_exposure_revision_fact
sdar_core.agent_card_revision_fact
sdar_core.task_capability_binding_fact
sdar_core.task_capability_attempt_fact
```

新增视图：

```text
sdar_core.v_node_capability_current
sdar_core.v_capability_readiness_current
sdar_core.v_a2a_exposure_current
sdar_core.v_agent_card_current
sdar_core.v_task_capability_execution_chain
sdar_core.v_task_capability_contract_issue
```

## 最终目标

```text
databases = 6
physical_tables = 200
views = 76
migrations = 00..13
```
