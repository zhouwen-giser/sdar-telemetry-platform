# SDAR v1.2 统一遥测与评价证据采集 Schema V1.1

> **历史归档：** SDAR v1.3 冻结决策 D-01 已将本遥测合同升级并替换为 `sdar.evidence/v1` Canonical Evidence。本文只用于解释历史 v1.2 数据，不得作为新采集入口。当前规范见 [`../SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/SDAR_v1.3_Skill_Aware_Evidence_Schema_V1.2_FROZEN_CN.md`](../SDAR_v1.3_Skill_Aware_Frozen_Bundle/sdar_v1_3_frozen/SDAR_v1.3_Skill_Aware_Evidence_Schema_V1.2_FROZEN_CN.md)。

> **文档状态：** 修订设计稿
> **目标版本：** SDAR v1.2
> **依赖版本：** SDAR v1.0.13、SDAR v1.1 MCP Tasks
> **核心存储：** ClickHouse
> **通用事实库：** `sdar_core`
> **元数据库：** `sdar_meta`
> **时间标准：** UTC，`DateTime64(3, 'UTC')`
> **修订重点：** 完整纳入 v1.1 MCP Tasks 的 Availability、Timing、RemoteTaskBinding、轮询、观测事件、控制事件、Workflow Continuation、输入补充、取消和对账数据。

---

# 1. Schema 目标

本 Schema 用于完整采集一次 SDAR Agent 执行中的：

```text
请求
→ 任务理解
→ Goal
→ Plan
→ 执行依据
→ 决策
→ 策略和确认
→ Action
→ 同步 Tool 或远程 MCP Task
→ Receipt
→ State Transition
→ Verification
→ Episode Outcome
```

对于远程 MCP Task，还必须完整采集：

```text
Task Availability
→ 时间与预约合同
→ tools/call
→ RemoteTaskBinding
→ Workflow waiting_external
→ tasks/get 轮询
→ Provider Observation
→ Task Control Event
→ Workflow Continuation
→ tasks/update / tasks/cancel
→ Task 终态
→ Action Receipt
→ Verification
```

v1.2 完成后，应支持：

1. 重建 Agent 的完整状态轨迹；
2. 判断计划与实际执行是否一致；
3. 判断远程 MCP Task 是否被持续、可靠地跟踪；
4. 判断是否存在重复副作用或陈旧事件；
5. 判断 Episode 是否具备正式评价条件；
6. 为 V2 的指标、硬门槛和致命错误提供证据。

---

# 2. 数据库边界

## 2.1 v1.2 直接建设

```text
sdar_core
sdar_meta
```

### `sdar_core`

保存 SDAR 通用运行事实：

* Episode；
* Run 和 Segment；
* Request 和 A2A Task；
* Goal 和 Plan；
* State、Event 和 Trajectory；
* Decision、Policy 和 Confirmation；
* Action、Receipt 和 Verification；
* MCP Tasks 生命周期；
* Outcome；
* Evaluation Readiness；
* 数据质量问题。

### `sdar_meta`

保存：

* Schema 定义；
* Event 定义；
* Event 交付策略；
* 数据质量规则；
* 投影版本；
* Collector 版本；
* 指标定义占位。

## 2.2 v1.2 不直接建设

```text
sdar_commander
sdar_npc
sdar_embodied
sdar_mart 正式评分表
```

v1.2 只发布统一关联键和跨范式数据契约。

---

# 3. 权威边界

## 3.1 PostgreSQL

PostgreSQL 是 SDAR Runtime 的事务事实源，负责：

* Task、Goal、Plan 和 Workflow 运行状态；
* RemoteTaskBinding；
* Workflow Continuation Snapshot；
* Remote Task Control Event Inbox；
* durable Evidence；
* Transactional Outbox；
* 幂等和恢复。

## 3.2 ClickHouse

ClickHouse 是正式分析事实源，负责：

* 统一运行分析；
* 状态轨迹重建；
* MCP Task 生命周期分析；
* 证据完整性检查；
* Evaluation Readiness；
* 后续 V2 评分取数。

正式分析不应实时联查 PostgreSQL 和 Langfuse。

## 3.3 MCP Provider

MCP Provider 对以下信息权威：

* Operation 实际可用性；
* 真实资源状态；
* 预约和执行窗口；
* Task 真实执行状态；
* 暂停、恢复和抢占；
* 最大等待时间；
* 资源是否释放；
* Task 最终业务结果。

SDAR 保存的是 Provider 状态的**本地观测副本**，不是设备和资源的权威状态。

---

# 4. 核心概念边界

## 4.1 State

表示某个版本下的权威运行状态：

```text
当前是什么情况？
```

State 使用：

```text
state_version
```

进行版本控制。

## 4.2 Event

表示已经发生且不可修改的事实：

```text
发生了什么？
```

Event 不表示当前完整状态。

## 4.3 Decision

表示 Agent 在多个候选项之间形成的正式选择：

```text
选择了什么，依据是什么？
```

不保存模型隐藏思维过程。

## 4.4 Action

表示 Agent 主动发起或试图发起的操作：

```text
Agent 做了什么？
```

## 4.5 Receipt

表示执行器、MCP Server 或远程 MCP Task 返回的事实。

Receipt 必须区分：

```text
transport_status
executor_status
business_status
```

## 4.6 Verification

表示对 Goal 成功条件的实际验证。

## 4.7 Remote Task Observation

表示 Provider 的任务状态变化，但不会直接恢复 Workflow：

```text
scheduled
running
paused
resuming
progress
heartbeat
```

## 4.8 Remote Task Control Event

表示需要重新进入 Workflow 控制流的事件：

```text
input_required
completed
failed
cancelled
```

Observation 和 Control Event 必须分开存储。

---

# 5. 全局关联键

所有正式事实表必须携带以下字段。

| 字段                    | 类型            |   必填 | 说明                    |
| --------------------- | ------------- | ---: | --------------------- |
| `tenant_id`           | String        |    是 | 租户或组织                 |
| `project_id`          | String        |    是 | 项目标识                  |
| `environment`         | String        |    是 | dev/test/staging/prod |
| `agent_id`            | String        |    是 | Agent 实例              |
| `agent_type`          | String        |    是 | `sdar`                |
| `agent_version`       | String        |    是 | Agent 版本              |
| `application_version` | String        |    是 | 软件版本                  |
| `session_id`          | String        |    否 | Session               |
| `conversation_id`     | String        |    否 | Conversation          |
| `a2a_task_id`         | String        |    否 | A2A Task              |
| `episode_id`          | UUID          |    是 | 评价 Episode            |
| `run_id`              | UUID          |    是 | 一次运行                  |
| `segment_id`          | UUID          |    是 | 一次连续活跃执行阶段            |
| `correlation_id`      | String        |    是 | 跨服务关联                 |
| `trace_id`            | String        |    是 | OTel Trace ID         |
| `span_id`             | String        |    否 | OTel Span ID          |
| `parent_span_id`      | String        |    否 | 父 Span ID             |
| `record_id`           | UUID          |    是 | 当前记录 ID               |
| `event_id`            | UUID          |    否 | Event ID              |
| `sequence`            | UInt64        |    是 | Run 内全部记录顺序           |
| `evidence_sequence`   | UInt64        | 条件必填 | durable Evidence 连续顺序 |
| `schema_name`         | String        |    是 | Schema 名称             |
| `schema_version`      | UInt16        |    是 | Schema 版本             |
| `occurred_at`         | DateTime64(3) |    是 | 事实发生时间                |
| `observed_at`         | DateTime64(3) |    否 | 外部实际观测时间              |
| `ingested_at`         | DateTime64(3) |    是 | ClickHouse 入库时间       |

