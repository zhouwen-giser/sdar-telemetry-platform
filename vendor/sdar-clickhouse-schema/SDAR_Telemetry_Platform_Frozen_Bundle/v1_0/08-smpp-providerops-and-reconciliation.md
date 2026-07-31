# 08. SMPP ProviderOps 与对账

## 1. 外部事实

### `external_provider_fact`

接收：

- provider.task.lifecycle
- provider.command.lifecycle
- adapter.rpc
- provider.scheduler.decision
- provider.recovery.lifecycle
- provider.ttl.lifecycle
- provider.authorization.decision
- provider.configuration.changed
- resource.state / health / metric
- execution.progress
- resource.measurement.fact

### `external_entity_relation_fact`

表达 N×N：

```text
SDAR Runtime served_by SMPP Provider
SDAR Invocation delegates_to SMPP Task
SDAR Task invokes SMPP Task
SMPP Task executes_on Resource
Provider observes Resource
```

## 2. 稳定身份

```text
tenant_id
project_id
environment
smpp_source_id
external_provider_id
external_task_id
external_execution_id
resource_id
correlation_id
trace_id
source_record_id/hash
```

禁止仅使用 providerId/resourceId/taskId 跨来源去重。

## 3. 对账

```text
remote_task_binding / observation / cancel
+
external_provider_fact
→ reconciliation views
```

只检测：

- 状态不一致；
- Revision 不一致；
- Provider Terminal 领先/滞后；
- Cancel 后未停止；
- 重复副作用；
- Recovery 异常。

不自动改写 Task。
