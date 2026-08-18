# Benchmark Handoff 增量

## 新 Handoff

```text
integrations/sdar-benchmark-server/mcp-provider-telemetry/v1/
```

## 可支持的评价维度

- M7：Provider 依赖、资源、时序一致性；
- M10：Provider recovery、TTL、重试与恢复过程；
- M11：Command/Task 执行、幂等与重复副作用旁证；
- M13：跨 Runtime/Provider Evidence Chain；
- HG4：Action/Receipt/Provider execution 证据完整性旁证；
- HG7：Runtime Outcome 与 Provider terminal 一致性旁证；
- F4：重复 Provider command/task 副作用旁证；
- F5：Runtime 宣告成功但 Provider 明确失败的冲突证据。

## 明确不能证明

- Provider completed 不能单独证明 M14 Physical/Business Verification；
- Provider terminal 不能单独证明 Goal achieved；
- Resource healthy 不能证明任务目标完成；
- 缺失 Provider telemetry 是 Readiness 问题，不是 Agent 0 分。

## Consumer Contract

必须提供：

```text
SmppProviderFact
SmppEntityRelation
McpProviderTelemetrySnapshot
McpProviderReadiness
McpProviderReconciliationIssue
```

所有对象携带 source release、projection identity/version、watermark 和 content hash。
