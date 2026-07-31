# 09. 证据、评价和质量

## 1. 三层评价独立

- application evaluator 只读 `sdar_commander` 或 `sdar_npc`；
- embodied evaluator 只读 `sdar_embodied`；
- general evaluator 只读 `sdar_core`；
- 分数、Metric、Gate、Fatal 不跨层复制。

## 2. 正式证据

- required transactional：禁止采样；
- supporting：可用于解释、质量与事故调查；
- diagnostic：不能证明业务成功；
- ProviderOps 默认 supporting/operational；
- Skill Hard Gate 仍使用 Provider 返回的正式 Evidence Items。

## 3. Data Quality 级别

```text
blocking
warning
informational
```

Blocking 示例：

- 同 ID 不同 Hash；
- required Evidence Sequence 缺口；
- Crosswalk 冲突；
- 跨租户 Route；
- Secret 泄漏；
- Projection 目标写错权威表；
- Task Capability Binding 与 Skill Attempt 不可解析；
- SDAR/Provider 同 Revision Terminal 冲突。

## 4. Issue 生命周期

```text
open → acknowledged → resolving → resolved
                          ↘ waived（需审批和有效期）
```

Quality Issue 不直接改变 Runtime。
