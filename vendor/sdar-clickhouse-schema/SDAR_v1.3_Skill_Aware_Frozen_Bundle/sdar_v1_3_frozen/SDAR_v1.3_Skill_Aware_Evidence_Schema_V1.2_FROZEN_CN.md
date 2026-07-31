# SDAR v1.3 Skill-aware 统一语义采集与评价证据 Schema V1.2（冻结版）

> **文档状态：FROZEN / 冻结**  
> **目标版本：SDAR v1.3.0**  
> **文档修订：V1.2**  
> **Schema Family：`sdar.evidence/v1`**  
> **冻结日期：2026-07-17**  
> **依赖：v1.1 MCP Tasks、v1.2 Skill 驱动的能力使用体系**  
> **运行权威：PostgreSQL**  
> **分析权威：ClickHouse `sdar_core` / `sdar_meta`**  
> **时间标准：UTC，ClickHouse 使用 `DateTime64(3, 'UTC')`**

---

## 0. Schema 冻结规则

1. 每一种 `recordType` 独立维护 `schemaName + schemaVersion`；
2. `applicationVersion` 与 `schemaVersion` 不绑定；
3. 新增可选字段为兼容变更；
4. 删除字段、改变含义、改变必填性或 ID 关系为非兼容变更；
5. transactional Evidence 不允许采样；
6. 同一 `recordId` 重复交付时，`payloadHash` 必须一致；
7. 同一 `recordId`、不同 `payloadHash` 必须产生质量问题；
8. Domain/Application 层不得直接构造或发送 Evidence；
9. Evidence 由基础设施在权威提交点生成；
10. 不保存模型隐藏思维链。

---

# 1. Schema 覆盖范围

本 Schema 覆盖以下主链：

```text
Request
→ Goal
→ Skill Discovery
→ Skill Applicability
→ Context Resolution
→ Skill Selection
→ Mode Selection
→ Skill Composition
→ Capability Slot Resolution
→ Guidance / Template / Procedure
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

# 2. 全局关联键

所有 Canonical Evidence 必须包含：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `tenantId` | string | 是 | 租户或组织 |
| `projectId` | string | 是 | 项目标识 |
| `environment` | enum | 是 | dev/test/staging/prod |
| `agentId` | string | 是 | Agent 实例 |
| `agentType` | string | 是 | 首期为 `sdar` |
| `agentVersion` | string | 是 | Agent 版本 |
| `applicationVersion` | string | 是 | 软件版本 |
| `episodeId` | UUID | 是 | 评价 Episode |
| `runId` | UUID | 是 | 一次 Runtime Run |
| `segmentId` | UUID | 是 | 连续活跃执行阶段 |
| `correlationId` | string | 是 | 跨系统关联 |
| `traceId` | string | 是 | OTel Trace ID |
| `recordId` | UUID | 是 | Evidence 唯一 ID |
| `recordType` | string | 是 | Canonical Record Type |
| `schemaName` | string | 是 | Payload Schema 名 |
| `schemaVersion` | integer | 是 | Payload Schema 版本 |
| `sequence` | UInt64/string | 是 | Run 内总顺序 |
| `evidenceSequence` | UInt64/string | 条件 | transactional required Evidence 连续顺序 |
| `occurredAt` | RFC3339 | 是 | 事实发生时间 |
| `observedAt` | RFC3339 | 否 | 外部状态实际观测时间 |
| `payloadHash` | SHA-256 | 是 | Canonical Payload Hash |

可选关联：

```text
sessionId
conversationId
a2aTaskId
spanId
parentSpanId

goalId
goalVersion
planId
planVersion
planStepId
workflowInstanceId
workflowNodeId

decisionId
actionId
receiptId
verificationId

bindingId
remoteTaskId
controlEventId
continuationId

skillId
skillVersion
skillExecutionId
rootSkillExecutionId
parentSkillExecutionId
compositionId
capabilitySlotId
planComplianceId
```

---

# 3. 全局枚举

```ts
export type DeliveryGuarantee =
  | "transactional"
  | "buffered";

