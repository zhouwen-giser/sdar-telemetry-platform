# 评价存储与版本契约

`sdar_mart` 使用四张权威表保存评价结果：

- `evaluation_result`：评价结果版本和提交标记；
- `evaluation_metric_result`：单项指标分数；
- `evaluation_gate_result`：硬门槛判定；
- `evaluation_fatal_error`：致命错误事实。

`general_*`、`embodied_*`、`commander_*`、`npc_*` 是兼容查询视图，不是独立的评价事实源。

## v1.3 Evaluation Readiness 边界

`sdar_core.evaluation_readiness` 的 `ready/degraded/not_ready` 只回答“冻结水位之前的证据是否完整”，不回答“任务得分多少、Gate 是否通过或是否发生 Fatal”。v1.3 追加检查 Skill 使用快照、候选与适用性、上下文解析、选择/模式/组合、Capability Slot、计划合规、执行树、失败传播和证据要求的完整性，并记录未解决 Skill 执行数量。

只有 readiness 满足选定 Profile 的证据要求后，general evaluator 才能冻结 evidence snapshot 并独立计算 Metric/Gate/Fatal。`evaluation_role=required` 表示该记录可能阻断 readiness；`supporting/diagnostic` 不是低分或无效证据。三种角色都不能直接转换成分数。

## 评价层级

`evaluation_scope` 与 `adapter` 是两个正交维度：

| evaluation_scope | adapter | 含义 |
|---|---|---|
| `application` | `commander` / `npc` | 领域应用实现范式评价 |
| `domain` | `commander` / `npc` | Embodied-Control 领域闭环评价 |
| `general` | `sdar` | SDAR 通用范式评价 |

三个 scope 必须分别生成结果，不得把应用分数上卷为领域或通用分数。不同 scope 可以引用同一批底层证据，但必须使用各自的 `evaluation_id`、规则集和评价结论。同一 Episode 的应用、领域和通用结果可以共享一个 `evaluation_group_id`用于横向对比，但任一层评价器都不得读取另一层的分数作为输入。

`domain` 当前只有 `commander` 和 `npc` 两个已定义 adapter。混合 Episode 必须先发布新 profile/规则集版本，不能用 `embodied` 或 `mixed` 绕过 meta 定义匹配。

## 框架、Profile 和三套规则版本不得混用

领域评价建议值为：

```text
framework              = SDAR
framework_version      = 2.0
profile                = embodied-control
profile_version        = 1.0
metric_set_version     = 2.1-review1
gate_set_version       = 2.1-review1
fatal_set_version      = 2.1-review1
```

`framework_version` 是 SDAR Core 版本，`profile_version` 是 Embodied-Control Profile Schema 版本。M1–M15 指标、HG1–HG7 门槛和 F1–F7 致命规则分别由 `metric_set_*`、`gate_set_*` 和 `fatal_set_*` 绑定，三者必须可独立升级。当前三套 version 可以恰好使用同一文本，但不表示它们是同一版本轴。

每套规则都必须同时固化 `id + version + hash`。修改指标权重只升级 metric set，修改门槛判据只升级 gate set，修改致命错误检测只升级 fatal set；三者都不得伪装成 Schema 版本变更。

`*_set_id` 标识稳定的规则集家族，`*_set_version` 对应 `sdar_meta.evaluation_profile_definition` 及各 definition 表选中的版本，`*_set_hash` 是该版本全部生效定义按规范顺序序列化后的 SHA-256。评价器启动后必须固定这三组值，不得仅保存 version 文本。

## 规则集登记与哈希规范

`sdar_meta.evaluation_rule_set_definition` 是规则集的权威登记表。其稳定逻辑键为完整 Profile 身份 `framework + framework_version + evaluation_tier + profile + profile_version`，再加 `rule_set_kind + rule_set_id + rule_set_version`。`rule_set_kind` 只取 `metric`、`gate` 或 `fatal`；`definition_count` 用于防止规则丢失仍被当成完整规则集。

四个内置 Profile 分别使用稳定家族 ID：

