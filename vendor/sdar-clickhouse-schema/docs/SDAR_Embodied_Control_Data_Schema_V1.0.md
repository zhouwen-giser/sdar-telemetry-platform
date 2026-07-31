# 车长智能体与 NPC 智能体共用评价数据 Schema 规范

**文档版本：V1.0**  
**Schema：JSON Schema Draft 2020-12**  
**评价框架：SDAR V2 Core + Embodied-Control Profile V1.0**

## 1. 文档目标

本规范定义车长智能体与 NPC 智能体用于统一评价时必须采集、标准化、关联和输出的全部核心数据。两套智能体实现不同，但统一映射为：

```text
Trigger/Goal → State → Event → ExecutionBasis → Decision → Action → Receipt → Verification → StateDelta/Trajectory → Outcome
```

评价单位统一为 `Episode`。车长的一次图运行、NPC 的一段连续 Tick、一次异常处置或一次抢占恢复均可形成一个 Episode。

## 2. 数据组织原则

1. `State` 表示当前权威快照；`Event` 表示已发生事实；`Decision` 表示正式决策；`Action` 表示主动操作；`Receipt` 表示工具或设备回执；`Verification` 表示实际结果验证。
2. “请求已发送”“MCP 已受理”不能直接写为“业务已完成”。
3. 每个关键行动必须关联有效 `ExecutionBasis`、`DecisionRecord`、执行前状态、幂等键、门槛记录和回执。
4. `sequence + correlationId` 表示 Episode 内有序证据链；`stateVersion` 表示状态演进。
5. 原始记录采用 append-only；标准化证据不得覆盖历史事实。

## 3. 统一主键与引用规则

| 字段 | 用途 |
|---|---|
| `episodeId` | 一次评价 Episode 的统一主键 |
| `correlationId` | 跨模块、跨进程和跨调用链关联 |
| `sequence` | Episode 内事件/决策/行动的时序 |
| `stateVersion` | 状态版本，禁止无版本覆盖 |
| `eventId` | 不可变事实标识 |
| `decisionId` | 正式决策标识 |
| `actionId` | 业务行动标识 |
| `idempotencyKey` | 控制或写操作防重复副作用 |
| `criterionId` | 成功条件标识 |
| `evidenceId` | 统一证据索引标识 |

## 4. 车长与 NPC 采集映射

| 统一证据 | 车长智能体来源 | NPC 智能体来源 |
|---|---|---|
| Trigger/Goal | source_messages、request_envelope、任务规划输入 | 上级任务、状态变化、异常事件、操作员控制 |
| StateSnapshot | UgvState/checkpoint | BlackboardSnapshot |
| ExecutionBasis | action_list、SOP、shortcut、Flow 路由 | BehaviorTree 分支、Utility 决策、Mission tool_calls |
| DecisionRecord | intent、routing、planning、replan、error_process | Threat/Utility、RootSelector、抢占、目标选择 |
| ActionRecord | task_schedule、SOP 原子动作、MCP 调用 | RunAttack/RunMissionToolCalls/逃逸等 MCP 调用 |
| Receipt | MCP response、下位机状态回执 | MCP response、CommandState、MoveTaskState |
| Verification | chassis_task、eo_task、weapon_task | 车辆位置、目标状态、任务状态、传感器观测 |
| Trajectory | LangGraph 节点序列 + StateDelta | Tick 序列 + BlackboardDelta |

## 5. 采集时机

| 时机 | 必须采集的数据 |
|---|---|
| Episode 创建 | EpisodeMetadata、Trigger、Goal、InitialState |
| 每个 LangGraph 节点/Tick 开始 | 状态快照、状态新鲜度、活动控制者、节点/Tick记录 |
| 产生正式决策 | DecisionRecord、ExecutionBasis 版本、证据引用 |
| 控制或写操作下发前 | ActionRecord、GateDecision、Confirmation、beforeStateId、idempotencyKey |
| 工具/设备返回 | Receipt，区分 transport/accepted/execution status |
| 状态发生变化 | Event、StateDelta、新 StateSnapshot、TrajectoryStep |
| 失败或抢占 | Failure、Recovery、Preemption 决策、新 ExecutionBasis |
| 成功条件检查 | VerificationRecord，记录 expected/actual/comparator/evidence |
| Episode 结束 | FinalState、FinalOutcome、RemainingItems、OperationalMetrics |

## 5.1 三系统目录组织

Schema 按采集系统分为三个目录：

| 目录 | 内容 | 系统入口 |
|---|---|---|
| `schemas/sdar_runtime/` | SDAR Runtime v1.3 Canonical Evidence、Skill-aware 事实及 Embodied 通用依赖 | `v1_3_skill_aware/canonical-evidence-envelope.schema.json`、`episode_evidence_bundle.schema.json` |
| `schemas/commander/` | 车长 UgvState、LangGraph Node 及专用约束 | `episode_evidence_bundle.schema.json` |
| `schemas/npc/` | NPC Blackboard、Tick 及专用约束 | `episode_evidence_bundle.schema.json` |

Embodied-Control 公共 Schema 只在 `sdar_runtime` 维护一份。车长和 NPC 入口通过 `$ref` 复用公共合同，并分别固定 `agentType/adapter/domainState`；完整示例不得绕过系统入口直接使用通用入口。已有 Schema 的 `$id` 保持不变，新系统入口使用 `/v1/commander/` 和 `/v1/npc/` 命名空间。

SDAR Runtime 自 v1.3 起使用独立的 `sdar.evidence/v1` Canonical Envelope 和 Skill-aware payload Schema。它取代 v1.2 Runtime 遥测入口，但不改变本文件定义的车长/NPC 应用与 Embodied 领域合同版本。车长/NPC 事实经 P1/P2 投影到 Core 时，如能由来源事实证明 Skill 语义，必须携带 Skill 执行关联；不得由节点名、工具名或日志文本猜测 Skill。

物理目录、入口和依赖关系详见 [`schemas/README.md`](../schemas/README.md)。

## 6. Schema 总览

### 一、公共类型与采集入口

#### `common.schema.json` — SDAR Embodied-Control Common Definitions



| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| - | - | - | 该 Schema 主要通过 `$defs` 提供公共类型 | - |

##### 内部定义 `EntityRef`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `entityType` | 是 | string | - | - |
| `entityId` | 是 | ref: `Id` | - | - |
| `displayName` | 否 | string | - | - |
| `namespace` | 否 | string | - | - |
| `version` | 否 | string | integer | 版本。 | - |
| `attributes` | 否 | object | - | - |