export type EvaluationRole =
  | "required"
  | "supporting"
  | "diagnostic";

export type SkillExecutionMode =
  | "guidance"
  | "template"
  | "procedure";

export type SkillFailurePolicy =
  | "fail_fast"
  | "recoverable"
  | "optional"
  | "degraded";

export type SkillUsageSpecSource =
  | "native"
  | "legacy_projection";

export type SkillApplicabilityStatus =
  | "satisfied"
  | "partial"
  | "unsatisfied"
  | "unknown";

export type SkillExecutionStatus =
  | "selected"
  | "planning"
  | "executing"
  | "waiting_external"
  | "completed"
  | "failed"
  | "cancelled"
  | "degraded";
```

---

# 4. Canonical Evidence Envelope

```ts
export interface CanonicalEvidenceEnvelope<TPayload> {
  evidenceFamily: "sdar.evidence/v1";

  recordId: string;
  recordType: string;

  schemaName: string;
  schemaVersion: number;

  eventType: string;
  eventCategory:
    | "runtime"
    | "request"
    | "goal"
    | "skill"
    | "plan"
    | "state"
    | "decision"
    | "policy"
    | "human"
    | "action"
    | "receipt"
    | "verification"
    | "outcome"
    | "mcp_task"
    | "continuation"
    | "model"
    | "tool"
    | "memory"
    | "quality";

  deliveryGuarantee: DeliveryGuarantee;
  evaluationRole: EvaluationRole;

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

  skillId?: string;
  skillVersion?: number;
  skillExecutionId?: string;
  rootSkillExecutionId?: string;
  parentSkillExecutionId?: string;

  usageSpecVersion?: string;
  usageSpecHash?: string;
  usageSpecSource?: SkillUsageSpecSource;

  skillExecutionMode?: SkillExecutionMode;
  compositionId?: string;
  capabilitySlotId?: string;
  recursionDepth?: number;
  remainingRecursionBudget?: number;
  failurePolicy?: SkillFailurePolicy;
  planComplianceId?: string;

  aggregateType: string;
  aggregateId: string;

  evidenceRefs: EvidenceReference[];
  artifactRefs: ArtifactReference[];

  attributes: Record<string, string>;

  payloadHash: string;
  payload: TPayload;

  occurredAt: string;
  observedAt?: string;
}
```

---

# 5. 引用对象

```ts
export interface EvidenceReference {
  evidenceId: string;

  evidenceType: string;

  sourceSystem:
    | "sdar"
    | "mcp_provider"
    | "upstream_agent"
    | "human"
    | "artifact_store"
    | "other";

  sourceRecordId?: string;
  uri?: string;
  checksum?: string;

  producedAt?: string;

  producerRefs?: string[];
}
```

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
    | "skill_package"
    | "skill_usage_snapshot"
    | "skill_normative_snapshot"
    | "skill_adaptive_snapshot"
    | "skill_composition_snapshot"
    | "skill_template_instance"
    | "skill_procedure_program"
    | "skill_plan_compliance_report"
    | "skill_execution_tree"
    | "skill_patch_candidate"
    | "attachment"
    | "debug_bundle"
    | "other";

  preview?: string;
  createdAt: string;
}
```

---

# 6. Skill Usage Snapshot

```ts
export interface SkillUsageSnapshotPayload {
  skillId: string;
  skillVersion: number;

  usageSpecVersion: string;
  usageSpecHash: string;
  usageSpecSource: SkillUsageSpecSource;

  visibility:
    | "user_selectable"
    | "composable"
    | "internal_only";

  supportedModes: SkillExecutionMode[];
  defaultMode: SkillExecutionMode;

  normativeHash: string;
  adaptiveHash: string;
  evidencePolicyHash: string;

  packageChecksum?: string;
  packageSourceRef?: string;

  snapshotArtifactRef: string;

  lifecycleStatus:
    | "draft"
    | "candidate"
    | "active"
    | "deprecated"
    | "retired"
    | "disabled";

  capturedAt: string;
}
```

约束：

