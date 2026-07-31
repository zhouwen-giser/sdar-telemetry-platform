# 03. 权威边界

| 对象 | 权威 |
|---|---|
| Goal/Task/Workflow/Skill Execution | SDAR Runtime PostgreSQL |
| Capability Definition/A2A Exposure/Config Revision | Node Control Plane PostgreSQL |
| MCP Tool Catalog | Runtime `server/discover + tools/list` |
| Resource Availability | Provider 在线 Availability |
| Provider Task/Command/Scheduler/Recovery | SMPP Runtime Database |
| 正式证据原始事务 | 各来源 Journal/Outbox |
| Telemetry WAL 和 Projection Checkpoint | Telemetry Platform Control DB/WAL |
| ClickHouse Fact/Relation | Telemetry Projection |
| 历史评价结果 | `sdar_mart` |
| 当前在线状态 | 对应 Runtime/Provider API，不是 Query API |
| 历史时间线、质量、对账 | Telemetry Query API |

## 不变量

```text
Telemetry observed status
≠ Runtime authoritative status

Provider terminal fact
≠ SDAR Task terminal

OTel span success
≠ business success

Evaluation readiness
≠ evaluation passed
```