##### 内部定义 `SourceRef`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `sourceType` | 是 | string | - | enum: operator, command_center, peer_agent, sensor, mcp_server, agent_runtime, behavior_tree, llm, rule_engine, system, unknown |
| `sourceId` | 是 | ref: `Id` | - | - |
| `channel` | 否 | string | - | - |
| `trustLevel` | 否 | string | - | enum: trusted, partially_trusted, untrusted, unknown |

##### 内部定义 `DataQuality`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `observedAt` | 是 | ref: `Timestamp` | - | - |
| `recordedAt` | 是 | ref: `Timestamp` | 记录时间。 | - |
| `validUntil` | 否 | ref: `Timestamp` | 失效时间。 | - |
| `freshnessMs` | 否 | integer | - | min=0 |
| `confidence` | 否 | number | - | min=0; max=1 |
| `status` | 是 | string | 当前状态。 | enum: confirmed, inferred, stale, conflicted, unknown |
| `conflictRefs` | 否 | array<ref: `EvidenceRef`> | - | - |

##### 内部定义 `EvidenceRef`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `evidenceType` | 是 | string | - | - |
| `evidenceId` | 是 | ref: `Id` | - | - |
| `relation` | 否 | string | - | enum: supports, contradicts, caused_by, produced_by, validated_by, derived_from, supersedes, related |
| `schemaRef` | 否 | string | - | - |
| `storageRef` | 否 | string | 外部存储地址。 | - |
| `payloadHash` | 否 | string | 载荷哈希。 | pattern: ^[A-Fa-f0-9]{32,128}$ |

##### 内部定义 `KeyValue`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `key` | 是 | string | - | - |
| `value` | 是 | any | 指标值。 | - |
| `unit` | 否 | string | 单位。 | - |
| `sourceRef` | 否 | ref: `EvidenceRef` | 来源证据。 | - |

##### 内部定义 `RiskAssessment`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `level` | 是 | ref: `RiskLevel` | 等级。 | - |
| `categories` | 否 | array<string> | - | - |
| `summary` | 否 | string | 结构化摘要。 | - |
| `mitigations` | 否 | array<string> | - | - |
| `evidenceRefs` | 否 | array<ref: `EvidenceRef`> | 证据引用。 | - |

##### 内部定义 `ResourceClaim`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `resourceType` | 是 | string | - | enum: chassis, payload, weapon, sensor, network, compute, other |
| `resourceId` | 是 | ref: `Id` | - | - |
| `mode` | 是 | string | - | enum: shared, exclusive |
| `acquiredAt` | 否 | ref: `Timestamp` | - | - |
| `releasedAt` | 否 | ref: `Timestamp` | - | - |

##### 内部定义 `JsonPatchOperation`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `op` | 是 | string | - | enum: add, remove, replace, move, copy, test |
| `path` | 是 | string | - | pattern: ^/ |
| `from` | 否 | string | - | pattern: ^/ |
| `value` | 否 | any | 指标值。 | - |

##### 内部定义 `MetricValue`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `name` | 是 | string | 名称。 | - |
| `value` | 是 | number | integer | string | boolean | 指标值。 | - |
| `unit` | 否 | string | 单位。 | - |
| `threshold` | 否 | number | integer | string | 阈值。 | - |
| `status` | 否 | string | 当前状态。 | enum: pass, fail, warning, unknown |

#### `raw_record.schema.json` — Raw Collection Record

原始采集层统一信封。保存输入、状态、节点/Tick、工具请求与回执等未标准化原始记录。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `schemaVersion` | 是 | const `1.0.0` | Schema 版本。 | - |
| `rawRecordId` | 是 | ref: `Id` | 原始记录唯一标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `agentType` | 是 | ref: `AgentType` | 智能体类型：车长或 NPC。 | - |
| `recordType` | 是 | string | 原始记录类型。 | enum: message, state_snapshot, node_record, tick_record, tool_request, tool_response, approval, event_log, sensor_observation, runtime_log, other |
| `source` | 是 | ref: `SourceRef` | 记录来源。 | - |
| `sequence` | 否 | integer | Episode 内有序序号。 | min=0 |
| `timestamp` | 是 | ref: `Timestamp` | 记录时间。 | - |
| `correlationId` | 否 | ref: `Id` | 跨记录关联标识。 | - |
| `payload` | 是 | any | 原始载荷。 | - |
| `payloadHash` | 否 | string | 载荷哈希。 | pattern: ^[A-Fa-f0-9]{32,128}$ |
| `storageRef` | 否 | string | 外部存储地址。 | - |
| `redaction` | 否 | object | 脱敏处理信息。 | strict object |

#### `episode_metadata.schema.json` — Agent Episode Metadata

一次可评价任务、战术响应、异常处置或固定时间窗的统一元数据。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `schemaVersion` | 是 | const `1.0.0` | Schema 版本。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `agentType` | 是 | ref: `AgentType` | 智能体类型：车长或 NPC。 | - |
| `agentId` | 是 | ref: `Id` | 智能体/设备实例标识。 | - |
| `scenarioId` | 是 | ref: `Id` | 测试或业务场景标识。 | - |
| `episodeType` | 是 | ref: `EpisodeType` | Episode 类型。 | - |
| `correlationId` | 是 | ref: `Id` | 跨记录关联标识。 | - |
| `parentEpisodeId` | 否 | ref: `Id` | 父 Episode 标识。 | - |
| `sourceRunIds` | 否 | array<ref: `Id`> | 映射到原运行、图运行或 Tick 的标识列表。 | - |
| `startedAt` | 是 | ref: `Timestamp` | 开始时间。 | - |
| `endedAt` | 否 | ref: `Timestamp` | 结束时间。 | - |
| `status` | 是 | ref: `EpisodeStatus` | 当前状态。 | - |
| `environment` | 否 | string | 运行环境。 | enum: simulation, field_test, real_vehicle, replay, unknown |
| `softwareVersion` | 否 | string | 软件版本。 | - |
| `modelVersion` | 否 | string | 模型版本。 | - |
| `profile` | 否 | string | 评价 Profile。 | default=embodied-control |
| `adapter` | 否 | string | 数据适配器类型。 | enum: commander, npc |
| `tags` | 否 | array<string> | 标签。 | - |
| `metadata` | 否 | object | 扩展元数据。 | - |

#### `trigger.schema.json` — Trigger Record