- exact version 必须存在；
- `defaultMode` 必须属于 `supportedModes`；
- native Snapshot 必须有已验证 Usage Specification；
- legacy 只能使用 `legacy_projection`；
- legacy 不自动获得 template、procedure 或 Capability Slot。

---

# 7. Skill Candidate / Discovery

```ts
export interface SkillCandidateRecordPayload {
  discoveryId: string;
  candidateId: string;

  skillId: string;
  skillVersion: number;

  retrievalSource:
    | "semantic"
    | "skill_graph"
    | "explicit"
    | "fallback"
    | "temporary";

  semanticScore?: number;
  graphScore?: number;
  qualityScore?: number;
  combinedScore?: number;

  visibility:
    | "user_selectable"
    | "composable"
    | "internal_only";

  usageSpecSource: SkillUsageSpecSource;

  eligible: boolean;

  exclusionReasons: Array<{
    code: string;
    description: string;
  }>;

  candidateSnapshotHash: string;

  discoveredAt: string;
}
```

---

# 8. Skill Applicability

```ts
export interface SkillApplicabilityRecordPayload {
  applicabilityId: string;

  skillId: string;
  skillVersion: number;

  status: SkillApplicabilityStatus;

  satisfiedRequirements: string[];
  missingRequirements: string[];
  blockingRequirements: string[];
  unknownRequirements: string[];

  contextRequirementIds: string[];

  requiresReadOnlyQuery: boolean;
  requiresUserInput: boolean;
  requiresConfirmation: boolean;

  reasonSummary: string;

  evidenceRefs: EvidenceReference[];

  assessedAt: string;
}
```

---

# 9. Skill Context Resolution

```ts
export interface SkillContextResolutionPayload {
  contextResolutionId: string;
  contextRequirementId: string;

  requirementName: string;
  requirementType:
    | "location"
    | "permission"
    | "safety"
    | "device_state"
    | "time_window"
    | "forbidden_zone"
    | "resource"
    | "task_evidence"
    | "custom";

  resolutionStatus:
    | "resolved"
    | "unresolved"
    | "conflict"
    | "invalid";

  source:
    | "authoritative_context"
    | "read_only_query"
    | "deterministic_derivation"
    | "user_input"
    | "unresolved";

  valueHash?: string;
  valueSummary?: string;
  valueArtifactRef?: string;

  authoritative: boolean;
  freshnessObservedAt?: string;
  validUntil?: string;

  conflictRefs: string[];
  evidenceRefs: EvidenceReference[];

  resolvedAt: string;
}
```

规则：

- `model_inferred` 不属于权威 Context Source；
- 实时设备状态必须由 Provider/Tool 观测；
- 状态新鲜度使用 `observedAt`，不能使用 `ingestedAt` 代替。

---

# 10. Skill Selection

```ts
export interface SkillSelectionRecordPayload {
  selectionId: string;

  candidateIds: string[];

  selectedSkillId?: string;
  selectedSkillVersion?: number;

  selectionStatus:
    | "selected"
    | "no_applicable_skill"
    | "confirmation_required"
    | "rejected";

  noSkillFallback:
    | "not_applicable"
    | "fallback"
    | "request_confirmation"
    | "reject";

  reasonSummary: string;

  decisionId: string;
  applicabilityId?: string;

  selectedUsageSpecHash?: string;
  selectedUsageSpecSource?: SkillUsageSpecSource;

  evidenceRefs: EvidenceReference[];

  selectedAt: string;
}
```

---

# 11. Skill Mode Selection

```ts
export interface SkillModeSelectionPayload {
  modeSelectionId: string;

  skillId: string;
  skillVersion: number;

  supportedModes: SkillExecutionMode[];
  selectedMode?: SkillExecutionMode;

  status:
    | "selected"
    | "confirmation_required"
    | "rejected";

  riskLevel:
    | "low"
    | "medium"
    | "high"
    | "critical";

  contextCompleteness:
    | "complete"
    | "partial"
    | "insufficient";

  taskReadinessSummary:
    | "available"
    | "restricted"
    | "disabled"
    | "unknown"
    | "not_checked";

  humanConfirmationId?: string;
  reasonSummary: string;

  evidenceRefs: EvidenceReference[];

  selectedAt: string;
}
```

