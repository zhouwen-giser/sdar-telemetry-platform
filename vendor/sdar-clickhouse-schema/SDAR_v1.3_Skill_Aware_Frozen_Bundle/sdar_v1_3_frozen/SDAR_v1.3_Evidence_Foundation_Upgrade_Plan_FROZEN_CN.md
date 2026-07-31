# SDAR v1.3 统一语义采集与评价证据基础升级方案（冻结版）

> **文档状态：FROZEN / 冻结**  
> **目标版本：SDAR v1.3.0**  
> **方案版本：1.0**  
> **冻结日期：2026-07-17**  
> **前置版本：v1.1 MCP Tasks、v1.2 Skill 驱动的能力使用体系**  
> **运行权威库：PostgreSQL**  
> **正式分析库：ClickHouse `sdar_core`、`sdar_meta`**  
> **传输标准：OpenTelemetry Context + OTLP（不以通用自动埋点作为业务事实来源）**  
> **后续版本：v2.0 Agent 评价、经验筛选与演化**

---

## 0. 冻结声明

本方案冻结 SDAR v1.3 的产品边界、权威边界、数据流、外部系统职责、核心数据域、实施阶段和验收门禁。

冻结后，以下变更必须新增 ADR，并按兼容性规则升级方案或 Schema 版本：

1. 改变 PostgreSQL、ClickHouse 或 MCP Provider 的权威边界；
2. 重新允许 Domain/Application 层直接调用遥测 API；
3. 将通用 OTel 自动埋点数据纳入正式评价证据；
4. 合并 ToolCall 与 Remote Task 生命周期；
5. 合并 Remote Task Observation 与 Control Event；
6. 引入第二套 Skill Runtime 或 Workflow Runtime；
7. 改变 Skill exact version、Usage Snapshot、Plan Compliance 的证据要求；
8. 改变 transactional Evidence 的事务一致性要求；
9. 改变 `ready / degraded / not_ready` 的基本语义；
10. 修改已发布 ClickHouse Migration，而不是追加 Migration。

本方案替代原“SDAR v1.2 统一遥测与评价证据基础”设计。原方案中可复用的 Goal、Plan、State、MCP Tasks、Outbox、ClickHouse 和 Evaluation Readiness 设计被保留，并升级为 Skill-aware 版本。

---

# 1. 版本路线与定位

版本路线锁定为：

```text
v1.0.x Runtime Hardening
        ↓
v1.1 MCP Tasks 客户端
        ↓
v1.2 Skill 驱动的能力使用体系
        ↓
v1.3 统一语义采集与评价证据基础
        ↓
v2.0 Agent 评价、经验筛选与演化
```

各版本职责：

```text
v1.1
  让 SDAR 能可靠执行、跟踪和继续远程 MCP Task。

v1.2
  让 SDAR 能正确理解、选择、组合并遵守 Skill 使用说明。

v1.3
  让 SDAR 能可靠记录“如何使用 Skill 驱动计划、行动和 MCP Task”。

v2.0
  评价上述能力使用是否正确、完整、有效、可复用。
```

v1.3 不是新的 Runtime，也不是完整评价系统。它是运行事实到评价事实之间的证据基础层。

---

# 2. 核心目标

v1.3 必须将一次 SDAR 运行转化为结构化、事务一致、可重建、可审计的 Evidence Bundle，并支持回答：

1. 上游提交了什么 Request/A2A Task；
2. 形成了哪个 Goal Contract、约束和成功条件；
3. 发现了哪些 Skill 候选，为什么排除或保留；
4. Skill 是否适用于当前上下文；
5. 缺失上下文通过什么权威来源解决；
6. 为什么选择某个 Skill、exact version 和执行模式；
7. 固定依赖和 Capability Slot 如何解析；
8. 递归深度、组合规模和失败策略是否合规；
9. guidance、template 或 procedure 如何形成 Workflow Plan；
10. Plan 是否通过 normative、Provider Policy、证据要求和硬门槛检查；
11. 哪个 Skill Execution 产生了哪个 PlanStep、Action、ToolCall 和 Remote Task；
12. Remote Task 是否经过 Binding、轮询、Control Event 和 Continuation 形成闭环；
13. Action 的 Receipt 与业务 Verification 是否完成；
14. 子 Skill 失败如何传播；
15. degraded 与完整成功如何区分；
16. Episode 为什么进入最终 Outcome；
17. 当前证据是否足以供 v2.0 正式评分。