关系：

```text
Episode
  ├─ Run
  │   ├─ Segment
  │   ├─ Workflow Instance
  │   ├─ Action
  │   └─ Remote MCP Task
  └─ Outcome
```

首期可以：

```text
episode_id = run_id
```

但 Schema 不强制永久一一对应。

---

# 6. 统一采集信封

```ts
export type TelemetryDeliveryClass =
  | "best_effort"
  | "durable";

export type TelemetryEventCategory =
  | "runtime"
  | "request"
  | "goal"
  | "plan"
  | "state"
  | "domain_event"
  | "decision"
  | "policy"
  | "human"
  | "action"
  | "receipt"
  | "verification"
  | "outcome"
  | "model"
  | "tool"
  | "memory"
  | "mcp_task"
  | "continuation"
  | "evaluation"
  | "quality";

export interface AgentTelemetryEnvelope<TPayload> {
  schemaName: string;
  schemaVersion: number;

  recordId: string;
  eventId?: string;

  eventType: string;
  eventCategory: TelemetryEventCategory;

  deliveryClass: TelemetryDeliveryClass;
  requiredForEvaluation: boolean;

  tenantId: string;
  projectId: string;
  environment: "dev" | "test" | "staging" | "prod";

  agentId: string;
  agentType: "sdar";
  agentVersion: string;
  applicationVersion: string;

  sessionId?: string;
  conversationId?: string;
  a2aTaskId?: string;

  episodeId: string;
  runId: string;
  segmentId: string;
  correlationId: string;

  traceId: string;
  spanId?: string;
  parentSpanId?: string;

  sequence: string;
  evidenceSequence?: string;

  goalId?: string;
  goalVersion?: number;

  planId?: string;
  planVersion?: number;
  planStepId?: string;

  workflowInstanceId?: string;
  workflowNodeId?: string;

  stateVersionBefore?: string;
  stateVersionAfter?: string;

  decisionId?: string;
  actionId?: string;
  receiptId?: string;
  verificationId?: string;

  bindingId?: string;
  remoteTaskId?: string;
  controlEventId?: string;
  continuationId?: string;

  evidenceRefs: string[];
  attributes: Record<string, string>;

  payloadHash: string;
  payload: TPayload;

  artifactRefs?: ArtifactReference[];

  occurredAt: string;
  observedAt?: string;
}
```

强制规则：

* `recordId` 全局唯一；
* durable 记录必须有 `evidenceSequence`；
* durable 记录不得采样；
* 同一 `recordId` 的 `payloadHash` 必须一致；
* `UInt64` 在 TypeScript 中使用字符串传输；
* 所有时间均为 UTC；
* 事件可靠性由中央 Event Policy 决定。

---

# 7. Artifact Schema

```ts
export interface ArtifactReference {
  artifactId: string;
  uri: string;

  mediaType: string;
  encoding?: string;

  sha256: string;
  sizeBytes: string;

  storageProvider:
    | "filesystem"
    | "minio"
    | "s3";

  contentRole:
    | "prompt"
    | "model_output"
    | "state_snapshot"
    | "tool_input"
    | "tool_output"
    | "remote_task_snapshot"
    | "continuation_snapshot"
    | "attachment"
    | "debug_bundle"
    | "other";

  preview?: string;
  createdAt: string;
}
```

---

# 8. Episode、Run 与 Segment

## 8.1 Episode

```ts
export type EpisodeStatus =
  | "created"
  | "running"
  | "input_required"
  | "confirmation_required"
  | "waiting_external"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled"
  | "capability_gap";

export interface EpisodePayload {
  episodeType:
    | "a2a_task"
    | "workflow"
    | "evaluation";

  status: EpisodeStatus;

  requestSummary: string;
  scenarioId?: string;

  startedAt: string;
  endedAt?: string;

  finalGoalVersion?: number;
  finalPlanVersion?: number;
  finalStateVersion?: string;

  sealed: boolean;

  evaluationReadiness:
    | "unknown"
    | "ready"
    | "degraded"
    | "not_ready";
}
```

## 8.2 Run Segment

```ts
export interface RunSegmentPayload {
  segmentIndex: number;

  segmentStatus:
    | "started"
    | "completed"
    | "failed"
    | "cancelled"
    | "suspended";

  parentSegmentId?: string;
  resumeFromSegmentId?: string;

  suspendReason?: string;
  resumeReason?: string;

  checkpointRef?: string;

  startedAt: string;
  endedAt?: string;
}
```

## 8.3 Run Seal

```ts
export interface RunSealPayload {
  terminalStatus:
    | "completed"
    | "failed"
    | "cancelled"
    | "capability_gap";

  lastSequence: string;
  lastEvidenceSequence: string;

  durableEvidenceCount: string;
  pendingDurableEvidenceCount: number;

  finalGoalVersion: number;
  finalPlanVersion?: number;
  finalStateVersion: string;

  outcomeRecordId: string;
  finalStateSnapshotId: string;

  sealedAt: string;
}
```

---

# 9. Request 与 A2A Task

```ts
export interface RequestRecordPayload {
  requestType:
    | "submit"
    | "follow_up"
    | "provide_input"
    | "confirm"
    | "reject"
    | "cancel";

  requestText?: string;
  structuredInput?: unknown;

  sourceAgentId?: string;
  sourceAgentType?: string;

  requestedExecutionMode:
    | "live"
    | "simulation"
    | "historical-replay";

  accepted: boolean;
  rejectionCode?: string;

  inputArtifactRefs: string[];
}
```

```ts
export interface A2ATaskStatePayload {
  previousState?: string;

  currentState:
    | "submitted"
    | "working"
    | "input_required"
    | "completed"
    | "failed"
    | "cancelled";

  stateReason?: string;

  resultRef?: string;
  errorCode?: string;
  capabilityGapRef?: string;
}
```

---

# 10. Goal Schema