Episode 的触发事实。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `triggerId` | 是 | ref: `Id` | 触发记录标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `sequence` | 是 | integer | Episode 内有序序号。 | min=0 |
| `triggerType` | 是 | string | 触发类型。 | enum: user_command, structured_task, state_change, anomaly, timer, operator_control, peer_request, system_start |
| `source` | 是 | ref: `SourceRef` | 记录来源。 | - |
| `receivedAt` | 是 | ref: `Timestamp` | 触发接收时间。 | - |
| `summary` | 是 | string | 结构化摘要。 | - |
| `priority` | 否 | integer | 优先级。 | min=0; max=100 |
| `rawInputRef` | 否 | ref: `EvidenceRef` | 原始输入证据引用。 | - |
| `targetRefs` | 否 | array<ref: `EntityRef`> | 目标对象引用。 | - |
| `stateVersion` | 否 | string | integer | 状态版本。 | - |
| `extensions` | 否 | object | 领域扩展字段。 | - |

### 二、目标、约束与成功条件

#### `goal.schema.json` — Goal Record

Episode 的结构化目标、约束与成功条件。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `goalId` | 是 | ref: `Id` | 目标标识。 | - |
| `goalVersion` | 是 | integer | 目标版本。 | min=1 |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `title` | 是 | string | 标题。 | - |
| `description` | 是 | string | 详细说明。 | - |
| `originTriggerId` | 是 | ref: `Id` | 来源触发标识。 | - |
| `targetRefs` | 否 | array<ref: `EntityRef`> | 目标对象引用。 | - |
| `successCriteria` | 是 | array<ref: `success_criterion.schema.json`> | 成功条件集合。 | minItems=1 |
| `constraints` | 否 | array<ref: `constraint.schema.json`> | 约束集合。 | - |
| `status` | 是 | string | 当前状态。 | enum: draft, accepted, active, satisfied, partially_satisfied, failed, cancelled, superseded |
| `createdAt` | 是 | ref: `Timestamp` | 创建时间。 | - |
| `createdBy` | 否 | ref: `SourceRef` | 创建者。 | - |
| `supersedesGoalVersion` | 否 | integer | 被替代的目标版本。 | min=1 |
| `assumptions` | 否 | array<string> | 显式假设。 | - |
| `extensions` | 否 | object | 领域扩展字段。 | - |

#### `success_criterion.schema.json` — Success Criterion

可验证的目标完成条件。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `criterionId` | 是 | ref: `Id` | 成功条件标识。 | - |
| `description` | 是 | string | 详细说明。 | - |
| `criterionType` | 是 | string | 成功条件类型。 | enum: state, position, task_status, target_status, sensor_result, time, resource, human_acceptance, custom |
| `expected` | 否 | any | 期望值。 | - |
| `comparator` | 是 | ref: `Comparator` | 比较操作。 | - |
| `actualSourcePath` | 否 | string | 实际值在状态中的路径。 | - |
| `critical` | 是 | boolean | 是否为关键成功条件。 | - |
| `deadlineAt` | 否 | ref: `Timestamp` | 截止时间。 | - |
| `stabilityWindowMs` | 否 | integer | 判定稳定窗口。 | min=0 |
| `evidenceRequirements` | 否 | array<string> | 证据要求。 | - |

#### `constraint.schema.json` — Constraint

目标与执行过程必须遵守的硬约束或软约束。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `constraintId` | 是 | ref: `Id` | 约束标识。 | - |
| `category` | 是 | string | 约束类别。 | enum: safety, authorization, space, time, resource, capability, communication, human_instruction, other |
| `description` | 是 | string | 详细说明。 | - |
| `severity` | 是 | string | 硬/软约束。 | enum: hard, soft |
| `appliesTo` | 否 | array<string> | 适用对象或动作范围。 | - |
| `sourceRef` | 否 | ref: `EvidenceRef` | 来源证据。 | - |
| `violationPolicy` | 否 | string | 违反约束后的处理策略。 | enum: reject, pause, replan, warn, request_confirmation |

### 三、状态、事件与状态轨迹

#### `state_snapshot.schema.json` — State Snapshot

某个确定时刻的权威状态快照。不得混入历史事件列表或未确认推测。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `stateId` | 是 | ref: `Id` | 验证依据状态。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `agentType` | 是 | ref: `AgentType` | 智能体类型：车长或 NPC。 | - |
| `stateVersion` | 是 | integer | 状态版本。 | min=0 |
| `quality` | 是 | ref: `DataQuality` | 状态时效、置信度和冲突信息。 | - |
| `source` | 是 | ref: `SourceRef` | 记录来源。 | - |
| `episodeStatus` | 是 | ref: `EpisodeStatus` | Episode 当前状态。 | - |
| `goalId` | 否 | ref: `Id` | 目标标识。 | - |
| `goalVersion` | 否 | integer | 目标版本。 | min=1 |
| `activeExecutionBasisId` | 否 | ref: `Id` | 当前生效的执行依据。 | - |
| `currentStepId` | 否 | ref: `Id` | 当前步骤。 | - |
| `currentActionId` | 否 | ref: `Id` | 当前行动。 | - |
| `activeController` | 否 | string | 当前唯一控制者或活动分支。 | - |
| `controlMode` | 否 | string | 控制模式。 | enum: autonomous, supervised, manual, paused, safe_hold, unknown |
| `entities` | 否 | array<ref: `EntityRef`> | 当前相关实体。 | - |
| `pendingItems` | 否 | array<object> | 待确认、等待或阻塞事项。 | - |
| `domainState` | 是 | oneOf(ref: `commander_state_extension.schema.json`, ref: `npc_state_extension.schema.json`) | 车长或 NPC 的领域状态。 | - |
| `extensions` | 否 | object | 领域扩展字段。 | - |

#### `commander_state_extension.schema.json` — Commander UgvState Extension

车长智能体 UgvState 在统一 StateSnapshot 中的领域扩展。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `sourceMessages` | 否 | array<ref: `EvidenceRef`> | - | - |
| `requestEnvelope` | 否 | object | - | - |
| `intentResult` | 否 | object | - | strict object |
| `actionList` | 否 | array<object> | - | - |
| `currentActionIdx` | 否 | integer | - | min=0 |
| `actionCmd` | 否 | object | - | - |
| `missionState` | 否 | object | - | - |
| `adtState` | 否 | object | - | - |
| `verifyFailed` | 否 | boolean | - | - |
| `forceEgoReplan` | 否 | boolean | - | - |
| `egoReplanLonLat` | 否 | object | - | strict object |
| `capabilityTracks` | 否 | object | - | strict object |
| `messages` | 否 | array<ref: `EvidenceRef`> | - | - |