---

# 12. Skill Composition

## 12.1 Composition Record

```ts
export interface SkillCompositionRecordPayload {
  compositionId: string;

  rootSkillId: string;
  rootSkillVersion: number;

  status:
    | "created"
    | "validated"
    | "rejected"
    | "executing"
    | "completed"
    | "failed";

  defaultDepthLimit: number;
  hardDepthLimit: number;
  effectiveDepthLimit: number;

  maxExpandedSkills: number;
  maxExpandedNodes: number;

  actualMaxDepth: number;
  expandedSkillCount: number;
  expandedNodeCount: number;

  cycleDetected: boolean;
  duplicateExpansionDetected: boolean;
  budgetExceeded: boolean;

  compositionHash: string;
  compositionArtifactRef?: string;

  createdAt: string;
}
```

## 12.2 Composition Edge

```ts
export interface SkillCompositionEdgePayload {
  compositionEdgeId: string;
  compositionId: string;

  parentSkillId: string;
  parentSkillVersion: number;

  childSkillId: string;
  childSkillVersion: number;

  edgeType:
    | "fixed_dependency"
    | "capability_slot"
    | "replacement";

  capabilitySlotId?: string;

  inputMappingHash?: string;
  outputMappingHash?: string;

  inputCompatible: boolean;
  outputCompatible: boolean;

  recursionDepth: number;
  remainingRecursionBudget: number;

  failurePolicy: SkillFailurePolicy;

  selectedBy:
    | "fixed"
    | "deterministic"
    | "llm_bounded"
    | "recovery";

  evidenceRefs: EvidenceReference[];
}
```

---

# 13. Capability Slot Resolution

```ts
export interface SkillCapabilitySlotResolutionPayload {
  slotResolutionId: string;
  compositionId: string;

  capabilitySlotId: string;
  capabilityName: string;

  requiredInputSchemaRef?: string;
  requiredOutputSchemaRef?: string;

  candidateSkillIds: string[];

  selectedSkillId?: string;
  selectedSkillVersion?: number;

  status:
    | "resolved"
    | "unresolved"
    | "ambiguous"
    | "rejected";

  selectionReason: string;

  inputCompatible: boolean;
  outputCompatible: boolean;

  providerPolicySatisfied: boolean;
  recursionBudgetSatisfied: boolean;

  evidenceRefs: EvidenceReference[];

  resolvedAt: string;
}
```

---

# 14. Skill Interpretation

```ts
export interface SkillInterpretationRecordPayload {
  interpretationId: string;

  skillId: string;
  skillVersion: number;

  mode: SkillExecutionMode;

  boundedInstructionHash: string;
  normativeHash: string;
  adaptiveHash: string;

  templateInstanceRef?: string;
  procedureProgramRef?: string;
  guidanceContextRef?: string;

  interpretationStatus:
    | "created"
    | "validated"
    | "invalid";

  invalidReasons: string[];

  createdAt: string;
}
```

---

# 15. Procedure Compilation

```ts
export interface SkillProcedureCompilationPayload {
  compilationId: string;

  skillId: string;
  skillVersion: number;

  procedureProgramHash: string;
  procedureProgramArtifactRef: string;

  targetWorkflowDefinitionId?: string;
  targetWorkflowVersion?: number;
  targetWorkflowHash?: string;

  status:
    | "compiled"
    | "validation_failed"
    | "rejected";

  deterministic: boolean;

  validationErrors: string[];

  compilerVersion: string;

  compiledAt: string;
}
```

procedure 只编译到现有 Workflow DSL，不直接执行。

---

# 16. Skill Plan Compliance