```ts
export interface GoalRecordPayload {
  goalId: string;
  goalVersion: number;

  title: string;
  description: string;

  status:
    | "draft"
    | "active"
    | "achieved"
    | "unachievable"
    | "cancelled"
    | "superseded";

  source:
    | "request"
    | "goal_patch"
    | "continuation"
    | "system";

  parentGoalVersion?: number;

  constraints: GoalConstraint[];
  successCriteria: SuccessCriterion[];
  assumptions: GoalAssumption[];
  unresolvedQuestions: string[];

  effectiveFrom: string;
}
```

```ts
export interface GoalConstraint {
  constraintId: string;

  type:
    | "scope"
    | "safety"
    | "time"
    | "resource"
    | "authorization"
    | "forbidden_action"
    | "output"
    | "other";

  description: string;

  severity:
    | "hard"
    | "soft";

  sourceRef: string;
  active: boolean;
}
```

```ts
export interface SuccessCriterion {
  criterionId: string;
  description: string;

  verificationType:
    | "state_match"
    | "receipt"
    | "query"
    | "model_assessment"
    | "human_confirmation"
    | "composite";

  expectedValue?: unknown;

  critical: boolean;
  required: boolean;
}
```

```ts
export interface GoalAssumption {
  assumptionId: string;
  description: string;

  materiality:
    | "low"
    | "medium"
    | "high";

  declaredToCaller: boolean;
  evidenceRefs: string[];
}
```

---

# 11. Plan Schema

```ts
export interface PlanRecordPayload {
  planId: string;
  planVersion: number;

  goalId: string;
  goalVersion: number;

  status:
    | "generated"
    | "pending_confirmation"
    | "approved"
    | "rejected"
    | "executing"
    | "completed"
    | "failed"
    | "superseded"
    | "cancelled";

  planningReason:
    | "initial"
    | "replan"
    | "recovery"
    | "goal_patch";

  parentPlanVersion?: number;

  stepCount: number;
  dependencyCount: number;

  requiredSkillVersions: SkillVersionRef[];
  toolSemanticsSnapshotRefs: string[];

  validationResult:
    | "valid"
    | "invalid"
    | "warning";

  generatedAt: string;
  approvedAt?: string;
}
```

```ts
export interface PlanStepPayload {
  planStepId: string;
  planId: string;
  planVersion: number;

  stepIndex: number;
  nodeId: string;

  stepType:
    | "llm"
    | "mcp_tool"
    | "skill_call"
    | "subworkflow"
    | "human"
    | "verification"
    | "condition"
    | "loop";

  title: string;
  description: string;

  dependencyStepIds: string[];

  requiredCapability?: string;
  targetRef?: string;

  expectedOutputSchemaRef?: string;

  actionSemantics?: ActionExecutionSemantics;
  taskExecution?: McpTaskExecutionSpec;

  status:
    | "pending"
    | "ready"
    | "running"
    | "waiting_remote_task"
    | "completed"
    | "failed"
    | "skipped"
    | "cancelled";
}
```

```ts
export interface SkillVersionRef {
  skillId: string;
  skillVersion: number;
  source: "official" | "temporary";
}
```

---

# 12. Execution Basis

```ts
export interface ExecutionBasisPayload {
  basisId: string;

  basisType:
    | "planning"
    | "decision"
    | "action"
    | "verification"
    | "continuation";

  goalId: string;
  goalVersion: number;

  planId?: string;
  planVersion?: number;
  planStepId?: string;

  stateVersion: string;

  inputVersion?: number;

  selectedSkillRefs: SkillVersionRef[];
  capabilitySnapshotRefs: string[];
  toolSemanticsSnapshotRefs: string[];

  remoteTaskBindingId?: string;
  continuationSnapshotId?: string;

  evidenceRefs: string[];

  createdAt: string;
}
```

---

# 13. State、Transition 与 Domain Event

## 13.1 State Snapshot

```ts
export interface StateSnapshotPayload {
  stateVersion: string;

  snapshotKind:
    | "initial"
    | "checkpoint"
    | "terminal"
    | "manual";

  goalVersion: number;
  planVersion?: number;

  taskStatus: string;
  workflowStatus: string;

  activeNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  skippedNodeIds: string[];

  waitingFor:
    | "none"
    | "input"
    | "confirmation"
    | "remote_task"
    | "retry"
    | "external_event";

  pendingActionIds: string[];

  waitingRemoteTaskBindingIds: string[];
  waitingRemoteTaskNodeIds: string[];

  continuationSnapshotId?: string;

  stateSummary: string;
  stateHash: string;

  stateArtifactRef?: string;
}
```

## 13.2 State Transition

```ts
export interface StateTransitionPayload {
  transitionId: string;

  fromStateVersion: string;
  toStateVersion: string;

  triggerEventId: string;

  decisionId?: string;
  actionId?: string;
  receiptId?: string;
  verificationId?: string;

  bindingId?: string;
  controlEventId?: string;
  continuationId?: string;

  transitionType:
    | "normal"
    | "external_wait"
    | "continuation"
    | "suspend"
    | "resume"
    | "replan"
    | "retry"
    | "cancel"
    | "terminal";

  changedFields: Record<
    string,
    {
      before: unknown;
      after: unknown;
    }
  >;

  invariantResult:
    | "passed"
    | "failed"
    | "not_checked";

  invariantFailures: string[];
}
```

## 13.3 Domain Event

```ts
export interface DomainEventPayload {
  domainEventType: string;

  source:
    | "runtime"
    | "mcp"
    | "remote_task"
    | "human"
    | "upstream_agent"
    | "system";

  subjectType: string;
  subjectId: string;

  causationId?: string;

  factSummary: string;
  factPayload?: unknown;

  acceptedIntoState: boolean;
  resultingStateVersion?: string;
}
```

---

# 14. Decision、Policy 与 Human

## 14.1 Decision

```ts
export interface DecisionPayload {
  decisionId: string;

  decisionType:
    | "goal_interpretation"
    | "skill_selection"
    | "plan_selection"
    | "route"
    | "task_availability"
    | "task_reschedule"
    | "policy"
    | "replan"
    | "recovery"
    | "termination"
    | "other";

  decisionStatus:
    | "proposed"
    | "accepted"
    | "rejected"
    | "superseded";

  candidateOptions: DecisionOption[];
  selectedOptionId?: string;

  reasonSummary: string;
  evidenceRefs: string[];

  riskLevel:
    | "none"
    | "low"
    | "medium"
    | "high"
    | "critical";

  confidence?: number;
  basisId: string;
}
```

```ts
export interface DecisionOption {
  optionId: string;
  description: string;

  feasible:
    | "yes"
    | "no"
    | "unknown";

  rejectionReason?: string;
  estimatedRisk?: string;
}
```

## 14.2 Policy Decision

