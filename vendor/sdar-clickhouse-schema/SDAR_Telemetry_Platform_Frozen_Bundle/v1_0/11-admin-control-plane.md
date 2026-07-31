# 11. 遥测平台管理控制面

## 1. 核心对象

```text
TelemetrySource
SourceCredentialRef
IngestionRoute
ProjectionSet
ProjectionTarget
SchemaPolicyRevision
RetentionPolicy
RedactionPolicy
ReplayJob
BackfillJob
WorkerLease
PlatformOperation
AuditEvent
```

## 2. 发布模型

```text
Draft → Validate → Publish → Apply → Ack → Active/LKG
```

- Source/Route/Projection/Retention 版本不可变；
- Secret 仅保存 SecretRef；
- Worker 使用 Latest/Watch/LKG；
- 坏 Revision 不覆盖 Active；
- Replay/Backfill 必须限定 Source、时间、Projection Version 和 Target。

## 3. Node Control Plane 关系

Node Control Plane 只配置：

```text
telemetry endpoint ref
source identity
credential ref
enabled record families
buffer/outbox policy
```

详细 Route、Projection 和 ClickHouse 凭据由 Telemetry Platform 管理。