| Profile | metric / gate / fatal set ID |
|---|---|
| `application.commander-application` | `application.commander-application.metrics` / `application.commander-application.gates` / `application.commander-application.fatals` |
| `application.npc-application` | `application.npc-application.metrics` / `application.npc-application.gates` / `application.npc-application.fatals` |
| `domain.embodied-control` | `domain.embodied-control.metrics` / `domain.embodied-control.gates` / `domain.embodied-control.fatals` |
| `general.core-general` | `general.core-general.metrics` / `general.core-general.gates` / `general.core-general.fatals` |

`canonicalization_version=sdar-rule-set-c14n-v1` 的字节规范如下，ClickHouse 24.8 可直接重算：

1. 每条定义按固定字段顺序构造 Tuple，再执行 `toJSONString(tuple(...))`。Metric 依次覆盖 ID/版本、维度、名称/描述、权重/最大原始分、评分规则、证据类型、最高分最低证据级别及 required；Gate 覆盖 ID/版本、名称/描述、通过条件、证据类型、规则 JSON 及失败级别；Fatal 将其中的通过条件替换为检出条件。
2. 按规则 ID 的 UTF-8 字节升序排列；ID 相同时按数值版本升序排列。
3. 使用单个 U+001E（record separator）连接各条 JSON，首尾不添加分隔符。
4. 对连接后的 UTF-8 字节计算 SHA-256，以 64 位小写十六进制存入 `rule_set_hash`。

Tuple 中的 `*_rule_json` 和评分规则字段按其已存储字符串参与哈希，不再解析或重排 JSON key；Array 元素顺序同样是语义的一部分。如果上游需要“等价 JSON 得到同一 hash”，必须在写入 definition 前统一 key 顺序、数字格式和空白。`tenant_id`、`project_id`、`record_id`、`status`、时间戳和传输序号不进入哈希；因此发布状态变化不会伪造新内容。

Profile 通过三组 `*_set_id + *_set_version` 唯一关联登记表，评价器必须把关联行的 `rule_set_hash` 写入 Mart。任何上述语义字段、规则数量或顺序变化都必须发布新的 set version，不得在同一 `id + version` 下改写 hash。

## Adapter 特殊规则

`sdar_meta.evaluation_profile_definition.evaluation_policy_json` 是 adapter 规则集身份的一部分，不是可以只隐式写在评价器代码中的运行时开关。当前 application profile 中至少包含以下 adapter 特殊语义：

- `commander`：快/慢路径的判定与评分规则，以及物理动作必须满足的完成约束；
- `npc`：无 LLM 计划不扣分、Mission 提前推进的评分规则，以及其与 HG6 和攻击前置 F1–F3 的对应关系。

评价器必须对选中 profile 的 policy 做规范化序列化，将其内容纳入 evaluator config 快照及 `evaluator_config_hash`，并由结果的 payload hash 间接锁定。policy 变更必须发布新的相关 metric/gate/fatal set 版本并生成新 `result_version`；不得在 id/version/hash 不变的情况下仅通过部署新代码改变评价结果。

## 可重放和不可变性

`evaluation_id` 标识一条稳定的评价流，`result_version` 标识该流中一份不可变的结果快照。

- 相同 `evaluation_id + result_version` 的所有父子行必须共享相同的 `evaluation_group_id`、metric/gate/fatal set、evaluator、projection、evidence snapshot 和 watermark。
- `row_version` 只是同一物理载荷的传输重试序号，不是语义版本。
- 父表的 `result_payload_hash` 和子表的 `row_payload_hash` 必须由规范化载荷计算，必须覆盖 `evaluation_group_id`、scope/adapter、三套规则集、evaluator、projection、evidence snapshot/watermark 及结果内容；不包含 `record_id`、`row_version`和 `ingested_at` 等传输字段。
- 相同逻辑键和 `result_version` 出现不同 payload hash 是非确定性重算或非法改写，必须由 `v_evaluation_duplicate_payload_conflict` 报警。
- 任何规则集、指标、证据、分数或结论变更都必须新增 `result_version`。