```ts
export interface PolicyDecisionPayload {
  policyDecisionId: string;

  policyType:
    | "skill_tool_policy"
    | "execution_policy"
    | "safety_policy"
    | "authorization_policy"
    | "task_availability_policy"
    | "replay_policy"
    | "cancellation_policy";

  policyId: string;
  policyVersion: string;

  subjectType:
    | "plan"
    | "plan_step"
    | "action"
    | "tool"
    | "remote_task";

  subjectId: string;

  result:
    | "allow"
    | "deny"
    | "require_confirmation"
    | "unknown";

  reasonCode: string;
  reasonSummary: string;

  evidenceRefs: string[];
}
```

## 14.3 Execution Gate

```ts
export interface ExecutionGatePayload {
  gateDecisionId: string;

  actionId: string;
  planStepId: string;

  gateType:
    | "precondition"
    | "authorization"
    | "human_confirmation"
    | "policy"
    | "resource"
    | "idempotency"
    | "state_freshness"
    | "task_availability"
    | "task_timing";

  result:
    | "allowed"
    | "denied"
    | "waiting"
    | "error";

  checkedAt: string;
  evidenceRefs: string[];

  denialCode?: string;
  denialSummary?: string;
}
```

## 14.4 Human Confirmation

```ts
export interface HumanConfirmationPayload {
  confirmationId: string;

  subjectType:
    | "plan"
    | "plan_step"
    | "action"
    | "remote_task_schedule";

  subjectId: string;

  requestType:
    | "approve"
    | "reject"
    | "provide_input"
    | "select_option";

  status:
    | "requested"
    | "approved"
    | "rejected"
    | "expired"
    | "cancelled";

  requestedAt: string;
  respondedAt?: string;

  responderId?: string;
  responseSummary?: string;

  boundGoalVersion: number;
  boundPlanVersion?: number;

  validAtExecutionTime?: boolean;
}
```

---

# 15. Action 与同步/异步执行语义

## 15.1 Action

```ts
export interface ActionPayload {
  actionId: string;

  planId?: string;
  planVersion?: number;
  planStepId?: string;

  decisionId?: string;
  basisId: string;

  actionType:
    | "read"
    | "write"
    | "control"
    | "simulation"
    | "delegate"
    | "human_request";

  actionName: string;

  targetType: string;
  targetId: string;

  capability?: string;

  status:
    | "requested"
    | "accepted"
    | "running"
    | "waiting_remote_task"
    | "completed"
    | "failed"
    | "cancelled";

  executionSemantics: ActionExecutionSemantics;

  riskLevel:
    | "none"
    | "low"
    | "medium"
    | "high"
    | "critical";

  idempotencyKey?: string;

  policyDecisionIds: string[];
  gateDecisionIds: string[];
  confirmationId?: string;

  inputSummary: string;
  inputHash: string;
  inputArtifactRef?: string;

  externalOperationId?: string;

  remoteTask?: {
    taskMode:
      | "allow_task"
      | "require_task";

    availabilityCheckId?: string;
    reservationRef?: string;
    requestedTiming?: TaskExecutionTiming;
  };

  requestedAt: string;
  startedAt?: string;
  endedAt?: string;
}
```

## 15.2 Execution Semantics

```ts
export interface ActionExecutionSemantics {
  effect:
    | "read_only"
    | "side_effecting"
    | "unknown";

  execution:
    | "synchronous"
    | "task_capable"
    | "task_required"
    | "unknown";

  cancellation:
    | "unsupported"
    | "cooperative"
    | "task_cancel"
    | "unknown";

  idempotency:
    | "none"
    | "client_request_key"
    | "server_managed"
    | "unknown";

  replay:
    | "allowed"
    | "simulation_only"
    | "forbidden"
    | "unknown";

  source:
    | "mcp_declared"
    | "admin_override"
    | "default_unknown";
}
```

## 15.3 MCP Task Execution Spec

```ts
export interface McpTaskExecutionSpec {
  mode:
    | "allow_task"
    | "require_task";

  timing?: TaskExecutionTiming;

  availabilityCheck:
    | "required"
    | "best_effort";
}
```

---

# 16. Action Receipt

```ts
export interface ActionReceiptPayload {
  receiptId: string;
  actionId: string;

  receiptType:
    | "immediate_result"
    | "remote_task_created"
    | "remote_task_update"
    | "remote_task_terminal"
    | "cancellation"
    | "reconciliation";

  transportStatus:
    | "success"
    | "failure"
    | "timeout"
    | "unknown";

  executorStatus:
    | "accepted"
    | "rejected"
    | "working"
    | "completed"
    | "failed"
    | "cancelled"
    | "input_required"
    | "unknown";

  businessStatus:
    | "not_started"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "unknown";

  providerId?: string;
  serverId?: string;
  operationName?: string;

  bindingId?: string;
  remoteTaskId?: string;
  remoteRevision?: string;

  providerSubstate?: ProviderTaskSubstate;

  externalCommandId?: string;

  outcomeCode?: string;

  resultSummary?: string;
  resultHash?: string;
  resultArtifactRef?: string;

  errorCode?: string;
  errorSummary?: string;

  receivedAt: string;
}
```

---

# 17. MCP Task Availability 与时间合同

## 17.1 Availability Check

```ts
export interface TaskAvailabilityCheckPayload {
  availabilityCheckId: string;

  providerId: string;
  serverId: string;
  operationName: string;

  workflowInstanceId?: string;
  workflowNodeId: string;

  checkPhase:
    | "dsl_readiness"
    | "pre_execution";

  argumentsState:
    | "complete"
    | "partial"
    | "unresolved";

  knownArgumentsHash?: string;
  argumentsArtifactRef?: string;
  unresolvedPaths: string[];

  requestedTiming?: TaskExecutionTiming;

  availability:
    | "available"
    | "restricted"
    | "disabled"
    | "unknown";

  riskLevel:
    | "low"
    | "medium"
    | "high"
    | "critical";

  reasonCode?: string;
  description?: string;

  validUntil?: string;

  earliestStartTime?: string;
  nextAvailableWindows: TaskAvailableWindow[];
  estimatedDelayMs?: number;

  reservationMode:
    | "none"
    | "best_effort"
    | "guaranteed";

  reservationRef?: string;

  possibleEffects: Array<
    | "task_preemption"
    | "task_pause"
    | "start_rejection"
    | "start_window_missed"
    | "deadline_reached"
    | "partial_completion"
  >;

  checkedAt: string;
}
```

```ts
export interface TaskAvailableWindow {
  startTime: string;
  endTime: string;
}
```

## 17.2 Timing Contract

```ts
export interface TaskExecutionTiming {
  start:
    | {
        mode: "immediate";
        startToleranceMs: number;
      }
    | {
        mode: "scheduled";
        scheduledAt: string;
        startToleranceMs: number;
      };

  maxElapsedMs: number | null;
}
```