---

# 3. 非目标

v1.3 不实现：

- M1～M14/M15 正式总评分；
- LLM-as-a-Judge；
- 正式 Hard Gate/Fatal Error 评分服务；
- `sdar_mart.general_*` 的完整评价集市；
- Skill 自动发布；
- Skill normative 自动修改；
- Capability Ontology；
- Provider Factory；
- 设备资源调度器；
- 车长/NPC 应用原生采集库；
- 具身专题 Mapper；
- 第二套 Skill Runtime；
- 第二套 Workflow Runtime；
- 将 LangGraph `interrupt/resume` 改造成新的业务恢复机制；
- 将 Langfuse 作为权威事实源；
- 将 HTTP/DB/Redis 自动 Trace 作为正式评价事实；
- 保存模型隐藏思维链。

---

# 4. 冻结架构

```text
┌──────────────────── SDAR Runtime ────────────────────┐
│                                                     │
│ Goal / Skill Usage / Plan / Workflow / MCP Task     │
│ State / Decision / Action / Receipt / Verification  │
│                                                     │
│ Domain 与 Application 输出结构化权威对象             │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌────────────── 基础设施语义自动采集层 ────────────────┐
│ Repository Decorator / Transaction Hook             │
│ Runtime Hook / Adapter Mapper / Projection Mapper    │
│                                                     │
│ 业务层不直接调用 Telemetry API                       │
└────────────────────────┬────────────────────────────┘
                         │
                 Canonical Evidence
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
   transactional Evidence      buffered Evidence
   Evidence Journal + Outbox   bounded buffer/export
              │                     │
              └──────────┬──────────┘
                         ▼
                 Evidence Exporter
                         │
                 OTel Context / OTLP
                         │
                         ▼
             OpenTelemetry Collector
                         │
                         ▼
                  ClickHouse
             ┌───────────┴───────────┐
             ▼                       ▼
         sdar_core                sdar_meta
             │
             ▼
 Trajectory / Quality / Readiness
             │
             ▼
           v2.0
```

---

# 5. 权威边界

## 5.1 PostgreSQL：运行时权威

PostgreSQL 保存并决定：

- A2A Task、Goal、Plan、Workflow 的权威状态；
- Skill Version 和 Usage Specification；
- Skill Execution Record；
- Skill Execution 父子关系；
- RemoteTaskBinding；
- Remote Task Control Event Inbox；
- Workflow Continuation Snapshot；
- Action、Receipt、Verification；
- Runtime 终态；
- Evidence Journal；
- Transactional Outbox。

ClickHouse 不得反向修改这些状态。

## 5.2 ClickHouse：正式分析权威

ClickHouse 保存：

- Canonical Evidence；
- Goal—Skill—Plan—Action—Task—Verification 关联；
- 状态轨迹；
- Skill Execution 轨迹；
- MCP Task 轨迹；
- 数据质量结果；
- Evaluation Readiness；
- 后续 v2.0 的统一取数事实。

正式评价和分析不得在请求时联查 PostgreSQL、Langfuse 或技术 APM。

## 5.3 MCP Provider：外部执行权威

MCP Provider 对以下内容权威：

- Operation Availability；
- 真实资源状态；
- Reservation/Timing；
- Task 真实执行状态；
- 暂停、恢复和抢占；
- 最大等待；
- 取消是否真正生效；
- Task 最终业务结果。

