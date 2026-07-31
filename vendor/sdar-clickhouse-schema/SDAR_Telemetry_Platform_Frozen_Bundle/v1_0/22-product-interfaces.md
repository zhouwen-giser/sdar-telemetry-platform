# 22. 与其他产品的接口

| 产品 | Telemetry Platform 输入 | Telemetry Platform 输出 |
|---|---|---|
| SDAR Runtime | Evidence Outbox、Runtime Event | ACK、可选 DQ 回执 |
| Node Control Plane | 发布/应用/Audit 事件 | Query Link、配置应用历史 |
| SMPP Provider Platform | ProviderOps Outbox | ACK、对账/质量查询 |
| Commander/NPC | 应用 Evidence | 应用层 Query/Evaluation |
| Global Supervision | 无写入 | 全局 Evidence/Impact Query |
| Global Interaction Hub | 无写入 | 证据化查询、时间线和来源 |
| SDAR Node Console | Telemetry Link 配置 | 单节点只读视图 |

Telemetry Platform 不接受上述产品的 Task/Control Command。
