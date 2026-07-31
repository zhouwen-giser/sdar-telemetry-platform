# 20. 来源对齐与修订记录

## 保持的来源结论

- 在线 Provider 发现与遥测入仓必须分离；
- ClickHouse 不参与在线执行控制；
- SMPP 外部事实进入独立 `external_*`；
- `remote_task_*` 与 ProviderOps 只读对账；
- `smpp_source_id` 是跨来源作用域；
- ProviderOps 是 supporting/operational evidence；
- 三层评价不复制结果；
- Runtime 不持有 ClickHouse 凭据。

## 本冻结版的架构修订

### 原设计

```text
每个 SMPP Telemetry Platform
→ 多 Target
→ 直接写 SDAR Shared ClickHouse
```

### 冻结设计

```text
SMPP Edge Telemetry/Outbox
→ SDAR Telemetry Ingestion
→ 中央 WAL/Normalizer/Projection Registry
→ ClickHouse
```

原因：

- 独立产品职责更清晰；
- Mapping/Projection 只有一个权威；
- Credential、Route、Replay 和 DQ 集中管理；
- 避免每个 SMPP 发布 SDAR 专用代码；
- 更适合未来多个 SDAR 节点和组织网络。

SMPP 本地投影不被禁止，但它不再是 SDAR 仓库投影权威。