##### 内部定义 `CapabilityTrack`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `capability` | 是 | string | 能力类别。 | enum: move, observe, engage |
| `state` | 是 | integer | string | - | - |
| `status` | 否 | string | 当前状态。 | enum: idle, pending, running, completed, failed, cancelled, unknown |
| `missionId` | 否 | string | integer | - | - |
| `updatedAt` | 否 | ref: `Timestamp` | - | - |
| `details` | 否 | object | - | - |

#### `npc_state_extension.schema.json` — NPC Blackboard Extension

NPC Blackboard 在统一 StateSnapshot 中的领域扩展。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `selfState` | 是 | object | - | strict object |
| `perceptionState` | 是 | object | - | strict object |
| `threatState` | 否 | object | - | - |
| `memoryState` | 否 | object | - | - |
| `tacticalDecisionState` | 是 | object | - | strict object |
| `missionState` | 是 | object | - | strict object |
| `commandState` | 否 | object | - | - |
| `moveTaskState` | 否 | object | - | - |
| `hmiApprovalState` | 否 | object | - | strict object |
| `routeObstacleState` | 否 | object | - | - |
| `communicationState` | 是 | object | - | strict object |

#### `state_delta.schema.json` — State Delta

一次合法状态转换的增量记录。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `stateDeltaId` | 是 | ref: `Id` | 关联状态增量。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `fromStateId` | 是 | ref: `Id` | 变化前状态。 | - |
| `toStateId` | 是 | ref: `Id` | 变化后状态。 | - |
| `fromStateVersion` | 是 | integer | 变化前版本。 | min=0 |
| `toStateVersion` | 是 | integer | 变化后版本。 | min=1 |
| `operations` | 是 | array<ref: `JsonPatchOperation`> | JSON Patch 风格状态变更。 | minItems=1 |
| `reasonEventId` | 否 | ref: `Id` | 触发本次变更的事件。 | - |
| `sourceDecisionId` | 否 | ref: `Id` | 产生变更的决策。 | - |
| `sourceActionId` | 否 | ref: `Id` | 产生变更的行动。 | - |
| `recordedAt` | 是 | ref: `Timestamp` | 记录时间。 | - |
| `invariantChecks` | 否 | array<ref: `MetricValue`> | 状态不变量校验结果。 | - |

#### `event.schema.json` — Event Record

已发生且不可修改的事实。事件不保存当前完整状态。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `eventId` | 是 | ref: `Id` | 事件标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `sequence` | 是 | integer | Episode 内有序序号。 | min=0 |
| `eventType` | 是 | string | 事件类型。 | - |
| `source` | 是 | ref: `SourceRef` | 记录来源。 | - |
| `correlationId` | 是 | ref: `Id` | 跨记录关联标识。 | - |
| `causationId` | 否 | ref: `Id` | 直接原因记录标识。 | - |
| `actionId` | 否 | ref: `Id` | 关联行动。 | - |
| `decisionId` | 否 | ref: `Id` | 关联决策。 | - |
| `stateVersionBefore` | 否 | integer | 事件前状态版本。 | min=0 |
| `stateVersionAfter` | 否 | integer | 事件后状态版本。 | min=0 |
| `payloadRef` | 否 | ref: `EvidenceRef` | 事件载荷引用。 | - |
| `occurredAt` | 是 | ref: `Timestamp` | 事件实际发生时间。 | - |
| `severity` | 否 | string | 硬/软约束。 | enum: info, warning, error, critical |
| `summary` | 否 | string | 结构化摘要。 | - |
| `extensions` | 否 | object | 领域扩展字段。 | - |

#### `trajectory_step.schema.json` — State Trajectory Step

按时间和因果顺序连接状态、事件、决策、行动、回执和状态增量。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `trajectoryStepId` | 是 | ref: `Id` | 轨迹步骤标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `sequence` | 是 | integer | Episode 内有序序号。 | min=0 |
| `fromStateId` | 是 | ref: `Id` | 变化前状态。 | - |
| `fromStateVersion` | 是 | integer | 变化前版本。 | min=0 |
| `triggerEventId` | 是 | ref: `Id` | 触发事件。 | - |
| `decisionId` | 否 | ref: `Id` | 关联决策。 | - |
| `actionId` | 否 | ref: `Id` | 关联行动。 | - |
| `receiptIds` | 否 | array<ref: `Id`> | 关联回执。 | - |
| `stateDeltaId` | 是 | ref: `Id` | 关联状态增量。 | - |
| `toStateId` | 是 | ref: `Id` | 变化后状态。 | - |
| `toStateVersion` | 是 | integer | 变化后版本。 | min=1 |
| `invariantChecks` | 否 | array<ref: `MetricValue`> | 状态不变量校验结果。 | - |
| `timestamp` | 是 | ref: `Timestamp` | 记录时间。 | - |

### 四、执行依据、决策与行动

#### `execution_basis.schema.json` — Execution Basis

关键行动的合法执行依据，可为计划、策略、规则、SOP、快捷方式或行为树分支。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `basisId` | 是 | ref: `Id` | 执行依据标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `basisType` | 是 | string | 执行依据类型。 | enum: plan, policy, rule, sop, shortcut, behavior_tree_branch, workflow, human_instruction, mission_tool_queue |
| `version` | 是 | integer | 版本。 | min=1 |
| `status` | 是 | string | 当前状态。 | enum: proposed, approved, active, superseded, completed, rejected, cancelled |
| `goalId` | 是 | ref: `Id` | 目标标识。 | - |
| `goalVersion` | 否 | integer | 目标版本。 | min=1 |
| `name` | 否 | string | 名称。 | - |
| `description` | 否 | string | 详细说明。 | - |
| `preconditions` | 否 | array<string> | 前置条件。 | - |
| `steps` | 否 | array<ref: `ExecutionStep`> | 计划或程序步骤。 | - |
| `policyRef` | 否 | string | 策略/规则标识。 | - |
| `branchPath` | 否 | string | 行为树分支路径。 | - |
| `utilityScores` | 否 | map<string,number> | Utility 候选分数。 | - |
| `resourceClaims` | 否 | array<ref: `ResourceClaim`> | 资源占用声明。 | - |
| `successCriterionRefs` | 否 | array<ref: `Id`> | 关联成功条件。 | - |
| `createdBy` | 是 | ref: `SourceRef` | 创建者。 | - |
| `createdAt` | 是 | ref: `Timestamp` | 创建时间。 | - |
| `approvedBy` | 否 | ref: `SourceRef` | 批准者。 | - |
| `approvalRef` | 否 | ref: `EvidenceRef` | 批准记录引用。 | - |
| `supersedesBasisId` | 否 | ref: `Id` | 被替代的执行依据。 | - |
| `extensions` | 否 | object | 领域扩展字段。 | - |

