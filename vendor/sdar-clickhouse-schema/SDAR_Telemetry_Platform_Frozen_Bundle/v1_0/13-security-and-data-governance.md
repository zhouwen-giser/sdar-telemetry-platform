# 13. 安全与数据治理

## 1. 接入

- mTLS 或最小权限 Source Token；
- Source ID 与 Credential 固定绑定；
- Route 限定 tenant/project/environment；
- 防重放时间窗与幂等键；
- Payload 大小、字段和媒体类型白名单。

## 2. Secret 与敏感数据

禁止进入 Payload：

```text
Authorization
Cookie
Token
Password
Secret
Private Key
Connection String
```

- 发现后拒绝或进入隔离 DLQ；
- 证据引用使用 URI + Hash；
- 大对象进入 Object Storage；
- 查询按字段分类和角色脱敏。

## 3. RBAC

```text
platform_admin
source_admin
projection_admin
quality_operator
evaluator
query_reader
security_auditor
```

## 4. 数据治理

- Schema/Projection/Evaluation Definition 全版本化；
- Retention 按记录族；
- Legal Hold 独立标记；
- 删除使用 Tombstone/Audit，不能无痕物理删除治理记录；
- 跨租户 Query 默认拒绝。