SDAR 保存 Provider 返回的受验证观测副本，不将其提升为设备或资源的本地权威状态。

## 5.4 Skill 权威

- Skill Package 是设计、审查和导入载体；
- PostgreSQL 中经校验、审批、版本化的 Skill Version/Usage Specification 是运行时权威；
- ClickHouse 保存 exact version、Hash、摘要和 ArtifactRef；
- Legacy Skill 通过 `legacy_projection` 兼容；
- LLM 不能修改 normative、绕过 Provider Policy 或发明未注册 Task/Provider。

---

# 6. 采集模式

## 6.1 业务层不直接埋点

禁止在 Domain/Application 代码中出现：

```ts
telemetry.emit(...)
telemetry.recordAction(...)
clickhouse.insert(...)
otelExporter.export(...)
```

业务接口必须返回或提交结构化对象。基础设施层在权威提交点自动生成 Evidence。

## 6.2 基础设施语义自动采集

示例：

```text
SkillSelectionService.commit(result)
  → 保存 Selection Result
  → 自动生成 skill_selection_record Evidence

RemoteTaskBindingRepository.create(binding, tx)
  → 保存 Binding
  → 自动生成 remote_task_binding Evidence
  → 同事务写 Outbox

TerminalOutcomeRepository.commitAchieved(outcome, tx)
  → 原子更新 Task/Goal/Workflow/Result
  → 自动生成 episode_outcome 和 run_seal Evidence
```

## 6.3 OTel 的角色

OTel 只用于：

- Trace ID / Span ID；
- Context Propagation；
- OTLP 传输；
- Collector 路由、批处理和重试。

OTel 自动发现的 HTTP、DB、Redis Span 不进入 `sdar_core`，也不参与 Evaluation Readiness。需要 APM 时进入独立 `sdar_ops` 或其他 APM 后端。

---

# 7. Evidence 两维分类

## 7.1 Delivery Guarantee

```text
transactional
buffered
```

### transactional

- 与业务事务一致；
- 写 Evidence Journal 和 Outbox；
- 至少一次交付；
- 不允许采样；
- 可重试、可对账、可补发。

### buffered

- 基础设施异步批量发送；
- 不改变业务结果；
- 允许有限丢失；
- 不作为硬门槛的唯一证据。

## 7.2 Evaluation Role

```text
required
supporting
diagnostic
```

| 示例 | Delivery | Role |
|---|---|---|
| Skill Usage Snapshot | transactional | required |
| Skill Selection | transactional | required |
| Plan Compliance | transactional | required |
| Action Receipt | transactional | required |
| Remote Task Control Event | transactional | required |
| Remote Task Progress | buffered | supporting |
| Poll latency | buffered | diagnostic |
| LLM Token/Cost | buffered | supporting |
| HTTP/DB Span | 独立 APM | diagnostic |

---

# 8. ClickHouse 多范式边界

继续使用六个 Database：

```text
sdar_core
sdar_commander
sdar_npc
sdar_embodied
sdar_mart
sdar_meta
```

本版本直接建设：

```text
sdar_core
sdar_meta
```

不设置统一 `sdar_ingest` 为逻辑必经入口。

车长和 NPC 应用数据继续先进入各自应用库，再按专题语义汇聚至 `sdar_embodied`。v1.3 不要求所有应用内部数据转成 `sdar_core`。

技术 APM 可选使用：

```text
sdar_ops
```

`sdar_ops` 不属于正式评价事实链。

---

# 9. `sdar_core` 数据域

## 9.1 通用运行事实

```text
episode
run_segment
request_record
a2a_task_state
goal_record
constraint_record
success_criterion
plan_record
plan_step
execution_basis
state_snapshot
state_transition
event_record
decision_record
policy_decision
execution_gate_decision
human_confirmation
action_record
action_receipt
verification_record
episode_outcome
```

## 9.2 MCP Tasks 事实