##### 内部定义 `ExecutionStep`

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `stepId` | 是 | ref: `Id` | - | - |
| `name` | 是 | string | 名称。 | - |
| `order` | 是 | integer | - | min=0 |
| `capability` | 否 | string | 能力类别。 | - |
| `actionTemplate` | 否 | object | - | - |
| `dependsOn` | 否 | array<ref: `Id`> | - | - |
| `resourceClaims` | 否 | array<ref: `ResourceClaim`> | 资源占用声明。 | - |
| `preconditions` | 否 | array<string> | 前置条件。 | - |
| `completionCriterionRefs` | 否 | array<ref: `Id`> | - | - |
| `allowedParallel` | 否 | boolean | - | default=False |
| `onFailure` | 否 | string | - | enum: retry, skip, replan, pause, abort, degrade |

#### `decision.schema.json` — Decision Record

正式决策结论及其可复核依据，不保存隐藏思维过程。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `decisionId` | 是 | ref: `Id` | 关联决策。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `sequence` | 是 | integer | Episode 内有序序号。 | min=0 |
| `decisionType` | 是 | string | 决策类型。 | enum: intent, route, plan, policy_selection, target_selection, gate, preemption, recovery, termination, other |
| `title` | 是 | string | 标题。 | - |
| `conclusion` | 是 | string | 决策结论。 | - |
| `status` | 是 | string | 当前状态。 | enum: proposed, accepted, rejected, superseded, executed |
| `basedOnStateId` | 是 | ref: `Id` | 决策所依据的状态。 | - |
| `executionBasisId` | 否 | ref: `Id` | 关联执行依据。 | - |
| `candidateOptions` | 否 | array<object> | 候选方案。 | - |
| `selectedOptionId` | 否 | ref: `Id` | 选择的方案。 | - |
| `rationaleSummary` | 否 | string | 可审计的简要依据，不含隐藏思维链。 | - |
| `evidenceRefs` | 否 | array<ref: `EvidenceRef`> | 证据引用。 | - |
| `riskAssessment` | 否 | ref: `RiskAssessment` | 风险评估。 | - |
| `expectedEffects` | 否 | array<string> | 预期影响。 | - |
| `createdAt` | 是 | ref: `Timestamp` | 创建时间。 | - |
| `createdBy` | 是 | ref: `SourceRef` | 创建者。 | - |
| `extensions` | 否 | object | 领域扩展字段。 | - |

#### `gate_decision.schema.json` — Gate Decision

控制动作执行前的安全、策略、授权、能力或控制权门槛判定。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `gateDecisionId` | 是 | ref: `Id` | 门槛判定标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `actionId` | 是 | ref: `Id` | 关联行动。 | - |
| `gateType` | 是 | string | 门槛类型。 | enum: execution, policy, safety, authorization, human_confirmation, control_ownership, capability, rate_limit |
| `decision` | 是 | string | 允许、拒绝或延后。 | enum: allow, deny, defer |
| `basedOnStateId` | 是 | ref: `Id` | 决策所依据的状态。 | - |
| `policyRefs` | 否 | array<string> | 适用策略。 | - |
| `reasons` | 否 | array<string> | 判定原因。 | - |
| `evidenceRefs` | 否 | array<ref: `EvidenceRef`> | 证据引用。 | - |
| `evaluatedAt` | 是 | ref: `Timestamp` | 评价时间。 | - |
| `expiresAt` | 否 | ref: `Timestamp` | 门槛判定有效期。 | - |

#### `confirmation.schema.json` — Human Confirmation Record

人工确认、否决和有效期记录。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `confirmationId` | 是 | ref: `Id` | 人工确认标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `actionId` | 是 | ref: `Id` | 关联行动。 | - |
| `requestedAt` | 是 | ref: `Timestamp` | 请求确认时间。 | - |
| `requestedFrom` | 是 | ref: `SourceRef` | 确认请求对象。 | - |
| `status` | 是 | string | 当前状态。 | enum: pending, approved, rejected, expired, cancelled |
| `decidedAt` | 否 | ref: `Timestamp` | 决定时间。 | - |
| `decidedBy` | 否 | ref: `SourceRef` | 确认人。 | - |
| `scope` | 是 | object | 确认适用范围。 | - |
| `validFrom` | 否 | ref: `Timestamp` | 生效时间。 | - |
| `validUntil` | 否 | ref: `Timestamp` | 失效时间。 | - |
| `invalidationConditions` | 否 | array<string> | 失效条件。 | - |
| `evidenceRefs` | 否 | array<ref: `EvidenceRef`> | 证据引用。 | - |
| `comment` | 否 | string | 备注。 | - |

#### `action.schema.json` — Action Record

Agent 主动发起的一次业务行动。行动请求不等于行动成功。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `actionId` | 是 | ref: `Id` | 关联行动。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `sequence` | 是 | integer | Episode 内有序序号。 | min=0 |
| `basisId` | 是 | ref: `Id` | 执行依据标识。 | - |
| `stepId` | 否 | ref: `Id` | - | - |
| `decisionId` | 是 | ref: `Id` | 关联决策。 | - |
| `actionType` | 是 | string | 行动类型。 | enum: read, simulation, write, control, human_request, delegate |
| `capability` | 否 | string | 能力类别。 | - |
| `target` | 是 | ref: `EntityRef` | 行动目标。 | - |
| `inputSummary` | 是 | string | 输入摘要。 | - |
| `inputPayloadRef` | 否 | ref: `EvidenceRef` | 完整输入引用。 | - |
| `inputHash` | 是 | string | 输入哈希。 | pattern: ^[A-Fa-f0-9]{32,128}$ |
| `riskLevel` | 是 | ref: `RiskLevel` | 风险级别。 | - |
| `gateDecisionRefs` | 否 | array<ref: `Id`> | 执行前门槛判定引用。 | - |
| `confirmationRef` | 否 | ref: `Id` | 人工确认引用。 | - |
| `idempotencyKey` | 是 | string | 幂等键。 | - |
| `executionStatus` | 是 | ref: `ExecutionStatus` | 执行状态。 | - |
| `sideEffect` | 是 | boolean | 是否产生外部副作用。 | - |
| `controllerRef` | 否 | string | 控制者或活动分支。 | - |
| `resourceClaims` | 否 | array<ref: `ResourceClaim`> | 资源占用声明。 | - |
| `attempt` | 否 | integer | 尝试次数。 | min=1; default=1 |
| `retryOfActionId` | 否 | ref: `Id` | 被重试行动。 | - |
| `dispatchedAt` | 否 | ref: `Timestamp` | 下发时间。 | - |
| `startedAt` | 否 | ref: `Timestamp` | 开始时间。 | - |
| `endedAt` | 否 | ref: `Timestamp` | 结束时间。 | - |
| `receiptRefs` | 否 | array<ref: `Id`> | 回执引用。 | - |
| `beforeStateId` | 是 | ref: `Id` | 执行前状态。 | - |
| `afterStateId` | 否 | ref: `Id` | 执行后状态。 | - |
| `extensions` | 否 | object | 领域扩展字段。 | - |

