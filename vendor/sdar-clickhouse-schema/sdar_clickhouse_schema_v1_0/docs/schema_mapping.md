# Schema 与跨层映射

本页描述“哪类输入进入哪张表”及 P1/P2 的字段语义。确定性 UUID、消费位点和失败恢复的算法细节以 `projection_contract.md` 为准。

## 1. 采集落点

### SDAR Runtime

v1.3 `CanonicalEvidenceEnvelope` 原文进入 `sdar_core.raw_envelope`，同时按 `record_type` 列化到通用事实表。正式字段映射如下；旧列只供历史兼容：

| v1.3 Envelope | ClickHouse | 兼容说明 |
|---|---|---|
| `evidenceFamily` | `evidence_family` | 固定 `sdar.evidence/v1` |
| `recordType` | `record_type` | 选择 typed table 与 `evidence_policy` |
| `deliveryGuarantee` | `delivery_guarantee` | `transactional/buffered`；不能从 required 与否推导 |
| `evaluationRole` | `evaluation_role` | `required/supporting/diagnostic`；不能从交付方式推导 |
| `aggregateType/aggregateId` | `aggregate_type/aggregate_id` | 权威事务聚合身份 |
| `evidenceRefs` | `evidence_refs_json` | v1.3 结构化引用；旧 `evidence_refs Array(String)` 只保留 ID |
| `skill*` / `usageSpec*` / composition / recursion | 同名 snake_case 列 | 关联 Skill 执行树和使用规范快照 |

相同 `record_id + payload_hash` 是幂等重投；相同 `record_id` 出现不同 Hash 是不可覆盖的冲突。`transactional` 必须有连续 `evidence_sequence`，required transactional 禁止采样。

Skill-aware 一级事实新增落点：

| 阶段 | `sdar_core` 表 |
|---|---|
| 使用规范与候选 | `skill_usage_snapshot`、`skill_candidate_record`、`skill_applicability_record`、`skill_context_resolution` |
| 选择、模式与组合 | `skill_selection_record`、`skill_mode_selection`、`skill_composition_record`、`skill_composition_edge`、`skill_capability_slot_resolution` |
| 解释、编译与合规 | `skill_interpretation_record`、`skill_procedure_compilation`、`skill_plan_compliance` |
| 执行树与失败 | `skill_execution_record`、`skill_execution_relation`、`skill_failure_propagation` |
| 证据要求与改进 | `skill_evidence_requirement`、`skill_patch_candidate` |

既有 `plan_record/plan_step/execution_basis/decision_record/action_record/action_receipt/remote_task_binding/verification_record/episode_outcome` 通过 `skill_execution_id/root_skill_execution_id/parent_skill_execution_id` 和 Skill/组合/合规字段关联上述一级事实。

其他非 Skill 通用事实仍按 `event_type` 列化：

| 事实组 | `sdar_core` 表 |
|---|---|
| Episode/Run | `episode`、`run_segment`、`run_seal` |
| 请求与 A2A | `request_record`、`a2a_task_state` |
| 目标与计划 | `goal_record`、`constraint_record`、`success_criterion`、`goal_assumption`、`plan_record`、`plan_step` |
| 状态与事件 | `execution_basis`、`state_snapshot`、`state_transition`、`event_record`、`state_trajectory` |
| 决策与控制 | `decision_record`、`policy_decision`、`execution_gate_decision`、`human_confirmation`、`action_record`、`action_receipt`、`verification_record`、`episode_outcome` |
| 模型/工具/记忆 | `model_call_record`、`tool_call_record`、`memory_operation_record` |
| Remote Task | `task_availability_check`、`remote_task_binding`、`remote_task_observation`、`remote_task_control_event`、`remote_task_poll_attempt`、`remote_task_input_link`、`remote_task_cancel`、`remote_task_reconciliation` |
| Continuation | `workflow_continuation_snapshot`、`workflow_continuation_attempt` |
| 证据质量 | `evidence_index`、`artifact_reference`、`evaluation_readiness`、`evidence_quality_issue`、`ingestion_dead_letter` |

Runtime 原生事实不经过 P1/P2；它们直接接受通用 Schema 校验，并只参加 general 评价。

### 车长与 NPC

两套应用库的公共领域 Schema 同构：

```text
raw_record / episode_metadata / trigger_record / goal_record
success_criterion / constraint_record / state_snapshot / state_delta / event_record
execution_basis / decision_record / gate_decision / confirmation_record
action_record / receipt_record / verification_record
failure_record / recovery_record / remaining_item / trajectory_step
operational_metric / final_outcome / evidence_index / entity_ref / resource_claim
episode_evidence_bundle_manifest / evaluation_readiness
```

