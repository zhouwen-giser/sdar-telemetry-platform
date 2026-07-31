# 04. 来源、采集与 ACK 合同

## 1. 来源类型

```text
sdar_runtime_evidence
sdar_node_control_event
commander_application_evidence
npc_application_evidence
smpp_provider_ops
device_measurement
otlp_diagnostic
file_or_artifact_reference
```

## 2. 统一作用域

每条记录必须能够归属：

```text
tenant_id
project_id
environment
source_system
source_id
deployment_id
runtime_instance_id
node_id（适用时）
smpp_source_id（适用时）
```

## 3. ACK 语义

### 正式证据和 ProviderOps

```text
Receive
→ Authentication
→ Envelope/Size/Secret Scan
→ WAL fsync
→ ACK
→ Async Normalize/Project
```

ACK 不等待 ClickHouse Insert。

### OTLP

按 Collector 的标准重试语义处理，但 OTel 不是正式证据，不获得 Evidence Delivery Guarantee。

## 4. 投递保证

- Source：至少一次；
- Platform：按 `source + record_id + payload_hash` 幂等；
- ClickHouse：逻辑幂等，不声明物理 exactly-once；
- 相同逻辑 ID、不同 Hash：阻断冲突；
- Source 只有收到 Durable ACK 才可提交自身 Outbox Checkpoint。

## 5. 背压

- 每 Source/Route 有独立限流和容量；
- WAL 达高水位时 fail closed 并要求源端保留 Outbox；
- 不允许无限占用 Runtime/SMPP 内存；
- 高频 Measurement 可单独 Route、Sampling、TTL 和 Drop Policy；
- required transactional Evidence 禁止采样和静默丢弃。