```text
task_availability_check
remote_task_binding
remote_task_observation
remote_task_control_event
remote_task_poll_attempt
remote_task_input_link
remote_task_cancel
remote_task_reconciliation
workflow_continuation_snapshot
workflow_continuation_attempt
```

## 9.3 Skill-aware 事实

```text
skill_usage_snapshot
skill_candidate_record
skill_applicability_record
skill_context_resolution
skill_selection_record
skill_mode_selection
skill_composition_record
skill_composition_edge
skill_capability_slot_resolution
skill_interpretation_record
skill_procedure_compilation
skill_plan_compliance
skill_execution_record
skill_execution_relation
skill_failure_propagation
skill_evidence_requirement
skill_patch_candidate
```

## 9.4 辅助事实

```text
model_call_record
tool_call_record
memory_operation_record
artifact_reference
evaluation_readiness
evidence_quality_issue
ingestion_dead_letter
```

---

# 10. Skill-aware 关联字段

下列字段进入 Canonical Evidence Envelope，并在相关事实表中物化：

```text
skill_id
skill_version
skill_execution_id
root_skill_execution_id
parent_skill_execution_id

usage_spec_version
usage_spec_hash
usage_spec_source

skill_execution_mode
composition_id
capability_slot_id
recursion_depth
remaining_recursion_budget
failure_policy
plan_compliance_id
```

枚举：

```text
usage_spec_source:
  native
  legacy_projection

skill_execution_mode:
  guidance
  template
  procedure

failure_policy:
  fail_fast
  recoverable
  optional
  degraded
```

至少以下表必须包含 Skill 关联：

```text
plan_record
plan_step
execution_basis
decision_record
action_record
action_receipt
remote_task_binding
verification_record
episode_outcome
```

---

# 11. Skill-aware 主证据链

```text
Request
→ Goal
→ Skill Candidate Discovery
→ Skill Applicability
→ Context Resolution
→ Skill Selection
→ Mode Selection
→ Skill Composition
→ Capability Slot Resolution
→ Guidance / Template / Procedure Interpretation
→ Procedure Compilation
→ Plan
→ Plan Compliance
→ Skill Execution
→ Action
→ ToolCall / RemoteTaskBinding
→ Observation / Control Event
→ Continuation
→ Receipt
→ State Transition
→ Verification
→ Failure Propagation
→ Skill Outcome
→ Episode Outcome
```

---

# 12. Skill 事实语义

## 12.1 Usage Snapshot

保存实际执行使用的不可变 Skill Usage 快照引用：

- exact `skill_id + skill_version`；
- `usage_spec_version`；
- `usage_spec_hash`；
- native 或 legacy_projection；
- visibility；
- supported modes；
- normative/adaptive/evidence policy Hash；
- ArtifactRef。

## 12.2 Candidate Discovery

保存：

- 候选 Skill；
- 检索渠道；
- 语义分数；
- exact version；
- visibility；
- eligible；
- 排除原因；
- legacy 状态。

## 12.3 Applicability

结果：

```text
satisfied
partial
unsatisfied
unknown
```

保存：

- 满足条件；
- 缺失条件；
- 硬阻断；
- EvidenceRef；
- 是否需要查询或人工输入。

## 12.4 Context Resolution

来源：

```text
authoritative_context
read_only_query
deterministic_derivation
user_input
unresolved
```

模型猜测不能被标记为权威上下文。

## 12.5 Mode Selection

模式：

```text
guidance
template
procedure
```

保存：

- supported modes；
- selected mode；
- 风险；
- Context 完整度；
- Task Readiness；
- Human Confirmation；
- 结构化选择理由。

## 12.6 Composition

保存：

- root Skill；
- 固定依赖；
- 动态 Capability Slot；
- exact child Skill version；
- parent-child 参数映射；
- 输入输出兼容性；
- recursion depth/budget；
- cycle 检查；
- expansion limit；
- failure policy。