车长专用节点、路由、Plan/SOP、MCP 与报告明细保存在 `sdar_commander`；NPC Tick、Blackboard、Threat/Utility/BT、Mission/MCP/HMI/抢占明细保存在 `sdar_npc`。这些明细先解释为应用事实，再通过 P1 形成领域事实；原始日志本身不能直接成为高等级评分证据。

## 2. P1：应用事实 → 完整领域事实

| `sdar_commander` / `sdar_npc` | `sdar_embodied` | 主要保留内容 |
|---|---|---|
| `episode_metadata` | `episode` | 来源 String Episode、canonical UUID、adapter、物理运行环境、Profile |
| `trigger_record` | `trigger` | 触发类型、原始输入、对象、状态版本 |
| `goal_record` | `goal` | Goal ID/version、状态、描述、来源 |
| `success_criterion` | `success_criterion` | expected、comparator、critical、验证引用 |
| `constraint_record` | `constraint_record` | 类型、作用域、严重性、有效期 |
| `state_snapshot` | `state_snapshot` | 状态 ID/version、observed time、quality、freshness、domain JSON |
| `state_delta` | `state_delta` | from/to 状态、Patch、合法性检查 |
| `event_record` | `domain_event` | 已发生事实及因果引用 |
| `execution_basis` | `execution_basis` | basis kind/id/version/status、Goal 和 supersedes 版本 |
| `decision_record` | `decision` | 使用的 State 与 Basis 版本、候选、理由、风险 |
| `gate_decision` | `safety_gate_decision` | Gate 结果、风险、审批要求、适用范围 |
| `confirmation_record` | `human_confirmation` | 审批范围、决定、有效期、请求与响应 |
| `action_record` | `control_action` | Basis 版本、Decision、状态、目标、幂等键、执行状态 |
| `receipt_record` | `control_receipt` | transport/acceptance/execution 三层状态 |
| `verification_record` | `verification` | expected/actual/comparator/result/EvidenceRef |
| 物理验证充分的 `verification_record` | `physical_verification` | 设备/目标时间戳、稳定窗口和实际状态证据；不是默认复制 |
| `failure_record` | `failure` | 原失败不可因恢复成功而删除 |
| `recovery_record` | `recovery` | 恢复策略、次数、新 Basis ID/version、验证 |
| 抢占相关 Recovery/专用明细 | `preemption_recovery` | 被抢占/新选/恢复 Basis 的版本化引用 |
| `trajectory_step` | `trajectory_step` | Episode 顺序、前后状态和因果链 |
| `resource_claim` | `resource_claim_event` | acquire/release、owner Basis/action、冲突 |
| `operational_metric` | `operational_metric` | 运行测量值，不是评价分数 |
| `final_outcome` | `final_outcome` | 终态、已完成/剩余事项、关键验证 |
| `evidence_index` | `evidence_index` | 证据类型、Hash、StorageRef、敏感级别 |
| Bundle/Readiness | 同名领域表 | 冻结事实集 Hash、水位和缺证结论 |

状态、控制权、资源、安全门与物理验证还可生成相应专题表。每个专题事实必须关联完整领域证据图中的 State/Event/Decision/Action/Verification，不能成为旁路孤证。

## 3. P2：领域事实 → 通用事实

| `sdar_embodied` | `sdar_core` | 条件 |
|---|---|---|
| `episode` | `episode` | canonical Episode UUID 原样透传 |
| `trigger` | `request_record` 或 `event_record` | 请求类触发映射 Request；已发生的状态/异常/控制触发映射 Event |
| `goal` | `goal_record` | ID/version 稳定，不从 Outcome 反推 |
| `success_criterion` | `success_criterion` | 保留 critical 与验证要求 |
| `constraint_record` | `constraint_record` | 保留来源与作用域 |
| `state_snapshot` | `state_snapshot` | freshness 可空；物理环境进入 sidecar |
| `state_delta` / `trajectory_step` | `state_transition` / `state_trajectory` | 只有前后版本和变化可证明时生成 |
| `domain_event` | `event_record` | 事件仍是事实，不变成状态或结果 |
| `execution_basis` | `execution_basis` | 来源 kind 与通用 purpose 分栏，版本不丢失 |
| `decision` | `decision_record` | 正式 Decision；策略检查可另生成 `policy_decision` |
| `safety_gate_decision` | `execution_gate_decision` | 必须发生在适用 Action 之前 |
| `human_confirmation` | `human_confirmation` | 保留 scope、过期时间和关联行动 |
| `control_action` | `action_record` | Basis ID/version 直接绑定 |
| `control_receipt` | `action_receipt` | 三状态层级按下表转换 |
| `verification` | `verification_record` | physical 专题只补充证据，不重复造同一验证 |
| `failure` / `recovery` / `preemption_recovery` | `event_record` | 以不可变事件表达，不覆盖旧事实 |
| `final_outcome` | `episode_outcome` | partial/remaining items 不能丢失 |
| `evidence_index` | `artifact_reference` / `evidence_refs` | 内容由 URI + SHA-256 引用 |
| Manifest | `artifact_reference` | 保存 bundle Hash、水位、projection version |
| `evaluation_readiness` | `evaluation_readiness` | 追加检查，按 record version 取最新 |