#### `receipt.schema.json` — Execution Receipt

工具、设备或外部系统返回的执行受理与执行结果回执。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `receiptId` | 是 | ref: `Id` | 回执标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `actionId` | 是 | ref: `Id` | 关联行动。 | - |
| `provider` | 是 | ref: `SourceRef` | 回执提供方。 | - |
| `providerRequestId` | 否 | string | 提供方请求标识。 | - |
| `receivedAt` | 是 | ref: `Timestamp` | 触发接收时间。 | - |
| `transportStatus` | 是 | string | 传输层状态。 | enum: ok, error, timeout, unknown |
| `acceptanceStatus` | 是 | string | 请求是否被设备/工具受理。 | enum: accepted, rejected, unknown |
| `executionStatus` | 是 | ref: `ExecutionStatus` | 执行状态。 | - |
| `outputSummary` | 否 | string | 输出摘要。 | - |
| `rawResponseRef` | 否 | ref: `EvidenceRef` | 原始回执引用。 | - |
| `observedStateRef` | 否 | ref: `EvidenceRef` | 回执携带的状态引用。 | - |
| `error` | 否 | object | 错误对象。 | strict object |
| `metrics` | 否 | array<ref: `MetricValue`> | 耗时等调用指标。 | - |

#### `verification.schema.json` — Verification Record

使用实际状态、传感器或业务规则逐项验证成功条件。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `verificationId` | 是 | ref: `Id` | 验证记录标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `criterionId` | 是 | ref: `Id` | 成功条件标识。 | - |
| `actionId` | 否 | ref: `Id` | 关联行动。 | - |
| `stateId` | 否 | ref: `Id` | 验证依据状态。 | - |
| `verificationType` | 是 | string | 验证类型。 | enum: state_check, sensor_observation, business_rule, human_validation, derived_check |
| `expected` | 是 | any | 期望值。 | - |
| `actual` | 是 | any | 实际值。 | - |
| `comparator` | 是 | ref: `Comparator` | 比较操作。 | - |
| `status` | 是 | string | 当前状态。 | enum: pass, fail, inconclusive, pending |
| `critical` | 是 | boolean | 是否为关键成功条件。 | - |
| `evidenceRefs` | 否 | array<ref: `EvidenceRef`> | 证据引用。 | minItems=1 |
| `verifiedAt` | 是 | ref: `Timestamp` | 验证时间。 | - |
| `verifier` | 是 | ref: `SourceRef` | 验证者。 | - |
| `stabilityWindowMs` | 否 | integer | 判定稳定窗口。 | min=0 |
| `notes` | 否 | string | 说明。 | - |

### 五、失败、恢复与结果收口

#### `failure.schema.json` — Failure Record

失败、阻塞、超时或状态异常的结构化记录。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `failureId` | 是 | ref: `Id` | 关联失败。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `relatedActionId` | 否 | ref: `Id` | 关联行动。 | - |
| `relatedDecisionId` | 否 | ref: `Id` | 关联决策。 | - |
| `category` | 是 | string | 约束类别。 | enum: tool_error, timeout, state_conflict, resource_unavailable, capability_gap, safety_violation, communication_loss, target_lost, route_blocked, verification_failed, other |
| `severity` | 是 | string | 硬/软约束。 | enum: warning, error, critical |
| `detectedAt` | 是 | ref: `Timestamp` | 发现时间。 | - |
| `stateId` | 是 | ref: `Id` | 验证依据状态。 | - |
| `errorRef` | 否 | ref: `EvidenceRef` | 错误引用。 | - |
| `retryable` | 是 | boolean | 是否可重试。 | - |
| `sideEffectRisk` | 是 | ref: `RiskLevel` | 重试副作用风险。 | - |
| `impact` | 否 | string | 影响。 | - |
| `status` | 是 | string | 当前状态。 | enum: open, contained, recovered, unresolved |
| `evidenceRefs` | 否 | array<ref: `EvidenceRef`> | 证据引用。 | - |

#### `recovery.schema.json` — Recovery Record

异常后的重试、降级、重规划、等待、暂停或终止过程。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `recoveryId` | 是 | ref: `Id` | 恢复记录标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `failureId` | 是 | ref: `Id` | 关联失败。 | - |
| `strategy` | 是 | string | 恢复策略。 | enum: retry, degrade, replan, wait, pause, abort, handoff, manual_control |
| `decisionId` | 是 | ref: `Id` | 关联决策。 | - |
| `newBasisId` | 否 | ref: `Id` | 新的执行依据。 | - |
| `actionIds` | 否 | array<ref: `Id`> | 节点产生的行动。 | - |
| `startedAt` | 是 | ref: `Timestamp` | 开始时间。 | - |
| `completedAt` | 否 | ref: `Timestamp` | 完成时间。 | - |
| `status` | 是 | string | 当前状态。 | enum: planned, running, succeeded, failed, cancelled |
| `resultVerificationId` | 否 | ref: `Id` | 恢复结果验证。 | - |
| `residualRisk` | 否 | ref: `RiskAssessment` | 残余风险。 | - |
| `notes` | 否 | string | 说明。 | - |

#### `remaining_item.schema.json` — Remaining Item

最终收口时仍未关闭的事项、责任方和处理状态。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `itemId` | 是 | ref: `Id` | 剩余事项标识。 | - |
| `description` | 是 | string | 详细说明。 | - |
| `status` | 是 | string | 当前状态。 | enum: open, waiting, blocked, accepted_risk, closed |
| `owner` | 是 | ref: `SourceRef` | 责任方。 | - |
| `dueAt` | 否 | ref: `Timestamp` | 计划完成时间。 | - |
| `riskLevel` | 否 | ref: `RiskLevel` | 风险级别。 | - |
| `evidenceRefs` | 否 | array<ref: `EvidenceRef`> | 证据引用。 | - |

#### `final_outcome.schema.json` — Final Outcome