```ts
export interface SkillPlanCompliancePayload {
  planComplianceId: string;

  skillExecutionId: string;

  skillId: string;
  skillVersion: number;

  planId: string;
  planVersion: number;

  result:
    | "passed"
    | "repaired"
    | "confirmation_required"
    | "rejected";

  checks: Array<{
    checkId: string;
    checkType:
      | "normative"
      | "task_type_allowlist"
      | "provider_policy"
      | "recursion_budget"
      | "failure_policy"
      | "confirmation_requirement"
      | "evidence_requirement"
      | "forbidden_action"
      | "hard_gate";

    result:
      | "passed"
      | "failed"
      | "warning"
      | "not_applicable";

    reasonCode?: string;
    description?: string;
    evidenceRefs: EvidenceReference[];
  }>;

  repairAttemptCount: number;
  repairedPlanVersion?: number;

  reportHash: string;
  reportArtifactRef?: string;

  checkedAt: string;
}
```

---

# 17. Skill Execution

```ts
export interface SkillExecutionRecordPayload {
  skillExecutionId: string;

  rootSkillExecutionId: string;
  parentSkillExecutionId?: string;

  skillId: string;
  skillVersion: number;

  usageSpecVersion: string;
  usageSpecHash: string;
  usageSpecSource: SkillUsageSpecSource;

  executionMode: SkillExecutionMode;

  status: SkillExecutionStatus;

  recursionDepth: number;
  remainingRecursionBudget: number;

  failurePolicy: SkillFailurePolicy;

  selectionId: string;
  applicabilityId: string;
  modeSelectionId: string;
  compositionId?: string;
  planComplianceId?: string;

  planId?: string;
  planVersion?: number;
  workflowInstanceId?: string;

  contextSnapshotHash?: string;
  contextSnapshotArtifactRef?: string;

  startedAt?: string;
  waitingExternalAt?: string;
  endedAt?: string;

  degraded: boolean;
  degradedReasons: string[];
  missingEffects: string[];

  outcomeSummary?: string;

  recordVersion: number;
}
```

## 17.1 Skill Execution Relation

```ts
export interface SkillExecutionRelationPayload {
  relationId: string;

  rootSkillExecutionId: string;
  parentSkillExecutionId: string;
  childSkillExecutionId: string;

  compositionId: string;
  compositionEdgeId: string;

  capabilitySlotId?: string;

  failurePolicy: SkillFailurePolicy;

  relationStatus:
    | "created"
    | "active"
    | "completed"
    | "failed"
    | "cancelled"
    | "replaced";

  createdAt: string;
}
```

---

# 18. Skill Failure Propagation

```ts
export interface SkillFailurePropagationPayload {
  propagationId: string;

  childSkillExecutionId: string;
  parentSkillExecutionId?: string;

  failurePolicy: SkillFailurePolicy;

  childOutcome:
    | "completed"
    | "failed"
    | "cancelled"
    | "degraded";

  propagationAction:
    | "fail_parent"
    | "select_replacement"
    | "continue_without_child"
    | "mark_parent_degraded";

  replacementSkillExecutionId?: string;

  missingEffects: string[];
  degradedReasons: string[];

  evidenceRefs: EvidenceReference[];

  propagatedAt: string;
}
```

---

# 19. Skill Evidence Requirement

```ts
export interface SkillEvidenceRequirementPayload {
  evidenceRequirementId: string;

  skillExecutionId: string;

  requirementName: string;
  requirementType:
    | "state"
    | "receipt"
    | "physical_verification"
    | "coverage"
    | "trajectory"
    | "anomaly_report"
    | "human_confirmation"
    | "custom";

  required: boolean;
  critical: boolean;

  status:
    | "pending"
    | "satisfied"
    | "failed"
    | "waived"
    | "not_applicable";

  expectedEvidenceTypes: string[];
  actualEvidenceRefs: EvidenceReference[];

  failureCode?: string;
  failureSummary?: string;

  checkedAt?: string;
}
```

---

# 20. Skill Patch Candidate