## 12.7 Plan Compliance

检查：

- normative；
- Task Type allowlist；
- Provider Policy；
- recursion budget；
- failure policy；
- confirmation requirement；
- evidence requirement；
- forbidden action；
- hard gate。

结果：

```text
passed
repaired
confirmation_required
rejected
```

## 12.8 Skill Execution

状态：

```text
selected
planning
executing
waiting_external
completed
failed
cancelled
degraded
```

Skill Execution 不得覆盖 Task、Goal、Workflow 或 Remote Task 权威状态。

## 12.9 Failure Propagation

保存：

- child outcome；
- failure policy；
- propagation action；
- replacement Skill；
- missing effects；
- degraded reason；
- EvidenceRef。

---

# 13. MCP Tasks 不变量

以下规则继续冻结：

1. ToolCall 在同步结果或 Task Handle 返回时结束；
2. Remote Task 生命周期使用独立 Binding；
3. Observation 不改变 Workflow 控制流；
4. 只有持久化 Control Event 可以触发 Continuation；
5. Control Event 必须幂等 Claim；
6. Continuation 从持久化 Frontier 继续，不能从 START 重放；
7. 已完成节点和副作用不得重放；
8. 一个 Task 完成只解除对应等待节点；
9. `tasks/cancel` 是请求，不是终态；
10. Provider 未确认前不得伪造 cancelled；
11. Remote Task completed 只形成 Receipt，不直接等于 Goal 完成；
12. `deadline_reached` 等业务结果只能由 Provider 返回；
13. parent Skill 不直接消费 child Workflow 内部 remoteTaskId。

---

# 14. 状态轨迹与投影

v1.3 建设四类分析投影：

```text
sdar_core.state_trajectory
sdar_core.skill_execution_trajectory
sdar_core.remote_task_trajectory
sdar_core.episode_evidence_bundle
```

分工：

- 简单字段投影、按日聚合：ClickHouse Materialized View；
- Skill 树、Continuation、版本链和复杂因果关联：独立 Projection Builder；
- 所有投影携带 `projection_version`；
- 投影必须可由 Canonical Facts 重建；
- 投影不是运行权威。

---

# 15. Evaluation Readiness

v1.3 只判断是否可评价，不打正式分。

## 15.1 基础检查

- Run Seal；
- Evidence Sequence；
- StateVersion；
- Action/Receipt；
- Verification；
- RemoteTaskBinding；
- Control Event；
- Continuation；
- Cancel Uncertainty；
- Outcome。

## 15.2 Skill-aware 检查

```text
skill_usage_snapshot_complete
skill_candidate_trace_complete
skill_applicability_complete
skill_context_resolution_complete
skill_selection_complete
skill_mode_selection_complete
skill_composition_complete
skill_capability_slot_complete
skill_plan_compliance_complete
skill_execution_tree_complete
skill_failure_propagation_complete
skill_evidence_requirement_complete
```

## 15.3 状态

```text
ready
degraded
not_ready
```

### ready

所有 required Evidence 完整，且无未解决的关键质量问题。

### degraded

required Evidence 完整，仅缺 Progress、Heartbeat、Token、性能数据等 supporting/diagnostic Evidence。

### not_ready

任一 required Evidence 缺失、冲突、未闭环或存在重放/取消不确定性。

---

# 16. 外部系统调整

## 16.1 PostgreSQL

新增：

```text
evidence_journal
evidence_outbox
evidence_run_manifest
evidence_export_checkpoint
```

要求：

- append-only Evidence；
- `(run_id, evidence_sequence)` 唯一；
- 业务状态、Evidence、Outbox 同事务；
- Worker 锁、Retry、Backoff、Dead Letter；
- 重启后继续；
- 可对账、可补发。

## 16.2 ClickHouse

需要：

- 新增 Skill-aware 表；
- 给跨域事实表增加 Skill 关联列；
- 更新索引和排序键；
- 更新 Materialized View；
- 增加 Projection Builder；
- 增加 Skill-aware Readiness 和质量规则。

