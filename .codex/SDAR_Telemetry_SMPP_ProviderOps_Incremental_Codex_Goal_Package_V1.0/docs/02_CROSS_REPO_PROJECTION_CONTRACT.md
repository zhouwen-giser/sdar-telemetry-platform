# SMPP → SDAR Shared Warehouse 投影合同

## 当前代码缺口

SMPP `TargetWorker` 只执行：

```text
tableMap[sourceTable] ?? sourceTable
```

而 `CoreProjectionV1` 输出 standalone `telemetry_core.*` Row。SDAR `external_provider_fact` 和 `external_entity_relation_fact` 具有不同字段集合，因此不能只改表名。

## 必须新增

```text
SdarSharedWarehouseProjectionV1
SdarExternalProviderFactMapper
SdarExternalEntityRelationMapper
SdarWarehouseSchemaPreflight
ProviderOpsPayloadCatalog
SmppUrnParserV1
```

Target Worker 应根据 `targetType=sdar_shared_warehouse` 选择目标投影器，而不是把 standalone Core row 直接插入。

## Payload Catalog

为 16 个 ProviderOps `recordType` 冻结 payload schema。至少规范：

```text
lifecycleStatus
providerSubstate
reasonCode
runtimeRevision
providerRevision
progressPercent
externalCommandId
observedAt
terminalStatus
```

只有对应 record-type schema 声明的字段可以进入结构化列；其他内容保留在 `payload_json`。

## Source Mapping v4

新增必填：

```text
smppSourceId
```

它是稳定逻辑源 ID，不可由 URL、providerId 或 instanceId 临时计算。