Episode 的最终状态、成功条件结果、剩余事项和残余风险。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `outcomeId` | 是 | ref: `Id` | 最终结果标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `status` | 是 | string | 当前状态。 | enum: completed, partial, failed, aborted, blocked, waiting, paused, cancelled |
| `goalId` | 是 | ref: `Id` | 目标标识。 | - |
| `goalVersion` | 是 | integer | 目标版本。 | min=1 |
| `finalStateId` | 是 | ref: `Id` | 最终状态。 | - |
| `completedCriterionRefs` | 否 | array<ref: `Id`> | 已通过成功条件。 | - |
| `failedCriterionRefs` | 否 | array<ref: `Id`> | 失败成功条件。 | - |
| `pendingCriterionRefs` | 否 | array<ref: `Id`> | 待验证成功条件。 | - |
| `remainingItems` | 否 | array<ref: `remaining_item.schema.json`> | 剩余事项。 | - |
| `residualRisks` | 否 | array<ref: `RiskAssessment`> | 残余风险。 | - |
| `summary` | 是 | string | 结构化摘要。 | - |
| `reportedAt` | 是 | ref: `Timestamp` | 结果报告时间。 | - |
| `reportRef` | 否 | ref: `EvidenceRef` | 最终报告引用。 | - |

#### `operational_metric.schema.json` — Operational Metric

独立于100分语义评分的运行时与实时性能指标。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `metricId` | 是 | ref: `Id` | 指标记录标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `name` | 是 | string | 名称。 | enum: state_freshness_ms, decision_latency_ms, dispatch_latency_ms, verification_latency_ms, tick_overrun_ms, duplicate_action_count, control_conflict_count, state_version_conflict_count, trajectory_rebuild_rate, verification_coverage, other |
| `value` | 是 | number | 指标值。 | - |
| `unit` | 否 | string | 单位。 | - |
| `threshold` | 否 | number | 阈值。 | - |
| `status` | 否 | string | 当前状态。 | enum: pass, fail, warning, unknown |
| `collectedAt` | 是 | ref: `Timestamp` | 采集时间。 | - |
| `sourceRef` | 否 | ref: `EvidenceRef` | 来源证据。 | - |

### 六、Agent 适配器原始记录

#### `commander_node_record.schema.json` — Commander Graph Node Record

车长 LangGraph 节点执行记录，用于映射为标准 Decision/Action/StateDelta/Trajectory。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `nodeRunId` | 是 | ref: `Id` | 节点执行标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `graphRunId` | 是 | ref: `Id` | LangGraph 运行标识。 | - |
| `nodeName` | 是 | string | 节点名称。 | - |
| `nodeType` | 否 | string | 节点类别。 | enum: routing, planning, scheduling, execution, verification, report, error, other |
| `startedAt` | 是 | ref: `Timestamp` | 开始时间。 | - |
| `endedAt` | 否 | ref: `Timestamp` | 结束时间。 | - |
| `status` | 是 | string | 当前状态。 | enum: running, succeeded, failed, cancelled, timed_out |
| `stateBeforeId` | 是 | ref: `Id` | 节点前状态。 | - |
| `stateAfterId` | 否 | ref: `Id` | 节点后状态。 | - |
| `stateDeltaId` | 否 | ref: `Id` | 关联状态增量。 | - |
| `decisionIds` | 否 | array<ref: `Id`> | 节点产生的决策。 | - |
| `actionIds` | 否 | array<ref: `Id`> | 节点产生的行动。 | - |
| `goto` | 否 | string | 节点跳转目标。 | - |
| `errorRef` | 否 | ref: `EvidenceRef` | 错误引用。 | - |
| `spanId` | 否 | string | 链路 Span 标识。 | - |
| `parentSpanId` | 否 | string | 父 Span 标识。 | - |

#### `npc_tick_record.schema.json` — NPC Tick Record

NPC 每个 Tick 的实时闭环记录。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `tickId` | 是 | ref: `Id` | Tick 标识。 | - |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `sequence` | 是 | integer | Episode 内有序序号。 | min=0 |
| `startedAt` | 是 | ref: `Timestamp` | 开始时间。 | - |
| `endedAt` | 否 | ref: `Timestamp` | 结束时间。 | - |
| `snapshotId` | 是 | ref: `Id` | Tick 使用的快照。 | - |
| `threatEvaluation` | 否 | object | 威胁评估。 | - |
| `utilityEvaluation` | 否 | map<string,number> | Utility 分数。 | - |
| `activeBranch` | 是 | string | 活动行为树分支。 | - |
| `decisionId` | 否 | ref: `Id` | 关联决策。 | - |
| `actionIds` | 否 | array<ref: `Id`> | 节点产生的行动。 | - |
| `stateAfterId` | 否 | ref: `Id` | 节点后状态。 | - |
| `resetApplied` | 否 | boolean | 是否应用重置。 | - |
| `overrunMs` | 否 | integer | Tick 超期时长。 | - |
| `status` | 是 | string | 当前状态。 | enum: succeeded, failed, overrun, cancelled |
| `notes` | 否 | string | 说明。 | - |

### 七、证据包与评价结果

#### `episode_evidence_bundle.schema.json` — Agent Episode Evidence Bundle

车长与 NPC 共用评价引擎的完整证据包。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `metadata` | 是 | ref: `episode_metadata.schema.json` | 扩展元数据。 | - |
| `trigger` | 是 | ref: `trigger.schema.json` | - | - |
| `goals` | 是 | array<ref: `goal.schema.json`> | - | minItems=1 |
| `initialState` | 是 | ref: `state_snapshot.schema.json` | Episode 初始完整状态。 | - |
| `stateSnapshots` | 是 | array<ref: `state_snapshot.schema.json`> | 状态快照序列。 | minItems=1 |
| `stateDeltas` | 否 | array<ref: `state_delta.schema.json`> | 状态增量序列。 | - |
| `events` | 是 | array<ref: `event.schema.json`> | 有序事件流。 | - |
| `executionBases` | 是 | array<ref: `execution_basis.schema.json`> | 计划、策略或行为树分支等执行依据。 | - |
| `decisions` | 是 | array<ref: `decision.schema.json`> | 关键决策记录。 | - |
| `gateDecisions` | 否 | array<ref: `gate_decision.schema.json`> | 门槛判定记录。 | - |
| `confirmations` | 否 | array<ref: `confirmation.schema.json`> | 人工确认记录。 | - |
| `actions` | 是 | array<ref: `action.schema.json`> | 行动记录。 | - |
| `receipts` | 是 | array<ref: `receipt.schema.json`> | 工具或设备回执。 | - |
| `verifications` | 是 | array<ref: `verification.schema.json`> | 成功条件验证。 | - |
| `failures` | 否 | array<ref: `failure.schema.json`> | 失败记录。 | - |
| `recoveries` | 否 | array<ref: `recovery.schema.json`> | 恢复与重规划记录。 | - |
| `trajectory` | 是 | array<ref: `trajectory_step.schema.json`> | 状态轨迹。 | - |
| `operationalMetrics` | 否 | array<ref: `operational_metric.schema.json`> | 运行性能指标。 | - |
| `finalState` | 是 | ref: `state_snapshot.schema.json` | Episode 最终完整状态。 | - |
| `outcome` | 是 | ref: `final_outcome.schema.json` | 最终结果。 | - |
| `evidenceIndex` | 否 | array<object> | 证据索引。 | - |