无需：

- 更换 ClickHouse；
- 重做六库结构；
- 新增统一 `sdar_ingest`。

## 16.3 Evidence Exporter

必须新增 Skill Mapper：

```text
SkillUsageSnapshotMapper
SkillCandidateMapper
SkillApplicabilityMapper
SkillContextMapper
SkillSelectionMapper
SkillModeMapper
SkillCompositionMapper
SkillCapabilitySlotMapper
SkillInterpretationMapper
SkillProcedureCompilationMapper
SkillPlanComplianceMapper
SkillExecutionMapper
SkillFailurePropagationMapper
SkillEvidenceRequirementMapper
SkillPatchCandidateMapper
```

## 16.4 OTel Collector

职责：

- 接收；
- 批处理；
- 重试；
- 路由；
- 脱敏；
- 写 ClickHouse；
- Dead Letter。

统一属性：

```text
sdar.record_type
sdar.schema_name
sdar.schema_version
sdar.delivery_guarantee
sdar.evaluation_role
sdar.episode_id
sdar.run_id
sdar.skill_execution_id
sdar.binding_id
```

Collector 不推断业务语义。

## 16.5 ArtifactStore

新增内容角色：

```text
skill_package
skill_usage_snapshot
skill_normative_snapshot
skill_adaptive_snapshot
skill_composition_snapshot
skill_template_instance
skill_procedure_program
skill_plan_compliance_report
skill_execution_tree
skill_patch_candidate
```

对象路径：

```text
/{tenant}/{project}/{episode}/
  skill-usage/
  skill-composition/
  procedure/
  compliance/
  execution/
  mcp-task/
  verification/
  outcome/
```

## 16.6 技术 APM

自动 HTTP/DB/Redis Trace 进入：

```text
sdar_ops
```

或外部 APM。它们不参与正式 Evidence Bundle。

---

# 17. 配置冻结

建议环境变量：

```text
SDAR_EVIDENCE_PIPELINE_ENABLED=true
SDAR_EVIDENCE_PIPELINE_VERSION=v1.3

SDAR_CLICKHOUSE_CORE_DATABASE=sdar_core
SDAR_CLICKHOUSE_META_DATABASE=sdar_meta
SDAR_CLICKHOUSE_OPS_DATABASE=sdar_ops

SDAR_EVIDENCE_EXPORT_BATCH_SIZE
SDAR_EVIDENCE_EXPORT_CONCURRENCY
SDAR_EVIDENCE_EXPORT_FLUSH_INTERVAL_MS

SDAR_EVIDENCE_DEAD_LETTER_ENABLED=true
SDAR_EVIDENCE_RECONCILIATION_ENABLED=true

SDAR_SKILL_EVIDENCE_ENABLED=true
SDAR_MCP_TASK_EVIDENCE_ENABLED=true
SDAR_READINESS_PROJECTION_ENABLED=true
```

禁止为 required Skill Evidence 配置采样率。

---

# 18. 分阶段实施

## Phase 0：冻结与基线

- 固化本方案；
- 固化 Skill-aware Schema；
- 废止原 v1.2 Telemetry 文档；
- 建立 v1.1/v1.2 依赖矩阵；
- 建立分支和 ExecPlan；
- 记录基线。

## Phase 1：Canonical Evidence Contract

- Envelope；
- EvidenceRef；
- ArtifactRef；
- Delivery/Evaluation 分类；
- Schema Registry；
- Record Catalog；
- Hash、Sequence、兼容规则。

## Phase 2：ClickHouse 建库

- `sdar_core`；
- `sdar_meta`；
- 通用事实表；
- MCP Tasks 表；
- Skill-aware 表；
- Migration Runner；
- Dead Letter；
- 测试建库。

## Phase 3：Evidence Journal 与 Outbox