```ts
export interface RemoteTaskTimingSnapshot {
  requestedTiming?: TaskExecutionTiming;

  acceptedAt?: string;
  scheduledAt?: string;
  latestStartAt?: string;
  startedAt?: string;
  deadlineAt?: string;
  terminalAt?: string;

  providerTimeAnchor?:
    | "accepted_at"
    | "scheduled_at";
}
```

规则：

* `disabled` 必须阻断调用；
* `restricted` 应返回可用窗口；
* `guaranteed` 必须有 `reservationRef`；
* DSL Readiness 不能替代执行前复查；
* `start_window_missed` 和 `deadline_reached` 只能来自 Provider 最终结果。

---

# 18. RemoteTaskBinding

```ts
export type ProviderTaskSubstate =
  | "scheduled"
  | "queued"
  | "running"
  | "paused"
  | "resuming"
  | "stopping"
  | "unknown";

export interface RemoteTaskBindingPayload {
  bindingId: string;

  providerId: string;
  serverId: string;
  operationName: string;
  remoteTaskId: string;

  toolCallId: string;
  actionId: string;
  receiptId?: string;

  a2aTaskId: string;
  contextId: string;

  workflowPlanId: string;
  workflowInstanceId: string;
  workflowNodeId: string;

  goalId: string;
  goalVersion: number;
  planId: string;
  planVersion: number;

  protocolStatus:
    | "working"
    | "input_required"
    | "completed"
    | "failed"
    | "cancelled";

  localState:
    | "binding"
    | "polling"
    | "awaiting_input"
    | "terminal_event_pending"
    | "terminal_event_claimed"
    | "reentering"
    | "reentered"
    | "closed"
    | "uncertain";

  executionMode:
    | "live"
    | "simulation"
    | "historical-replay";

  simulationId?: string;

  requestedTiming?: TaskExecutionTiming;
  timingSnapshot?: RemoteTaskTimingSnapshot;

  currentProviderSubstate?: ProviderTaskSubstate;
  currentObservationRevision?: string;

  nextPollAt?: string;
  pollAttempt: number;
  providerFailureCount: number;

  cancelRequested: boolean;
  cancelRequestedAt?: string;
  cancellationUncertain: boolean;

  resultHash?: string;
  resultArtifactRef?: string;

  errorCode?: string;
  errorSummary?: string;

  bindingVersion: number;

  createdAt: string;
  updatedAt: string;
  terminalAt?: string;
}
```

唯一约束：

```text
UNIQUE(binding_id)
UNIQUE(server_id, remote_task_id)
```

---

# 19. Remote Task Observation

```ts
export interface RemoteTaskObservationPayload {
  observationId: string;
  bindingId: string;

  providerId: string;
  remoteTaskId: string;

  observationType:
    | "accepted"
    | "scheduled"
    | "started"
    | "paused"
    | "resumed"
    | "progress"
    | "heartbeat"
    | "provider_unreachable";

  protocolStatus:
    | "working"
    | "input_required"
    | "completed"
    | "failed"
    | "cancelled";

  providerSubstate?: ProviderTaskSubstate;

  remoteRevision?: string;
  observationRevision?: string;

  progressPercent?: number;
  progressSummary?: string;

  reasonCode?: string;
  reasonSummary?: string;

  providerObservedAt?: string;
  receivedAt: string;

  rawSnapshotHash: string;
  rawSnapshotArtifactRef?: string;
}
```

Observation 不直接改变 Workflow 控制流。

---

# 20. Remote Task Control Event

```ts
export interface RemoteTaskControlEventPayload {
  controlEventId: string;
  bindingId: string;

  eventType:
    | "task.input_required"
    | "task.completed"
    | "task.failed"
    | "task.cancelled";

  remoteRevision?: string;
  resultHash?: string;

  protocolStatus:
    | "input_required"
    | "completed"
    | "failed"
    | "cancelled";

  resultIsError?: boolean;
  outcomeCode?: string;

  payloadArtifactRef?: string;

  processingStatus:
    | "pending"
    | "claimed"
    | "processed"
    | "failed"
    | "ignored_stale";

  claimedBy?: string;
  claimAttempt: number;

  createdAt: string;
  claimedAt?: string;
  processedAt?: string;

  continuationAttemptId?: string;

  errorCode?: string;
  errorSummary?: string;
}
```

该记录必须为 durable。

---

# 21. Workflow Continuation

## 21.1 Continuation Snapshot

```ts
export interface WorkflowContinuationSnapshotPayload {
  continuationId: string;

  workflowInstanceId: string;
  workflowPlanId: string;
  workflowDefinitionId: string;
  workflowVersion: number;

  stateVersion: string;
  snapshotVersion: number;

  waitingBindings: Array<{
    bindingId: string;
    workflowNodeId: string;
    remoteTaskId: string;
  }>;

  waitingNodeIds: string[];
  runnableFrontier: string[];

  completedNodeIds: string[];
  failedNodeIds: string[];
  skippedNodeIds: string[];

  outputsArtifactRef?: string;
  errorsArtifactRef?: string;

  routes: Record<string, string>;
  loopCounts: Record<string, number>;
  recoveryCounts: Record<string, number>;

  completedParallelPredecessors: Record<
    string,
    string[]
  >;

  executionMode:
    | "live"
    | "simulation"
    | "historical-replay";

  simulationId?: string;

  snapshotHash: string;

  createdAt: string;
  updatedAt: string;
}
```

## 21.2 Continuation Attempt

```ts
export interface WorkflowContinuationAttemptPayload {
  continuationAttemptId: string;
  continuationId: string;

  controlEventId: string;
  bindingId: string;

  workflowInstanceId: string;
  workflowNodeId: string;

  expectedStateVersion: string;
  actualStateVersion?: string;

  status:
    | "created"
    | "claimed"
    | "running"
    | "completed"
    | "failed"
    | "ignored_stale";

  newlyRunnableNodeIds: string[];
  remainingWaitingNodeIds: string[];

  resultingStateVersion?: string;
  resultingSnapshotId?: string;

  errorCode?: string;
  errorSummary?: string;

  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}
```

Continuation 必须从持久化 Frontier 继续，不得从 `START` 重放整个 Workflow。

---

# 22. Remote Task Poll Attempt

```ts
export interface RemoteTaskPollAttemptPayload {
  pollAttemptId: string;
  bindingId: string;

  expectedBindingVersion: number;
  actualBindingVersion?: number;

  attemptNumber: number;

  result:
    | "status_received"
    | "provider_unreachable"
    | "schema_invalid"
    | "stale_job"
    | "binding_closed"
    | "schedule_next"
    | "control_event_created";

  protocolStatus?: string;
  providerSubstate?: ProviderTaskSubstate;

  latencyMs?: number;

  providerFailureCount: number;
  nextPollAt?: string;

  errorCode?: string;
  errorSummary?: string;

  startedAt: string;
  endedAt: string;
}
```