```ts
export interface SkillPatchCandidatePayload {
  patchCandidateId: string;

  sourceSkillId: string;
  sourceSkillVersion: number;

  sourceSkillExecutionIds: string[];

  targetArea:
    | "adaptive_guidance"
    | "template"
    | "procedure"
    | "composition"
    | "provider_policy"
    | "evidence_policy"
    | "other";

  summary: string;
  rationale: string;

  proposedPatchArtifactRef: string;
  proposedPatchHash: string;

  status:
    | "created"
    | "under_review"
    | "accepted_for_experiment"
    | "rejected";

  createdAt: string;
}
```

该记录不表示 Skill 已修改或发布。

---

# 21. 现有实体的 Skill-aware 扩展

## 21.1 Plan Record

新增：

```ts
interface PlanSkillLink {
  rootSkillExecutionId: string;
  contributingSkillExecutionIds: string[];
  selectedSkillRefs: Array<{
    skillId: string;
    skillVersion: number;
    usageSpecHash: string;
  }>;
  planComplianceIds: string[];
}
```

## 21.2 Plan Step

新增：

```ts
interface PlanStepSkillLink {
  skillExecutionId: string;
  skillId: string;
  skillVersion: number;
  compositionId?: string;
  capabilitySlotId?: string;
  failurePolicy?: SkillFailurePolicy;
}
```

## 21.3 Execution Basis

新增：

```text
skill_execution_id
skill_usage_snapshot_record_id
composition_id
plan_compliance_id
```

## 21.4 Decision

`decisionType` 增加：

```text
skill_applicability
skill_selection
skill_mode_selection
skill_composition
capability_slot_resolution
skill_plan_repair
skill_failure_recovery
```

## 21.5 Action

新增：

```text
skill_execution_id
root_skill_execution_id
skill_id
skill_version
composition_id
capability_slot_id
failure_policy
```

## 21.6 RemoteTaskBinding

新增：

```text
skill_execution_id
root_skill_execution_id
parent_skill_execution_id
skill_task_binding_id
skill_execution_mode
provider_policy
```

## 21.7 Verification

新增：

```text
skill_execution_id
evidence_requirement_id
```

## 21.8 Episode Outcome

新增：

```text
root_skill_execution_ids
completed_skill_execution_ids
failed_skill_execution_ids
degraded_skill_execution_ids
unresolved_skill_execution_ids
```

---

# 22. Evaluation Readiness

```ts
export interface EvaluationReadinessPayload {
  readinessId: string;

  status:
    | "ready"
    | "degraded"
    | "not_ready";

  sealed: boolean;

  evidenceSequenceComplete: boolean;
  stateTrajectoryComplete: boolean;

  actionReceiptComplete: boolean;
  verificationCoverageComplete: boolean;

  remoteTaskBindingComplete: boolean;
  remoteTaskTerminalComplete: boolean;
  continuationComplete: boolean;
  cancellationCertain: boolean;

  skillUsageSnapshotComplete: boolean;
  skillCandidateTraceComplete: boolean;
  skillApplicabilityComplete: boolean;
  skillContextResolutionComplete: boolean;
  skillSelectionComplete: boolean;
  skillModeSelectionComplete: boolean;
  skillCompositionComplete: boolean;
  skillCapabilitySlotComplete: boolean;
  skillPlanComplianceComplete: boolean;
  skillExecutionTreeComplete: boolean;
  skillFailurePropagationComplete: boolean;
  skillEvidenceRequirementComplete: boolean;

  pendingTransactionalEvidenceCount: number;
  unresolvedRemoteTaskCount: number;
  uncertainCancellationCount: number;
  unresolvedSkillExecutionCount: number;

  missingRecordTypes: string[];
  qualityIssueIds: string[];

  checkedAt: string;
}
```

---

# 23. Skill-aware 事件目录