P2 写每个通用事实时还必须写 `sdar_core.domain_projection_context`，其中同时保存直接/根来源、领域与通用枚举、P1/P2 version + contract + mapping hash、来源/目标 Hash、ID/environment/mapping 版本及 `lossless_extension_json`。普通一对一事实使用 `identity_mapping_mode=passthrough` 且目标 record UUID 等于领域 `canonical_record_id`，四个 `target_identity_*` 字段为空；Run/Segment 或一对多派生实体等已由 P1 crosswalk 生成的身份使用 `p1_crosswalk`，并完整记录 source entity type/id/business discriminator/target entity type。通用评价器只读 `sdar_core` 即可完成事实与 Hash 追溯；crosswalk 与 P1/P2 registry 真实性由发布质量检查联查 `sdar_meta`。

每个 P2 通用输出还必须先写同 `record_id/payload_hash/payload_json` 的 `raw_envelope`，再写目标专表；durable 输出同时写同 ID/Hash 的 `evidence_index`。这三份表示与 sidecar 的 `target_payload_hash` 必须一致，否则不能进入 general ready cohort。

## 4. 跨层字段合同

### ID

| 应用层 | 领域层 | 通用层 |
|---|---|---|
| `episode_id String` | `episode_key String` 原样保留；`canonical_episode_id UUID` | `episode_id UUID = canonical_episode_id` |
| `record_id String` | `record_id String` + `canonical_record_id UUID` | `passthrough` 时 `record_id=canonical_record_id`；`p1_crosswalk` 时取预生成 crosswalk 的 `target_id` |
| `basis_id + basis_version` | 所有 Basis 引用仍为 ID + version | ExecutionBasis/Decision/Action 仍为 ID + version |

UUIDv5 namespace 固定为 `5832c301-3d9e-5927-8f15-fa6262c8fc4e`。name 的精确格式为 `sdar-id-v1\u001F{tenant_id}\u001F{project_id}\u001F{source_agent_type}\u001F{source_entity_type}\u001F{normalized_source_id}`，其中 `\u001F` 表示真实 U+001F 字符；各分量执行 NFC、trim 并保留大小写。P2 对 P1 canonical UUID 只透传。

P2 可能从一个领域事实生成多个通用实体时，P1 必须先按目标逻辑 `source_entity_type` 与 `derived-v1` 业务 discriminator 生成并登记全部 crosswalk；crosswalk 逻辑键包含 `business_discriminator + target_entity_type`，不同派生目标不得被 ReplacingMergeTree 合并。P2 只读取这些 `target_id`，不得临时计算或随机生成。发布质量检查必须验证 sidecar 的四个 `target_identity_*` 字段及 `target_record_id` 与 crosswalk 唯一匹配。

### 环境与 Agent

| 来源 | 目标 | 规则 |
|---|---|---|
| 应用公共列 `environment` | 领域/通用 `environment` | 部署环境，只允许明确配置的 `dev/test/staging/prod` |
| Collector/Projector 部署配置 | 领域/sidecar `source_deployment_id` | 必填的部署实例标识；不能由物理环境推导 |
| 来源原始环境值 | 领域/sidecar `source_environment_raw` | 无损保留；已规范来源可与目标环境相同，legacy 值不得覆盖 |
| 显式环境映射 | `environment_mapping_id + environment_map_version` | legacy 或非规范值必须绑定唯一 active 映射行；已规范值允许 mapping ID 为 NULL |
| 应用 Episode `runtime_environment` | 领域 `runtime_environment`、core sidecar | `simulation/field_test/real_vehicle/replay/unknown`，不得推导部署环境 |
| `agent_type=commander/npc` | core `agent_type=sdar` | 来源类型、adapter、agent ID 在 sidecar/attributes 保留 |

同一 mapping version/key 的状态更新必须复用 `deployment_environment_mapping.record_id`；映射内容语义变化必须发布新的 mapping version 并使用新的 record ID，使历史 `environment_mapping_id` 始终可解析。

### 序号