普通 Poll Attempt 可以为 best-effort。

以下情况必须另外产生 durable 质量事件：

* 控制事件创建失败；
* Schema 长期无法解析；
* Binding 永久失去轮询；
* Provider 长期不可达；
* 状态和本地 Binding 冲突。

---

# 23. Remote Task Input Link

```ts
export interface RemoteTaskInputLinkPayload {
  inputLinkId: string;

  inputRequestId: string;
  bindingId: string;
  remoteTaskId: string;

  workflowInstanceId: string;
  workflowNodeId: string;

  requestSchemaRef?: string;

  status:
    | "requested"
    | "response_received"
    | "update_sent"
    | "accepted"
    | "rejected"
    | "cancelled";

  responseHash?: string;
  responseArtifactRef?: string;

  requestedAt: string;
  respondedAt?: string;
  updatedAt?: string;
}
```

`tasks/update` 成功不代表 Workflow 节点完成，仍需等待远程 Task 终态。

---

# 24. Remote Task Cancel

```ts
export interface RemoteTaskCancelPayload {
  cancellationId: string;

  bindingId: string;
  remoteTaskId: string;

  requestedBy:
    | "a2a_task"
    | "workflow"
    | "goal_patch"
    | "operator"
    | "system";

  requestStatus:
    | "requested"
    | "sent"
    | "provider_acknowledged"
    | "confirmed_cancelled"
    | "completed_before_cancel"
    | "failed"
    | "uncertain";

  reasonCode?: string;
  reasonSummary?: string;

  requestedAt: string;
  sentAt?: string;
  resolvedAt?: string;

  evidenceRefs: string[];
}
```

SDAR 发送 `tasks/cancel` 后不得立即伪造远程 Task 已取消。

---

# 25. Remote Task Reconciliation

```ts
export interface RemoteTaskReconciliationPayload {
  reconciliationId: string;

  bindingId?: string;

  reconciliationType:
    | "startup_scan"
    | "periodic_scan"
    | "missing_poll_job"
    | "duplicate_poll_job"
    | "stale_poll_job"
    | "terminal_job_cleanup"
    | "binding_result_mismatch"
    | "continuation_event_mismatch";

  result:
    | "no_action"
    | "poll_scheduled"
    | "duplicate_removed"
    | "binding_updated"
    | "control_event_recreated"
    | "quality_issue_created"
    | "failed";

  previousState?: string;
  resultingState?: string;

  errorCode?: string;
  errorSummary?: string;

  reconciledAt: string;
}
```

---

# 26. Verification

```ts
export interface VerificationPayload {
  verificationId: string;

  criterionId: string;

  actionId?: string;
  receiptId?: string;
  bindingId?: string;

  verificationType:
    | "state_query"
    | "receipt_check"
    | "remote_task_result"
    | "output_schema"
    | "business_rule"
    | "human_confirmation"
    | "model_assessment"
    | "composite";

  expectedValue?: unknown;
  actualValue?: unknown;

  result:
    | "passed"
    | "failed"
    | "inconclusive"
    | "not_applicable";

  confidence?: number;

  verificationChannel: string;
  evidenceRefs: string[];

  failureCode?: string;
  failureSummary?: string;

  verifiedAt: string;
}
```

Remote Task `completed` 不等于 Goal 完成，仍需执行 Verification。

---

# 27. Episode Outcome

```ts
export interface EpisodeOutcomePayload {
  outcomeId: string;

  terminalStatus:
    | "completed"
    | "failed"
    | "cancelled"
    | "capability_gap";

  goalStatus:
    | "achieved"
    | "unachievable"
    | "active"
    | "cancelled";

  workflowStatus:
    | "completed"
    | "failed"
    | "cancelled"
    | "capability_gap";

  finalGoalVersion: number;
  finalPlanVersion?: number;
  finalStateVersion: string;

  processedResultRef?: string;
  finalResponseRef?: string;

  completedCriterionIds: string[];
  failedCriterionIds: string[];
  unverifiedCriterionIds: string[];

  remainingItems: RemainingItem[];
  residualRisks: ResidualRisk[];

  unresolvedRemoteTaskBindingIds: string[];
  uncertainCancellationBindingIds: string[];

  outcomeSummary: string;
  committedAt: string;
}
```

---

# 28. Model、Tool 与 Memory

## 28.1 Model Call

```ts
export interface ModelCallPayload {
  modelCallId: string;

  purpose:
    | "goal_understanding"
    | "skill_selection"
    | "skill_input_resolution"
    | "planning"
    | "task_availability_decision"
    | "task_reschedule_decision"
    | "decision"
    | "replanning"
    | "recovery"
    | "verification"
    | "evaluation"
    | "other";

  provider: string;
  model: string;

  promptId?: string;
  promptVersion?: string;

  inputSummary: string;
  inputHash: string;
  inputArtifactRef?: string;

  outputSummary?: string;
  outputHash?: string;
  outputArtifactRef?: string;

  structuredOutputSchemaRef?: string;
  structuredOutputValid?: boolean;

  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;

  estimatedCost?: number;
  currency?: string;

  latencyMs: number;

  status:
    | "success"
    | "failure"
    | "timeout"
    | "cancelled";

  errorCode?: string;
}
```

## 28.2 Tool Call

```ts
export interface ToolCallPayload {
  toolCallId: string;
  actionId?: string;

  serverId: string;
  toolName: string;
  toolVersion?: string;

  executionMode:
    | "live"
    | "simulation"
    | "historical-replay";

  semantics: ActionExecutionSemantics;

  argumentsSummary: string;
  argumentsHash: string;
  argumentsArtifactRef?: string;

  invocationOutcome:
    | "immediate"
    | "remote_task"
    | "business_error"
    | "protocol_error";

  bindingId?: string;
  remoteTaskId?: string;

  resultSummary?: string;
  resultHash?: string;
  resultArtifactRef?: string;

  status:
    | "requested"
    | "completed"
    | "failed"
    | "timeout";

  latencyMs?: number;

  errorCode?: string;
  errorSummary?: string;
}
```

`ToolCall` 只表示 `tools/call` 请求，不延伸到远程 Task 整个生命周期。

## 28.3 Memory

```ts
export interface MemoryOperationPayload {
  memoryOperationId: string;

  operation:
    | "retrieve"
    | "admit"
    | "reject"
    | "write"
    | "supersede"
    | "invalidate";

  memoryType: string;

  durability:
    | "durable"
    | "volatile"
    | "unknown";

  authority:
    | "mcp"
    | "skill_experience"
    | "admin"
    | "model_inferred";

  status:
    | "success"
    | "failure"
    | "rejected"
    | "skipped";

  reasonSummary?: string;

  memoryRecordId?: string;
  evidenceRefs: string[];

  latencyMs?: number;
}
```