- Journal；
- Outbox；
- Run Manifest；
- Export Checkpoint；
- Retry/Backoff；
- Reconciliation。

## Phase 4：Exporter 与 Collector

- Canonical Serializer；
- OTLP Mapper；
- Collector 路由；
- ClickHouse Writer；
- 脱敏；
- Schema 隔离；
- Artifact 路由。

## Phase 5：通用运行事实接入

- Request/Goal/Plan；
- State/Decision/Policy；
- Action/Receipt；
- Verification/Outcome。

## Phase 6：Skill-aware 事实接入

- Usage；
- Candidate；
- Applicability；
- Context；
- Selection；
- Mode；
- Composition；
- Slot；
- Interpretation；
- Procedure；
- Compliance；
- Execution；
- Failure Propagation。

## Phase 7：Skill—MCP Task 跨链

- SkillExecution → PlanStep → Action；
- Action → ToolCall/Binding；
- Binding → ControlEvent/Continuation；
- Receipt/Verification；
- 无重复副作用。

## Phase 8：Trajectory 与 Projection

- State；
- Skill；
- Remote Task；
- Episode Bundle；
- Projection 重建与版本。

## Phase 9：Readiness 与质量规则

- 基础完整性；
- Skill 完整性；
- MCP Task 闭环；
- ready/degraded/not_ready。

## Phase 10：Artifact、安全和保留

- MinIO/S3；
- Hash；
- 脱敏；
- 租户隔离；
- Retention；
- 不保存隐藏推理。

## Phase 11：管理查询

最低接口：

```text
GET /management/evidence/episodes/:episodeId
GET /management/evidence/episodes/:episodeId/trajectory
GET /management/evidence/episodes/:episodeId/skill-tree
GET /management/evidence/episodes/:episodeId/remote-tasks
GET /management/evidence/episodes/:episodeId/readiness
GET /management/evidence/outbox
POST /management/evidence/outbox/replay
GET /management/evidence/quality-issues
```

## Phase 12：垂直验收

复用：

```text
embodied.move_to
embodied.area_patrol
```

验证 guidance/template/procedure、递归组合、Capability Slot、四类失败传播、Remote Task、Restart、Continuation、degraded 和 Evidence 闭环。

---

# 19. 分支与集成门禁

建议分支：

```text
feature/v1.3-telemetry-evidence-foundation
```

v1.2 进入 main 前可独立开发：

- Canonical Schema；
- ClickHouse DDL；
- Meta Schema；
- 通用 Outbox；
- Exporter；
- Collector；
- ArtifactStore；
- 质量框架；
- Mock Mapper。

生产集成门禁：

```text
V12_SKILL_USAGE_MAIN_BASELINE_READY
```

条件：

1. v1.2 最终提交进入 `origin/main`；
2. Skill Usage 类型已冻结；
3. Skill Execution Record 已冻结；
4. Skill Composition 和 Compliance 类型稳定；
5. v1.1 Remote Task/Continuation 不变量保持；
6. 最新 main 完整门禁通过；
7. PostgreSQL Migration high-water 确认。

不得以 v1.2 feature 分支作为正式发布依赖。

---

# 20. 验收标准

## 20.1 架构

- Domain/Application 不调用 Telemetry API；
- 不建立第二 Runtime；
- PostgreSQL 是运行权威；
- ClickHouse 是分析权威；
- Provider 权威不被复制；
- 技术 APM 与正式 Evidence 分离；
- `sdar_core` 不依赖通用自动埋点。

## 20.2 数据

- 每条 required Evidence 有唯一 `record_id`；
- 每种记录有独立 Schema；
- Evidence Sequence 连续；
- Skill exact version 与 Usage Hash 可确定；
- Skill Execution 父子树可重建；
- Action 可关联 Skill Execution；
- Remote Task 可关联 Action、PlanStep、Skill Execution；
- degraded 与完整成功明确区分。

## 20.3 可靠性

