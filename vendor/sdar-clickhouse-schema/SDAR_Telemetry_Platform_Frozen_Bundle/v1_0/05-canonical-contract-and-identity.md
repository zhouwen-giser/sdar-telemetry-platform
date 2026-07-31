# 05. Canonical 合同与身份

## 1. 正式证据

继续使用：

```text
evidenceFamily = sdar.evidence/v1
recordType + schemaName + schemaVersion
deliveryGuarantee
evaluationRole
recordId
payloadHash
sequence
trace/span context
```

## 2. ProviderOps

保持 ProviderOpsEnvelope 1.1.0，进入平台后规范化为：

- `external_provider_fact`
- `external_entity_relation_fact`

不得映射成 SDAR 本地 `remote_task_observation`。

## 3. ID

保留 v1.2 Canonical UUIDv5 合同和 U+001F 分隔规则。新增全局 Source Scope：

```text
tenant/project/environment
+ source_system/source_id
+ smpp_source_id or node_id
+ source_entity_type/source_entity_id
```

## 4. 时间

每条事实至少包含：

```text
occurred_at
observed_at（可空）
received_at
normalized_at
projected_at
```

Query API 必须返回 Watermark 和 Freshness，不能把 `projected_at` 冒充 `occurred_at`。
