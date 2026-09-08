# SDAR Telemetry MCP Tasks Provider Closure Sync — Codex Goal Package V1.0

本任务包用于 `zhouwen-giser/sdar-telemetry-platform`。

目标不是重新建设采集系统，而是在现有 `sdar.evidence/v1`、SMPP ProviderOps、Provider Closure v2 和 Benchmark Handoff 基础上，补齐 MCP Tasks 新语义的消费、规范化、身份闭包、dispatch uncertainty / reconciliation、四轴 terminal、readiness 与 immutable snapshot 计算。

## 冻结目标

- Target repository: `zhouwen-giser/sdar-telemetry-platform`
- Frozen base: `main@3e43350dd0d0e37fe65ec318d0d9881820a88f5a`
- New work branch: `codex/smpp-mcp-tasks-provider-closure-sync-v0.1`
- Existing formal Provider handoff: `sdar.telemetry-smpp-providerops-handoff/v2`
- Existing ClickHouse warehouse contract: `1.5.1-rc.2`
- No new UGV-specific warehouse table.
- No Provider private DB/HTTP collector.
- No Benchmark scoring logic in Telemetry.
- No physical-success or Goal-success inference.
- No device navigation is authorized by this task.

## 使用方式

1. 将本任务包放到 Codex 可读取位置。
2. 让 Codex 从 `CODEX_GOAL.md` 开始。
3. Codex 必须先执行 Phase T0 的 Source Lock / Gap Audit；不得直接按文档假设当前 HEAD 未变化。
4. 所有跨仓库依赖只读检查；本任务只改 `sdar-telemetry-platform`。
5. 只有全部 acceptance gates 通过时，才允许输出完成 token：

`SDAR_TELEMETRY_MCP_TASKS_PROVIDER_CLOSURE_SYNC_V0_1_COMPLETE`

## 核心设计原则

Runtime binding 只负责选择 authoritative Remote Task / Provider tuple；SMPP Provider telemetry 只负责被选 Provider Task 内部的 Provider execution/business facts。Origin/trace/correlation/relation hints 不得选择事实或覆盖 Runtime binding。

因此需要区分：

- Binding authority — Runtime `mcp_task.remote_binding`
- Provider execution identity authority — 已被 binding 选中的 Provider Task 内，由冻结 ProviderOps payload / relation contract 提供
- Reconciliation hints — 仅辅助核对，不得改变 binding
- Physical truth — 不属于本仓库
- Evaluation rules / M1-M15 / HG / Fatal — 不属于本仓库