#### `evaluation_result.schema.json` — SDAR Evaluation Result

SDAR V2 Core + Embodied-Control Profile 的统一评价结果。

| 字段 | 必填 | 类型/引用 | 说明 | 约束 |
|---|---:|---|---|---|
| `framework` | 是 | const `SDAR` | 评价框架名称。 | - |
| `frameworkVersion` | 是 | const `2.0` | SDAR Core 版本。 | - |
| `profile` | 是 | const `embodied-control` | 评价 Profile。 | - |
| `profileVersion` | 是 | const `1.0` | 领域 Profile 版本。 | - |
| `adapter` | 否 | string | 数据适配器类型。 | enum: commander, npc |
| `episodeId` | 是 | ref: `Id` | 评价 Episode 唯一标识。 | - |
| `score` | 是 | number | 加权总分。 | min=0; max=100 |
| `level` | 是 | string | 等级。 | enum: S, A, B, C, D, HG, F |
| `passed` | 是 | boolean | 是否通过。 | - |
| `fatalErrors` | 是 | array<object> | 致命错误。 | - |
| `hardGates` | 是 | map<string,object> | 硬性门槛结果。 | - |
| `dimensions` | 是 | object | 五维评分。 | strict object |
| `metrics` | 是 | array<object> | 耗时等调用指标。 | - |
| `operationalMetrics` | 否 | array<ref: `operational_metric.schema.json`> | 运行性能指标。 | - |
| `outcome` | 否 | string | 最终结果。 | - |
| `majorFindings` | 否 | array<string> | 主要发现。 | - |
| `improvements` | 否 | array<string> | 改进建议。 | - |
| `evaluatedAt` | 是 | ref: `Timestamp` | 评价时间。 | - |
| `evaluator` | 否 | ref: `SourceRef` | 评价器。 | - |

## 7. 跨 Schema 一致性校验规则

| 编号 | 规则 |
|---|---|
| R1 | 所有记录的 `episodeId` 必须与证据包元数据一致。 |
| R2 | `sequence` 在同一 Episode 内应单调递增；缺口必须有可解释原因。 |
| R3 | `initialState` 和 `finalState` 必须出现在 `stateSnapshots` 中。 |
| R4 | 每个 `ActionRecord.basisId`、`decisionId`、`beforeStateId` 必须存在。 |
| R5 | 有副作用的行动必须具有 `idempotencyKey`、适用 `GateDecision` 和至少一个 Receipt。 |
| R6 | 需要人工确认的行动，Confirmation 必须在 `dispatchedAt` 前为 approved 且未失效。 |
| R7 | Receipt 的 accepted 只代表受理；只有 Verification 通过后才可判定目标完成。 |
| R8 | Trajectory 前后状态版本必须连续，`fromStateVersion + 1 = toStateVersion`，除非记录了批量合并策略。 |
| R9 | Outcome=completed 时，所有关键 SuccessCriterion 必须有 pass Verification。 |
| R10 | 任何时刻只能有一个合法控制者占用同一 exclusive resource。 |
| R11 | NPC 安全分支抢占后，Mission 分支不得继续下发冲突行动。 |
| R12 | 车长快路径、SOP 和慢路径必须使用同一门槛、行动和验证证据模型。 |
| R13 | 状态新鲜度阈值由 Scenario Policy Pack 提供；超时状态不得支撑高风险行动。 |
| R14 | Event、Receipt、Verification 等历史事实不得原地修改；更正必须追加新记录。 |

## 8. 评价引擎使用方式

```text
Schema/引用/时序校验
  → E0/E1/E2 证据等级
  → M1-M15 指标抽取
  → HG1-HG7 硬门槛
  → 致命错误检测
  → 0/1/2 × 权重
  → 0-100、等级、通过结论和改进项
```

SDAR Runtime Collector 使用 `schemas/sdar_runtime/v1_3_skill_aware/canonical-evidence-envelope.schema.json`；车长和 NPC Collector 分别使用 `schemas/commander/episode_evidence_bundle.schema.json` 与 `schemas/npc/episode_evidence_bundle.schema.json`。`schemas/sdar_runtime/episode_evidence_bundle.schema.json` 是 Embodied-Control 公共证据基线，不代替 Runtime v1.3 Skill-aware payload 合同。旧版 `evaluation_result.schema.json` 只作为兼容输出，正式评价结果按 ClickHouse Mart 的 application/domain/general 三层独立合同写入。

## 9. 推荐存储

- SDAR Runtime 原生事实写 `sdar_core`；Schema、Event Policy、投影和评价定义写 `sdar_meta`。
- 车长 Collector 同时写 `sdar_commander.raw_record` 和 typed 表，再由 P1 投影至 `sdar_embodied`、由 P2 投影至 `sdar_core`。
- NPC Collector 同时写 `sdar_npc.raw_record` 和 typed 表，再沿相同 P1/P2 链路上卷事实。
- raw 和 typed 行必须共用 `record_id/payload_sha256`；原始记录 append-only，修正必须追加新版本或新记录。
- application、domain、general 评价分别读取本层事实，结果写入 `sdar_mart` 的版本化父子表；不得复制上一层分数。
- 完整建库、映射和验证合同见 `sdar_clickhouse_schema_v1_0/`。

## 10. 交付文件

- 三系统 Schema 总览：`schemas/README.md`
- SDAR Runtime/通用 Schema：`schemas/sdar_runtime/*.schema.json`
- 车长 Schema：`schemas/commander/*.schema.json`
- NPC Schema：`schemas/npc/*.schema.json`
- 车长示例：`examples/commander_episode.example.json`
- NPC 示例：`examples/npc_episode.example.json`
- SDAR Runtime v1.3 信封示例：`examples/v1_3_skill_aware/canonical-envelope.skill-execution.example.json`
- 评价结果示例：`examples/evaluation_result.example.json`
- TypeScript 类型：`types/sdar-evidence.types.ts`
- ClickHouse 建库包：`sdar_clickhouse_schema_v1_0/`
- 示例校验器：`validate_examples.py`