Remote Task 当前状态属于 volatile，不应自动进入长期 Memory。

---

# 29. Evaluation Readiness

```ts
export interface EvaluationReadinessPayload {
  readinessId: string;

  status:
    | "ready"
    | "degraded"
    | "not_ready";

  sealed: boolean;

  expectedEvidenceCount: string;
  actualEvidenceCount: string;

  lastExpectedEvidenceSequence: string;
  lastActualEvidenceSequence: string;

  evidenceSequenceComplete: boolean;
  stateTrajectoryComplete: boolean;

  actionReceiptComplete: boolean;
  verificationCoverageComplete: boolean;

  remoteTaskBindingComplete: boolean;
  remoteTaskTerminalComplete: boolean;
  continuationComplete: boolean;

  pendingDurableEvidenceCount: number;

  unresolvedRemoteTaskCount: number;
  uncertainCancellationCount: number;

  missingEvidenceTypes: string[];
  qualityIssueIds: string[];

  checkedAt: string;
}
```

## 29.1 `ready`

要求：

* 存在 `run.sealed`；
* Evidence Sequence 无缺口；
* 最终状态可重建；
* Action/Receipt 完整；
* Verification 完整；
* 所有 RemoteTaskBinding 已进入明确终态；
* 所有 Task Control Event 已完成处理；
* 所有 Continuation Attempt 已完成或合法失效；
* 没有取消不确定性；
* 没有 pending durable Evidence。

## 29.2 `degraded`

关键证据完整，但缺少：

* 普通 Progress；
* Heartbeat；
* 部分 Model Span；
* 部分 Poll 性能数据。

## 29.3 `not_ready`

包括：

* Binding 丢失；
* 远端 Task 无终态；
* 控制事件未处理；
* Workflow Continuation 失败；
* 重复副作用风险；
* 取消状态不确定；
* 状态轨迹断裂。

---

# 30. 数据质量问题

```ts
export interface EvidenceQualityIssuePayload {
  issueId: string;

  issueType:
    | "schema_invalid"
    | "sequence_gap"
    | "evidence_sequence_gap"
    | "duplicate_payload_conflict"
    | "state_version_gap"
    | "illegal_state_transition"
    | "missing_action_receipt"
    | "missing_verification"
    | "stale_goal_version"
    | "stale_plan_version"
    | "orphan_record"
    | "unsealed_episode"
    | "missing_remote_task_binding"
    | "duplicate_remote_task_binding"
    | "remote_task_without_terminal"
    | "remote_task_revision_conflict"
    | "control_event_unprocessed"
    | "continuation_snapshot_missing"
    | "continuation_replay_risk"
    | "poll_chain_broken"
    | "cancellation_uncertain"
    | "provider_status_conflict";

  severity:
    | "warning"
    | "error"
    | "critical";

  affectedRecordIds: string[];

  detectedAt: string;

  status:
    | "open"
    | "resolved"
    | "ignored";

  description: string;
  remediation?: string;
}
```

---

# 31. 事件目录

## 31.1 Runtime

```text
run.started
run.suspended
run.resumed
run.completed
run.failed
run.cancelled
run.sealed

segment.started
segment.completed
segment.failed
segment.suspended
```

## 31.2 Request 和 A2A

```text
request.received
request.accepted
request.rejected

a2a_task.state_changed
a2a_task.input_required
a2a_task.input_received
a2a_task.cancel_requested
```

## 31.3 Goal 和 Plan

```text
goal.created
goal.activated
goal.patched
goal.achieved
goal.unachievable
goal.cancelled
goal.superseded

plan.generated
plan.validation_completed
plan.confirmation_requested
plan.approved
plan.rejected
plan.executing
plan.completed
plan.failed
plan.superseded

plan_step.started
plan_step.waiting_remote_task
plan_step.completed
plan_step.failed
plan_step.skipped
```

## 31.4 State、Decision、Policy

```text
state.snapshot_recorded
state.transition_committed

domain_event.recorded

decision.created
decision.accepted
decision.superseded

policy.evaluated
execution_gate.evaluated

human_confirmation.requested
human_confirmation.received
```

## 31.5 Action 和 Receipt

```text
action.requested
action.accepted
action.running
action.waiting_remote_task
action.completed
action.failed
action.cancelled

receipt.received
```

## 31.6 MCP Task Availability

```text
mcp_task.availability_checked
mcp_task.availability_expired
mcp_task.reservation_received
mcp_task.rescheduled
```

## 31.7 MCP Task Binding

```text
mcp_task.binding_created
mcp_task.binding_failed
mcp_task.binding_closed
mcp_task.binding_uncertain
```

## 31.8 MCP Task Observation

```text
mcp_task.accepted
mcp_task.scheduled
mcp_task.started
mcp_task.paused
mcp_task.resumed
mcp_task.progress
mcp_task.heartbeat
mcp_task.provider_unreachable
```

## 31.9 MCP Task Control

```text
mcp_task.input_required
mcp_task.completed
mcp_task.failed
mcp_task.cancelled
```

## 31.10 Polling

```text
mcp_task.poll_started
mcp_task.poll_completed
mcp_task.poll_failed
mcp_task.poll_rescheduled
```

## 31.11 Continuation

```text
workflow.waiting_remote_task
workflow.continuation_snapshot_saved
workflow.continuation_event_claimed
workflow.continuation_started
workflow.continuation_completed
workflow.continuation_failed
workflow.continuation_ignored_stale
```

## 31.12 Input 和 Cancel

```text
mcp_task.input_link_created
mcp_task.input_response_received
mcp_task.input_update_sent

mcp_task.cancel_requested
mcp_task.cancel_sent
mcp_task.cancel_confirmed
mcp_task.cancel_uncertain
```

## 31.13 Reconciliation

```text
mcp_task.reconciliation_started
mcp_task.reconciliation_repaired
mcp_task.reconciliation_failed
```

## 31.14 Verification 和 Outcome

```text
verification.completed
verification.failed
verification.inconclusive

episode.outcome_committed
evaluation.readiness_checked
```

---

# 32. 交付等级