```text
skill.usage_snapshot_recorded
skill.discovered
skill.applicability_assessed
skill.context_missing
skill.context_resolved
skill.selected
skill.selection_rejected
skill.mode_selected
skill.mode_confirmation_required
skill.composition_started
skill.composition_validated
skill.composition_rejected
skill.child_selected
skill.capability_slot_resolved
skill.capability_slot_unresolved
skill.interpretation_created
skill.procedure_compiled
skill.procedure_compilation_failed
skill.plan_compliance_passed
skill.plan_compliance_repaired
skill.plan_compliance_confirmation_required
skill.plan_compliance_rejected
skill.execution_selected
skill.execution_planning
skill.execution_started
skill.execution_waiting_external
skill.execution_completed
skill.execution_failed
skill.execution_cancelled
skill.execution_degraded
skill.failure_propagated
skill.evidence_requirement_satisfied
skill.evidence_requirement_failed
skill.hard_gate_triggered
skill.human_intervention
skill.patch_candidate_created
```

原 Runtime、Goal、Plan、Action、MCP Task、Continuation、Verification 和 Outcome 事件继续保留。

---

# 24. Record Policy Catalog

| Record Type | Delivery | Role | 目标表 |
|---|---|---|---|
| `skill_usage_snapshot` | transactional | required | `skill_usage_snapshot` |
| `skill_candidate_record` | transactional | required | `skill_candidate_record` |
| `skill_applicability_record` | transactional | required | `skill_applicability_record` |
| `skill_context_resolution` | transactional | required | `skill_context_resolution` |
| `skill_selection_record` | transactional | required | `skill_selection_record` |
| `skill_mode_selection` | transactional | required | `skill_mode_selection` |
| `skill_composition_record` | transactional | required | `skill_composition_record` |
| `skill_composition_edge` | transactional | required | `skill_composition_edge` |
| `skill_capability_slot_resolution` | transactional | required | `skill_capability_slot_resolution` |
| `skill_interpretation_record` | transactional | required | `skill_interpretation_record` |
| `skill_procedure_compilation` | transactional | required | `skill_procedure_compilation` |
| `skill_plan_compliance` | transactional | required | `skill_plan_compliance` |
| `skill_execution_record` | transactional | required | `skill_execution_record` |
| `skill_execution_relation` | transactional | required | `skill_execution_relation` |
| `skill_failure_propagation` | transactional | required | `skill_failure_propagation` |
| `skill_evidence_requirement` | transactional | required | `skill_evidence_requirement` |
| `skill_patch_candidate` | transactional | supporting | `skill_patch_candidate` |
| `remote_task_progress` | buffered | supporting | `remote_task_observation` |
| `remote_task_poll_attempt` | buffered | diagnostic | `remote_task_poll_attempt` |
| `model_call_record` | buffered | supporting | `model_call_record` |

---

# 25. ClickHouse 表映射

## 25.1 新增表

```text
sdar_core.skill_usage_snapshot
sdar_core.skill_candidate_record
sdar_core.skill_applicability_record
sdar_core.skill_context_resolution
sdar_core.skill_selection_record
sdar_core.skill_mode_selection
sdar_core.skill_composition_record
sdar_core.skill_composition_edge
sdar_core.skill_capability_slot_resolution
sdar_core.skill_interpretation_record
sdar_core.skill_procedure_compilation
sdar_core.skill_plan_compliance
sdar_core.skill_execution_record
sdar_core.skill_execution_relation
sdar_core.skill_failure_propagation
sdar_core.skill_evidence_requirement
sdar_core.skill_patch_candidate
```

## 25.2 新增投影

```text
sdar_core.skill_execution_trajectory
sdar_core.remote_task_trajectory
sdar_core.state_trajectory
sdar_core.episode_evidence_bundle
```

## 25.3 元数据

```text
sdar_meta.schema_definition
sdar_meta.event_definition
sdar_meta.evidence_policy
sdar_meta.data_quality_rule
sdar_meta.projection_version
sdar_meta.exporter_version
sdar_meta.collector_version
sdar_meta.artifact_role_definition
sdar_meta.metric_definition
```

---

# 26. 数据质量规则

## 26.1 Skill Usage

- exact Skill version 必须存在；
- Usage Snapshot Hash 必须与 PostgreSQL 权威版本一致；
- Legacy Skill 必须标记 `legacy_projection`；
- Legacy Skill 不得出现 template/procedure/Capability Slot。

## 26.2 Selection 与 Applicability