四张表使用 `evaluation_id` 哈希稳定分区，并把 `result_version + payload_hash` 放入排序键。相同 Hash 的传输重试由 `ReplacingMergeTree` 收敛；同一 result version 的不同 Hash 会永久共存以供冲突报警；新版本也不会被合并掉或因评价时间变化跨月分区。

`v_evaluation_*_versioned` 按 `result_version` 保留每个不可变版本的一个确定性物理重试，用于历史重放和质量检查。`v_evaluation_*_latest` 和 `v_evaluation_*_current` 只返回每条 evaluation stream 的最大 `result_version`。`general_*`、`embodied_*`、`commander_*`、`npc_*` 旧名兼容视图只读 latest，避免旧查询因历史版本重复计数。

## 证据快照与水位

每个结果版本必须固化：

- `evidence_snapshot_id` 和 `evidence_snapshot_hash`；
- `evidence_watermark_sequence` 和 `evidence_watermark_at`；
- `projection_id` 和 `projection_version`；
- `metric_set_id/version/hash`、`gate_set_id/version/hash` 和 `fatal_set_id/version/hash`；
- `evaluator_id/type/version/config_hash`。

评价重放必须从已固化的 snapshot 读取，不得对当前不断变化的表直接重算后覆盖原版本。

## 子表提交顺序

ClickHouse 不提供跨四表事务。写入程序必须：

1. 冻结证据快照并计算所有 hash；
2. 写入 metric/gate/fatal 子行；
3. 最后写入 `evaluation_result` 父行作为提交标记。

`*_committed` 在历史重放层只暴露已存在对应父行的子行；latest/current 和旧名兼容视图进一步只暴露最新父版本的子行。`v_evaluation_orphan_child` 用于发现长期未提交的子行，应结合写入 SLA 设置告警窗口。

## 证据引用

指标、门槛和致命错误使用结构化 `EvidenceRef` 数组，保存：

```text
evidence_type, evidence_id, relation,
schema_ref, storage_ref, payload_hash
```

兼容视图中的 `evidence_refs Array(String)` 仅投影 `evidence_id`，不应作为新评价器的写入格式。

## Minimal 采集限制

`collection_profile=minimal` 可用于 NPC 轻量应用回归，但不能支撑完整领域或通用评价：

- application scope 可以输出受限结果；
- domain/general scope 必须输出 `evaluation_status=insufficient_evidence`、`level=NE`、`passed=0`；
- E2 证据、M3/M13/M14 正分以及 HG2/HG5/HG6 pass 不得从 minimal 记录推导。

## 评分约束

- `raw_score` 只能是 0/1/2；
- `weighted_score = weight * raw_score / 2`；
- `score = raw_weighted_score / applicable_weight * 100`（无适用权重时三者均为 0）；
- 默认通过线为 75，`passed=1` 只允许对应 S/A/B；
- N/A 必须 `applicable=0`、分数为 0 并记录原因；
- E0 只能评 0，E1 最高评 1；
- gate pass 必须有 E2 结构化证据；
- fatal error 必须有结构化证据引用。

`v_evaluation_provenance_mismatch`、`v_evaluation_outcome_inconsistent`、`v_evaluation_score_reconciliation_issue`、`v_evaluation_duplicate_payload_conflict` 和 `v_evaluation_rule_set_registry_mismatch` 应作为发布前必查视图。最后一个视图要求每份正式结果声明的三套规则身份/Hash 各唯一命中一条 `active` registry；引用 `draft` 规则只适合离线试算，不能进入发布 cohort。

## 已有库升级

`06_sdar_mart.sql` 是新建库 DDL。旧版已经存在同名 `general_*`、`embodied_*`、`commander_*`、`npc_*` 物理表时，`CREATE VIEW IF NOT EXISTS` 不会用兼容视图替换它们。上线前必须单独执行数据回填、核对 hash/版本轴、重命名旧表，再创建兼容视图；不得将本文件直接当作无损在线升级脚本。
