# 10. Query API 与读模型

## 1. API 原则

- 全部只读；
- 每个响应返回 `asOf`, `watermark`, `freshness`, `sourceCoverage`;
- Current 表示“当前分析投影”，不等于 Runtime Authority；
- 结果必须可返回 Evidence/Lineage 引用；
- 大查询异步返回 Query Job。

## 2. 核心资源

```text
/nodes/{nodeId}/timeline
/tasks/{taskId}/timeline
/tasks/{taskId}/capability-chain
/capabilities/{capabilityId}/history
/capabilities/{capabilityId}/quality
/skills/{skillId}/executions
/providers/{sourceId}/{providerId}/timeline
/resources/{sourceId}/{providerId}/{resourceId}/state
/reconciliation/tasks
/evaluations
/quality-issues
/watermarks
/lineage/{recordId}
```

## 3. 消费方

- SDAR Node Console：单节点时间线、能力质量和 Provider 对账；
- Global Supervision Platform：只读全局证据和偏差输入；
- Global Interaction Hub：证据化查询和解释；
- 运维人员：质量、水位、Replay、DLQ；
- 评价器：固定版本和 Watermark 的批量读取。