| 数据                            | Delivery              | 评价必需 |
| ----------------------------- | --------------------- | ---: |
| Goal、Plan、State Transition    | durable               |    是 |
| Decision、Policy、Gate          | durable               |    是 |
| Human Confirmation            | durable               |    是 |
| Action、Receipt                | durable               |    是 |
| Verification、Outcome          | durable               |    是 |
| Availability Check            | durable               |    是 |
| Guaranteed Reservation        | durable               |    是 |
| RemoteTaskBinding             | durable               |    是 |
| Remote Task Control Event     | durable               |    是 |
| Continuation Snapshot         | durable               |    是 |
| Continuation Attempt          | durable               |    是 |
| Input Link                    | durable               |    是 |
| Cancel Request/Uncertainty    | durable               |    是 |
| Reconciliation Repair         | durable               |    是 |
| Task Terminal Result          | durable               |    是 |
| Task scheduled/paused/resumed | best-effort 或 durable | 条件使用 |
| Task progress/heartbeat       | best-effort           |    否 |
| Poll Attempt                  | best-effort           |    否 |
| Provider 短暂不可达                | best-effort           |    否 |
| Provider 长期不可达                | durable               |    是 |
| LLM Span、Token、成本             | best-effort           | 条件使用 |
| HTTP、DB Trace                 | best-effort           |    否 |

---

# 33. ClickHouse 表映射

## 33.1 `sdar_core`

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

model_call_record
tool_call_record
memory_operation_record

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

artifact_reference
evaluation_readiness
evidence_quality_issue
ingestion_dead_letter
```

## 33.2 `sdar_meta`

```text
schema_definition
event_definition
event_policy
data_quality_rule
projection_version
collector_version
metric_definition
```

---

# 34. ClickHouse 通用列

```sql
tenant_id String,
project_id String,
environment LowCardinality(String),

record_id UUID,
episode_id UUID,
run_id UUID,
segment_id UUID,

agent_id String,
agent_type LowCardinality(String),
agent_version LowCardinality(String),
application_version LowCardinality(String),

a2a_task_id String DEFAULT '',
correlation_id String,

trace_id String,
span_id String DEFAULT '',
parent_span_id String DEFAULT '',

sequence UInt64,
evidence_sequence Nullable(UInt64),

schema_name LowCardinality(String),
schema_version UInt16,

occurred_at DateTime64(3, 'UTC'),
observed_at Nullable(DateTime64(3, 'UTC')),
ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),

payload_hash FixedString(64),
attributes_json String DEFAULT '{}' CODEC(ZSTD(3))
```

大部分事实表：

```sql
PARTITION BY toYYYYMM(occurred_at)
ORDER BY
(
  tenant_id,
  project_id,
  episode_id,
  occurred_at,
  sequence,
  record_id
)
```

Remote Task 高频表可以额外按：

```text
binding_id
remote_task_id
```

建立排序和跳数索引。

---

# 35. 状态轨迹

状态轨迹由以下事实生成：

```text
Request
→ Goal
→ Plan
→ Decision
→ Availability
→ Action
→ tools/call
→ Binding
→ waiting_external
→ Observation/Poll
→ Control Event
→ Continuation
→ Receipt
→ State Transition
→ Verification
→ Outcome
```

建议生成：

```text
sdar_core.state_trajectory
```

关键字段：

```text
episode_id
trajectory_step
from_state_version
trigger_event_id
decision_id
action_id
binding_id
remote_task_id
control_event_id
continuation_id
receipt_id
verification_id
to_state_version
transition_status
occurred_at
```

---

# 36. 关键完整性规则

## 36.1 Goal 和 Plan

* Action 必须记录 GoalVersion；
* 计划内 Action 必须记录 PlanVersion、PlanStepId；
* Goal Patch 后旧 Plan 必须失效或重验证；
* Replan 必须产生新 PlanVersion。

## 36.2 Remote Task Binding

* 返回远程 Task 后必须先保存 Binding，再进入 `waiting_remote_task`；
* Binding 保存失败不得伪造等待成功；
* 一个 Provider Task 只能对应一个有效 Binding；
* Binding 必须绑定 Server、Provider、Workflow Instance 和 Node。

## 36.3 Poll 和 Control Event

* Observation 不能直接恢复 Workflow；
* 只有 Control Event 可以触发 Continuation；
* Control Event 必须先落库再执行；
* Control Event 必须幂等 Claim；
* 陈旧事件必须标记为 `ignored_stale`。

## 36.4 Continuation

* 不得从 Workflow START 重放；
* 已完成节点不得重放；
* 已完成副作用不得重放；
* 其他远程 Task 不得重复创建；
* 一个 Task 完成只能解除对应等待节点；
* Parallel Join 必须保留已完成前驱。

## 36.5 Cancel

* `tasks/cancel` 是请求，不是终态；
* Provider 未确认前不得写 `cancelled`；
* Provider 不可达时必须记录取消不确定性。

## 36.6 Receipt 和 Verification

* Remote Task completed 只能形成 Receipt；
* Receipt 成功不直接等于 Goal 完成；
* 关键成功条件必须有 Verification；
* `deadline_reached` 等结果必须由 Provider 返回。

## 36.7 Evaluation Ready

必须满足：

* Run Seal 存在；
* Evidence Sequence 连续；
* Remote Task Binding 全部有明确处理结果；
* Control Event 全部处理；
* Continuation 全部完成或合法失效；
* 无取消不确定性；
* 最终状态轨迹可重建。

---

# 37. v1.2 最小采集覆盖

v1.2 发布时必须完成：

```text
Episode / Run / Segment
Request / A2A Task
Goal / Constraint / Success Criterion
Plan / Plan Step
Execution Basis
State Snapshot / State Transition
Decision / Policy / Gate / Confirmation
Action / Receipt / Verification / Outcome
Model / Tool / Memory

Task Availability
Task Timing
RemoteTaskBinding
RemoteTaskObservation
RemoteTaskControlEvent
RemoteTaskPollAttempt
RemoteTaskInputLink
RemoteTaskCancel
RemoteTaskReconciliation
WorkflowContinuationSnapshot
WorkflowContinuationAttempt

Artifact
Evaluation Readiness
Evidence Quality Issue
```

---

# 38. 最终采集链路

```text
SDAR Runtime
    ↓
AgentTelemetryClient
    ├─ best_effort
    │     ↓
    │   OTel Batch
    │
    └─ durable
          ↓
    PostgreSQL Evidence + Outbox
          ↓
      Outbox Exporter
          ↓
OpenTelemetry Collector
          ↓
       ClickHouse
    ├─ sdar_core
    └─ sdar_meta
          ↓
State Trajectory
Evaluation Readiness
          ↓
     SDAR V2 评价器
```

最终原则：

1. 业务侧只有一个采集客户端；
2. 普通遥测和关键证据使用不同可靠性等级；
3. MCP Tool Invocation 和 Remote Task 生命周期分开；
4. Observation 和 Control Event 分开；
5. Provider 状态只作为观测副本；
6. Workflow Continuation 必须持久化且不可重放副作用；
7. ClickHouse 是唯一正式分析事实源；
8. PostgreSQL 是 Runtime 事务事实源；
9. 所有关键证据可重建、可审计、可重新评价；
10. 不保存模型隐藏思维过程。