- ClickHouse/Collector 故障不改变 Runtime 结果；
- transactional Evidence 不丢失；
- 重复导出按 `record_id + payload_hash` 幂等；
- 同 ID 不同 Payload 产生质量错误；
- 重启后继续导出；
- Continuation 不重放副作用；
- Outbox 可对账和补发。

## 20.4 评价准备

- 仅从 ClickHouse 构建 Episode Evidence Bundle；
- 重建 Goal—Skill—Plan—Action—Task—Verification 主链；
- 判断 Skill 选择、组合、合规和失败传播是否完整；
- 判断 MCP Task 是否闭环；
- 计算 ready/degraded/not_ready；
- 不依赖 Langfuse；
- 不实时联查 PostgreSQL。

---

# 21. 冻结关键决策

| ID | 决策 | 冻结结果 |
|---|---|---|
| D-01 | 原 v1.2 遥测版本 | 延后并升级为 v1.3 |
| D-02 | v1.3 集成基线 | v1.2 最终提交进入 main |
| D-03 | 运行权威 | PostgreSQL |
| D-04 | 正式分析权威 | ClickHouse `sdar_core` |
| D-05 | 业务层 Telemetry API | 禁止 |
| D-06 | 采集位置 | 基础设施权威接口和事务边界 |
| D-07 | OTel 角色 | Context 和传输 |
| D-08 | 通用自动埋点 | 不进入正式 Evidence |
| D-09 | 技术 APM | 独立 `sdar_ops` 或外部 APM |
| D-10 | 统一 `sdar_ingest` | 不设置为必经入口 |
| D-11 | Skill 是否一级证据域 | 是 |
| D-12 | Skill Package 权威 | PostgreSQL exact version |
| D-13 | Legacy Skill | `legacy_projection` |
| D-14 | 第二 Skill Runtime | 禁止 |
| D-15 | 第二 Workflow Runtime | 禁止 |
| D-16 | Provider 状态本地权威化 | 禁止 |
| D-17 | Observation/Control Event | 分离 |
| D-18 | ToolCall/Remote Task | 生命周期分离 |
| D-19 | 关键证据交付 | 业务事务 + Journal + Outbox |
| D-20 | 导出语义 | 至少一次，幂等去重 |
| D-21 | 表模型 | 核心实体一级事实表 |
| D-22 | 大 Payload | ArtifactStore |
| D-23 | 可靠性与评价角色 | 两维分离 |
| D-24 | degraded | 不等于完整成功 |
| D-25 | Readiness | 只判断可评价，不评分 |
| D-26 | Schema 版本 | 每种记录独立升版 |
| D-27 | Migration | 只追加，不修改已发布 Migration |
| D-28 | 六库架构 | 保持 |
| D-29 | Langfuse | 可选投影，不是权威 |
| D-30 | 隐藏思维链 | 不保存 |
| D-31 | Skill Patch Candidate | 记录候选，不表示发布 |
| D-32 | 投影权威 | 投影可重建，不是运行权威 |

---

# 22. 冻结后的变更管理

- 兼容新增可选字段：提升记录 `schema_version` 次版本；
- 新增记录类型：新增独立 Schema 和 Catalog Entry；
- 修改字段语义、必填性或 ID 关系：新主版本；
- 修改权威边界或采集架构：新增 ADR 并重新冻结方案；
- 修改已部署 ClickHouse 表：仅追加 Migration；
- 所有 Schema、DDL、Catalog 和文档发布时生成 SHA-256 清单。

---

# 23. 最终完成状态

v1.3 完成后：

```text
SDAR Runtime 权威接口
  → 基础设施语义自动采集
  → Canonical Evidence
  → Journal / Outbox / Exporter
  → Collector
  → ClickHouse sdar_core
  → Skill-aware Trajectory
  → Evaluation Readiness
  → v2.0
```

本方案冻结为 v1.3 的正式实施边界。
