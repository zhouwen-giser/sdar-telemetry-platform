# 输入规范对齐与取舍

本页记录建库基线对三份输入文档的解释。它不是声称三份文档天然一致；相反，所有不能安全自动推断的差异都被显式保留或拒绝。

## 1. 规范优先级

| 范围 | 采用的权威输入 | 本包版本表达 |
|---|---|---|
| 通用证据与 Skill 事实 | `SDAR v1.3 Skill-aware Frozen Bundle` | Runtime `1.3.0` / Schema 文档 `V1.2` / `sdar.evidence/v1` |
| 具身领域/应用事实 | `SDAR_Embodied_Control_Data_Schema_V1.0.md` 及 JSON Schema | data schema `1.0.0` |
| 具身指标、门槛、致命错误 | `车长智能体与NPC智能体评价指标_待评审.md` | metric set `2.1-review1`, status `draft` |
| 评价结果外壳 | `schemas/sdar_runtime/evaluation_result.schema.json` | framework `2.0`, profile `1.0` |
| ClickHouse 物理实现 | 本包 migrations | release `1.2.0` |

指标集仍为 `draft`。DDL 可以存储并重放该版本，但上线发布测试必须先把对应定义版本审批为 active；不能因为 seed 已存在就视为指标已评审通过。

v1.3 冻结决策 D-01 明确把原 v1.2 遥测升级为 v1.3，不建立并行遥测版本。因此 v1.2 文档只用于解释历史数据；新采集只接受 Canonical Evidence Envelope。Frozen DDL 中与本包既有 `schema_definition`、`data_quality_rule`、`projection_version` 重名但结构更窄的表没有重复创建，而是保留当前多租户控制面合同；唯一新增的 Meta 物理表为 `evidence_policy`。

## 2. 已发现的关键冲突

| 冲突 | 风险 | 本包处理 |
|---|---|---|
| 待评审稿标题为 `SDAR-Embodied V2.1`，结果 JSON 固定 framework `2.0` / profile `1.0` | 同一个 version 字段无法判断是在说框架、Profile 还是规则 | 拆分 `framework_version`、`profile_version` 以及独立的 metric/gate/fatal set version；领域三套规则当前都使用文本 `2.1-review1`，但版本轴彼此独立 |
| 待评审稿五维权重为 `22/20/22/21/15`，结果 JSON 的维度上限暗含 `20/25/20/20/15` | 总分可重复计算但维度分无法验证 | seed 采用待评审稿 M1–M15 及 `22/20/22/21/15`；结果表保存维度定义版本和适用权重，不使用旧上限作为事实约束 |
| 领域 JSON 的 Episode `environment` 是物理运行环境，通用信封 `environment` 是部署环境 | 把 `simulation` 写进 `dev/test/staging/prod` 会污染通用筛选 | 入库时前者重命名为 `runtime_environment`；仓库公共列 `environment` 保存部署环境，两者在 `domain_projection_context` 独立保留 |
| 领域 `agentType=commander/npc`，通用信封规定 `agent_type=sdar` | 直接复制会破坏通用 Schema | 通用事实写 `sdar`；来源类型进入 lineage/sidecar |
| 领域 `sequence` 是 Episode 顺序，通用 `sequence` 是 Run 顺序 | 多 Run 或多源合并时出现伪缺口、重复号 | 当前 P1 合同采用“一 Episode 一 Run”，强制 `run_sequence=episode_sequence`，P2 原样透传；未来拆分多 Run 必须发布新投影合同，不能在 P2 临时重编号 |
| 领域 Episode type/status 集合与通用集合不同 | 字符串同名不等于同一状态机 | 使用版本化映射规则；原值与目标值同时保存，无法确定时进入 DLQ/人工规则而不是猜测 |
| 领域 Basis type 表示计划/SOP/行为树等“依据种类”，通用 Basis type 表示 planning/decision/action 等“使用阶段” | 直接 enum 映射会改变语义 | `source_basis_type` 与 `basis_purpose` 分列；按目标事实使用阶段确定通用值 |
| 领域 Receipt 为 transport/acceptance/execution，通用 Receipt 为 transport/executor/business | “调用成功”等同“业务成功” | 三组来源状态均保留；映射不得把 accepted 或 transport success 推断为 business succeeded |
| NPC 最小采集缺少完整状态、控制权与物理验证 | 默认值会伪造高分证据 | `freshness_ms=NULL`；readiness 标记缺证；Gate/Verification 不能自动通过 |
| ReplacingMergeTree 原设计按发生月份分区 | 同一逻辑键跨月修订永远不会合并 | 所有可变实体改为实体 Hash 稳定分区，版本列参与 latest 选择 |
| 原评价父表可替换、子表仅追加且按月分区 | 父子可能来自不同结果版本 | 权威结果及明细共享 `evaluation_group_id`、`evaluation_id + result_version`、三套规则身份和 evidence snapshot，并使用稳定分区 |
| v1.1 `delivery_class/required_for_evaluation` 与 v1.3 两个正交枚举并存 | 将交付方式误当评价用途，或把 supporting 记录误删 | 新写入使用 `delivery_guarantee/evaluation_role`；旧列仅作迁移兼容，必须经 `evidence_policy` 显式转换 |
| Frozen DDL 是独立模板，Meta 表没有项目现有租户字段 | 直接执行会与已发布表重名或破坏控制面逻辑键 | 17 张 Core 表保持冻结结构；Meta 策略表适配 `tenant_id/project_id/status/updated_at`，其余既有表只追加列 |
| OTel span 与正式证据边界不清 | 仅有 trace 可观测性却被错误用于评价 | OTel 仅传递 trace/span context；正式证据必须由权威事务边界的 Journal/Outbox 产生并通过 Schema/Policy 校验 |

## 3. 映射的确定性边界

以下转换允许自动执行：

- 规范化 String ID → UUIDv5；
- 来源字段改名且值域语义完全相同；
- `transportStatus: ok/error` → `success/failure`；
- 明确的状态同义词映射，例如领域 `active` → 通用 `running`；
- 由完整时间戳计算 `freshness_ms`；
- 可验证的 EvidenceRef、Hash 和父子血缘复制。

以下转换禁止仅凭缺省值完成：

- 物理环境 → 部署环境；
- accepted/transport success → business succeeded；
- 工具返回成功 → Verification pass；
- 未采集 freshness → `0`；
- 领域分数 → 通用分数，或应用分数 → 领域分数；
- 缺少父记录时自行构造因果链；
- 缺少 remote task 生命周期时推断其已完成。

禁止项必须由部署配置、额外事实或人工映射规则解决；否则标记 degraded/not_ready。

## 4. 覆盖性结论

- 三套输入均有原始载荷落点和类型化事实落点。
- 车长/NPC 应用事实可以先投影为完整领域事实，再投影为通用事实。
- P1/P2 均有定义版本、运行批次、检查点、DLQ、ID 交叉表和直接/根血缘。
- 应用、领域、通用评价分别有独立事实输入、证据快照、结果版本和兼容查询视图。
- 质量视图覆盖最新状态、Hash 冲突、序号 prefix/trailing、缺回执/缺验证、控制冲突、P1/P2 registry 引用、raw/index 重放闭环、评价规则集 registry 和 readiness。

仍需业务方审批的内容：`2.1-review1` 指标权重与门槛、Episode 状态映射表、Basis 使用阶段规则、Receipt 的超时/未知状态策略，以及不同部署的 retention 与脱敏策略。
