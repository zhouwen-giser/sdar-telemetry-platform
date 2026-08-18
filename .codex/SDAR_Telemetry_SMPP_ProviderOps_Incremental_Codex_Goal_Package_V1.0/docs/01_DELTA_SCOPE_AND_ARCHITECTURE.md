# 增量范围与统一架构

## 漏项

父任务覆盖了 SDAR Runtime Canonical Evidence、Commander/NPC Domain Source 和 Domain Projection，但没有把 MCP Provider 侧的独立 ProviderOps 遥测纳入统一评价输入。

## 正式链路

```text
SDAR Runtime --remote task binding/correlation--> MCP Provider
                                                |
                                                v
                                      smpp-telemetry-platform
                                                |
                              standalone target + SDAR shadow target
                                                |
                                                v
                                  sdar_core.external_provider_fact
                                  sdar_core.external_entity_relation_fact
                                                |
                                                v
                                      sdar-telemetry-platform
                                  readiness/reconcile/query/handoff
                                                |
                                                v
                                      sdar-benchmark-server
```

## 为什么不是 SDAR 拉取 SMPP Query API

- Query API 不是 durable delivery contract；
- 会复制 checkpoint/replay/去重责任；
- 无法与 SMPP WAL 的 target checkpoint 对齐；
- SMPP 已有 multi-target 和 `sdar_shared_warehouse` 设计；
- SDAR ClickHouse 已有 external fact/relation 目标。

因此正式模式是 SMPP **push projection**，SDAR Telemetry **consume and validate**。

## 与 Domain Projection 的关系

这是独立的 `external_provider_telemetry` Lane，不是 DP-C01..N05 的第 11 个 Mapper。Domain Projection 标准化 Commander/NPC 应用事实；SMPP Lane 保存 Provider 侧来源中立运行事实和跨系统关系。
