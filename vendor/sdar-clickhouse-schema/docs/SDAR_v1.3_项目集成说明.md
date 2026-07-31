# SDAR v1.3 项目集成说明

## 版本与权威边界

本项目从 SDAR Runtime `v1.2` 升级到 `v1.3.0`，采用 Schema 文档修订 `V1.2` 和 Evidence Family `sdar.evidence/v1`。冻结日期为 2026-07-17。原 v1.2 遥测合同已被升级取代，不作为并行的新写入口；其字段仅用于历史数据回放。

冻结原件及校验摘要保存在 [`../SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/`](../SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/)，运行 Schema 保存在 [`../schemas/sdar_runtime/v1_3_skill_aware/`](../schemas/sdar_runtime/v1_3_skill_aware/)。

## 数据流

```text
PostgreSQL authoritative transaction
  └─ Journal / Outbox
       └─ Exporter（at-least-once）
            └─ Collector
                 ├─ sdar_core.raw_envelope
                 ├─ sdar_core.skill_* / existing typed facts
                 ├─ sdar_core.evidence_index
                 └─ sdar_meta.evidence_policy

Commander/NPC → application facts → P1 → sdar_embodied → P2 → sdar_core
```

业务 Domain/Application 层不直接调用遥测 API。基础设施在权威事务边界生成正式证据；OpenTelemetry 只提供上下文传播和运维可观测性，普通 span 不具有评价证据地位。

## ClickHouse 适配

ClickHouse 包版本升级为 `1.2.0`，六库边界不变。`migrations/10_sdar_v1_3_skill_aware.sql` 以追加方式完成：

- 新增 17 张 Skill 一级事实表；
- 新增多租户 `sdar_meta.evidence_policy` 并写入 18 条冻结策略；
- 给计划、步骤、执行依据、决策、行动、回执、远程任务、验证和结果追加 Skill 执行关联；
- 给 raw/index 追加 Canonical Envelope、Skill、Aggregate 和结构化 EvidenceRef 列；
- 给 evaluation readiness 追加 12 个 Skill 完整性标志和未解决执行计数。

Frozen DDL 中 `schema_definition/data_quality_rule/projection_version` 与项目既有控制面同名但结构更窄，因此没有重复创建或覆盖；继续使用项目已有的多租户版本。Frozen 的 `evidence_policy` 则作为新表适配租户、状态和更新时间字段。

## 兼容和切换规则

| 旧字段 | v1.3 正式字段 | 规则 |
|---|---|---|
| `delivery_class` | `delivery_guarantee` | 按 record policy 映射为 `transactional/buffered`，禁止字符串猜测 |
| `required_for_evaluation` | `evaluation_role` | 布尔值不足以区分 `supporting/diagnostic`，必须查 policy |
| `evidence_refs Array(String)` | `evidence_refs_json` | 新列保存完整结构化引用；旧列只作 ID 兼容 |
| v1.2 telemetry envelope | v1.3 canonical envelope | 停止新写，历史读取保留 |

交付保证和评价角色正交。`transactional|required` 禁止采样；同 `record_id + payload_hash` 是幂等重投，同 ID 异 Hash 是阻断冲突。Readiness 只判定证据完整度，不能转换成 Metric、Gate、Fatal 或得分。

Commander/NPC/Embodied 合同版本没有因 Runtime 升级而自动改变。P1/P2 只能投影来源中已经明确存在的 Skill 语义，不能从工具名、节点名或日志文本补造 Skill 事实。应用、领域、通用三层评价继续独立。

## 上线核对

1. 校验冻结文件 Hash 和所有 Draft 2020-12 示例。
2. 在隔离 ClickHouse 执行 00–10；确认 191 张物理表、63 个视图和 18 条 v1.3 Evidence Policy。
3. 先部署 Journal/Outbox，再部署 Exporter/Collector，观察至少一次重投与异 Hash 冲突处理。
4. 验证 transactional evidence sequence、Skill 执行树和 readiness 完整性。
5. 固定 evidence snapshot 后，分别启动 application/domain/general evaluator；不搬运旧层分数。
