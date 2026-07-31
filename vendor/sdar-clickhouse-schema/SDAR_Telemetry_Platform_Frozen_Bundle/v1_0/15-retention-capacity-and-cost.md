# 15. 保留、容量与成本

## 1. 默认保留

| 记录族 | 默认 |
|---|---:|
| Task/Decision/Action/Verification/Capability Contract | 1095 天 |
| Provider Task/Command/Scheduler/Recovery | 365～1095 天 |
| Resource State/Health/Execution Progress | 365 天 |
| Adapter RPC/Diagnostic | 180 天 |
| Resource Metric/Measurement | 30～180 天 |
| Evaluation Result/Evidence Snapshot | 1095 天 |
| Audit/Schema/Projection Definition | 长期 |

## 2. 高频数据

- Measurement 独立 Projection Set；
- 可关闭或降低频率；
- 不得对 required evidence 采样；
- 原始大对象只保存引用；
- 容量模型必须按 Source × Records/s × Retention × Compression 计算。

## 3. SLO 草案

- required Evidence durable ACK：P95 ≤ 500 ms（同机/局域网目标）；
- Query 小范围时间线：P95 ≤ 2 s；
- Projection Freshness：一般事实 ≤ 30 s；
- Blocking DQ 检出：≤ 60 s；
- 平台故障对 Runtime Task 影响：0。
