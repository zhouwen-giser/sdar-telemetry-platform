# SDAR Telemetry — SMPP ProviderOps 增量 Codex Goal 任务包 V1.0

本包是以下完整任务包的**增量补充**，不是替代品：

```text
SDAR_Telemetry_Domain_Projection_Benchmark_Handoff_Codex_Goal_Package_V1.0.zip
SHA-256: 27d37f641477236409ab5bc9d6a8d203c9f89c25edfcfe96302d376ff984ed0e
```

增量目标是补齐此前遗漏的链路：

```text
sdar-mcp-provider-platform
→ smpp-telemetry-platform
→ ProviderOps Canonical/Core/Relation
→ SDAR shared ClickHouse external_provider_fact / external_entity_relation_fact
→ sdar-telemetry-platform consumer/readiness/reconciliation
→ sdar-benchmark-server handoff
```

## 使用方法

1. 将本 ZIP 与上一版完整任务包同时交给 Codex。
2. 先执行 `SOURCE_LOCK.json` 和 `DECISIONS.json` 审计。
3. 完整读取 `CODEX_GOAL_INCREMENT.md`、docs 和 matrices。
4. 本包使用 `S0..S10` 增量阶段，不重编号或重做父任务 Phase 0..17。
5. 只有增量 G-SMPP-01..28 全部通过后，才可输出增量完成标志。

## 关键架构决定

- 不在 SDAR Telemetry 中重复接收 SMPP OTLP。
- 不以轮询 SMPP Query API 作为权威主链。
- 由 SMPP Processor 使用独立 Target Checkpoint 把 source-neutral facts/relations 投影到 SDAR warehouse。
- 当前 SMPP `tableMap` 只改表名，不能转换不同 Row Shape；必须实现 typed SDAR target mapper。
- SDAR Telemetry 负责消费、完整性、关系和 Benchmark handoff；不实现 Provider 权威逻辑或 Benchmark 评分。

## 文件

- `CODEX_GOAL_INCREMENT.md`：主增量 Goal。
- `SOURCE_LOCK.json`：三仓库/合同锁。
- `DECISIONS.json`：增量架构决定。
- `docs/`：实现设计和边界。
- `matrices/`：字段、接口、阶段、门禁和错误分类。
- `references/`：父 Goal 与 SDAR ClickHouse Migration 12 快照。