- selected Skill 必须属于候选集合；
- selected Skill 必须存在 Applicability；
- `unsatisfied` 不得直接进入执行；
- `unknown` 必须按保守策略处理；
- Context Source 不得伪造权威。

## 26.3 Mode

- selected mode 必须受 Skill 支持；
- procedure 必须存在 Compilation Record；
- confirmation_required 未确认不得执行。

## 26.4 Composition

- recursion depth 默认 3，硬上限 5；
- cycle 必须拒绝；
- slot 必须绑定 exact child version；
- 输入输出不兼容不得执行；
- expansion budget 超限必须拒绝；
- parent/child 必须消耗同一预算。

## 26.5 Plan Compliance

- 执行 Plan 必须存在 Compliance Record；
- rejected Plan 不得执行；
- repaired 必须引用新 PlanVersion；
- required Provider 不得静默替换；
- forbidden Provider 不得出现；
- disabled Provider 必须硬阻断。

## 26.6 Execution

- Action 必须关联 Skill Execution；
- Remote Task 必须关联 Action、PlanStep 和 Skill Execution；
- parent Skill 不得直接消费 child remoteTaskId；
- degraded 必须记录 missing effects；
- Failure Propagation 必须与 failure policy 一致。

## 26.7 Readiness

- required Skill Evidence 缺失 → `not_ready`；
- supporting/diagnostic Evidence 缺失 → 可 `degraded`；
- Skill Execution 树、MCP Task 和 State 轨迹必须同时闭环。

---

# 27. 状态轨迹边界

```text
State
  = 当前权威状态版本

Event
  = 已发生事实

Decision
  = 正式选择

Action
  = 发起的操作

Receipt
  = 执行器或 Provider 返回

Verification
  = 对成功条件或 Skill Evidence Requirement 的实际验证

Trajectory
  = 上述事实按时间、版本和因果关系形成的可重建链
```

Skill-aware Trajectory 不是简单 Span 树，也不是日志拼接。

---

# 28. JSON Schema 交付物

本冻结包同时提供机器可读 JSON Schema：

```text
schema/common-definitions.schema.json
schema/canonical-evidence-envelope.schema.json
schema/skill-usage-snapshot.schema.json
schema/skill-candidate-record.schema.json
schema/skill-applicability-record.schema.json
schema/skill-context-resolution.schema.json
schema/skill-selection-record.schema.json
schema/skill-mode-selection.schema.json
schema/skill-composition-record.schema.json
schema/skill-composition-edge.schema.json
schema/skill-capability-slot-resolution.schema.json
schema/skill-interpretation-record.schema.json
schema/skill-procedure-compilation.schema.json
schema/skill-plan-compliance.schema.json
schema/skill-execution-record.schema.json
schema/skill-execution-relation.schema.json
schema/skill-failure-propagation.schema.json
schema/skill-evidence-requirement.schema.json
schema/skill-patch-candidate.schema.json
schema/evaluation-readiness.schema.json
schema/record-catalog.json
```

---

# 29. 兼容与迁移

- 原 Goal、Plan、MCP Tasks Schema 保留；
- 新增 Skill-aware 字段采用 Nullable/Default；
- 未实施旧遥测系统时直接使用新建库 Schema；
- 已存在实验表时优先重建开发/测试库；
- 生产 Migration 只追加；
- Projection 可按新版本重建；
- Schema/DDL/Record Catalog 发布时生成 SHA-256 清单。

---

# 30. 冻结结论

本 Schema 将 Skill Usage、Skill Composition、Plan Compliance、Skill Execution 和 Failure Propagation 提升为一级证据域，并保持：

- PostgreSQL 运行权威；
- ClickHouse 分析权威；
- MCP Provider 外部执行权威；
- 单一 Skill/Workflow Runtime；
- 基础设施语义自动采集；
- OTel 仅用于 Context 和传输；
- 技术自动 Trace 与正式 Evidence 分离。

本 Schema 是 SDAR v1.3 实施和 v2.0 评价取数的正式契约基线。