- 应用 `sequence` 与领域 `episode_sequence`：Episode 内顺序；迟到记录由采集端取得新的 Episode 末尾 sequence。
- 当前一 Episode 一 Run 合同中，P1 强制 `run_sequence=episode_sequence`，P2 原样写入 core `sequence`，不得重新分配。
- `evidence_sequence`：只分配给 durable Evidence，从 1 到 run seal 水位连续。
- `occurred_at` 只表示业务时间，不能用它重新排序或回改已发布序号。

### Episode 状态

`created`、`active→running`、`completed`、`failed`、`cancelled` 可以按版本化规则直接映射。`waiting`、`blocked`、`paused`、`partial`、`aborted` 需要原因/Outcome 证据才能选择通用 `input_required/confirmation_required/waiting_external/suspended/completed/failed/cancelled/capability_gap`；缺少依据时进入映射 DLQ，并在 sidecar 保留原状态。领域 Episode type 同样根据任务/Workflow/评价语义选择 `a2a_task/workflow/evaluation`，不能仅凭 `simulation` 或 Agent 类型猜测。

### Execution Basis

领域 `basis_type` 描述依据种类，如 plan/SOP/policy/behavior-tree；通用 `basis_type` 描述 planning/decision/action/verification/continuation 使用阶段。P2 必须保留 `source_basis_type`，并依据目标事实的使用阶段填写 `basis_purpose`。缺少使用证据时不做字符串硬映射。

### Receipt

| 领域 | 通用 |
|---|---|
| transport `ok/error/timeout/unknown` | transport `success/failure/timeout/unknown` |
| acceptance `accepted/rejected/unknown` | executor 的受理语义；不能决定 business status |
| execution `accepted/running/succeeded/failed/cancelled` | executor `accepted/working/completed/failed/cancelled`；business `not_started/running/succeeded/failed/cancelled` |
| execution `timed_out/unknown` | 保留 outcome code；没有额外事实时 business 不得推断成功 |

transport 成功、accepted、MCP 返回成功都不等于业务或物理成功。只有 `verification_record` 的 expected/actual/comparator 和实际证据可以支持成功条件通过。

### 缺失值与 Schema 版本

- `freshness_ms=NULL` 表示未采集/不可计算；`0` 只表示可证明的零毫秒。
- 应用表的 `payload_hash` 保留来源声明的 32–128 位十六进制 Hash，`payload_sha256` 是 Collector 对规范化完整载荷计算的 64 位 SHA-256；P1 的 `source_payload_hash/root_source_payload_hash` 一律取后者。Input、Evidence 内容与 Bundle 同样使用“来源 Hash + `*_sha256`”双列，不能截断或改写来源算法。
- P2 sidecar 的 Hash 逐列赋值固定为：`p1_source_payload_sha256=sdar_embodied.source_payload_hash`、`root_source_payload_hash=sdar_embodied.root_source_payload_hash`、`source_payload_sha256=sdar_embodied.payload_sha256`、`target_payload_hash=sdar_core.<target>.payload_hash`。P2 的 `projection_lineage.source_payload_hash` 必须写领域 `payload_sha256`，P1 lineage 则写应用 Collector `payload_sha256`；二者都不是来源声明的 `payload_hash`。
- 应用/领域 SemVer 保留为 String；通用信封的 `schema_version UInt16` 是通用 catalog 版本。两者在 lineage 中同时保存，不做 `1.0.0→1` 的静默覆盖。
- 原始 `payload_json` 始终保留；列化值与 JSON 不一致时记录不能进入 ready bundle。

语义映射变化必须发布新的 `projection_version`。领域事实以 `projection_id + projection_version` 为历史边界，同版本的 `projection_revision` 只用于确定性修复。core 专用事实表表达当前通用表示，不假定每张表都保存 projection revision；完整历史通过 `raw_envelope/evidence_index`、版本化 sidecar 的 `target_payload_hash` 与 lineage 重放。

## 5. 评价结果映射

四张权威表为 `evaluation_result`、`evaluation_metric_result`、`evaluation_gate_result`、`evaluation_fatal_error`。`evaluation_scope` 决定事实输入：

| scope | adapter | 唯一事实来源 | 兼容视图 |
|---|---|---|---|
| `application` | `commander` | `sdar_commander` | `commander_*` |
| `application` | `npc` | `sdar_npc` | `npc_*` |
| `domain` | `commander` 或 `npc` | `sdar_embodied` | `embodied_*` |
| `general` | `sdar` | `sdar_core` | `general_*` |

父结果和 Metric/Gate/Fatal 子结果必须共享 `evaluation_id + result_version`、`evaluation_group_id`，以及同一套 framework/profile/metric/gate/fatal set/evaluator/projection/evidence snapshot/watermark。兼容视图只过滤当前结果，不复制数据；三层之间禁止复制分数。
