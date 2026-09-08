# CODEX GOAL — SDAR Telemetry MCP Tasks Provider Closure Sync v0.1

## 0. Goal

在 `zhouwen-giser/sdar-telemetry-platform` 中，以当前 Provider Closure v2 为基础，补齐 MCP Tasks 新增语义，使 Telemetry 能够稳定、可审计、可重放地回答以下问题：

1. 一个 SDAR authoritative `RemoteTaskBinding` 是否只闭包到一个正确的 Provider Task；
2. 该 Provider Task 是否闭包到唯一 Provider Execution；
3. dispatch 是否曾进入 uncertain 状态；
4. uncertain dispatch 是否通过 exact reconciliation 找回原 Task/Execution；
5. 是否出现重复 Task、重复 Execution、身份冲突或 foreign facts；
6. Provider execution terminal 与 Provider business outcome 分别是什么；
7. 当前 Provider Closure 是否具备正式消费所需的结构完整性；
8. Snapshot 是否在固定 `asOfProjectedAt` / watermark 上不可变；
9. 后到数据是否产生新 snapshot，而不是静默改写既有 snapshot；
10. 上述结果能否继续通过 `sdar.telemetry-smpp-providerops-handoff/v2` 提供给 `sdar-benchmark-server`。

本任务 **不评价 Agent，不计算 Goal achieved，不计算 physical success，不新增 Benchmark scoring，不发起 UGV 行驶任务。**

---

## 1. Repository / Branch

### Target

- Repository: `zhouwen-giser/sdar-telemetry-platform`
- Frozen observed base: `main@3e43350dd0d0e37fe65ec318d0d9881820a88f5a`
- Required work branch: `codex/smpp-mcp-tasks-provider-closure-sync-v0.1`

### Execution-time rule

开始修改前必须重新读取：

- target `main`
- SMPP Telemetry producer branch
- Runtime compatibility ref
- Benchmark Server consumer ref

若任何 HEAD 与 `SOURCE_LOCK.json` 不一致：

1. 记录 `observed / required / unresolved`；
2. compare commits；
3. 若只是文档/测试新增且语义兼容，可更新 task-local source lock；
4. 若 ProviderOps payload、Runtime Evidence、Provider Closure v2、Benchmark Handoff 语义变化，**停止实现并输出 BLOCKED_DRIFT 报告**，不得猜测合并。

不得直接覆盖仓库历史 `SOURCE_LOCK.json` 的旧工作上下文；本任务的 source lock 放在 `reports/provider-closure-mcp-sync-v0.1/source-lock.json` 或等价任务目录。

---

## 2. Existing Baseline That Must Be Preserved

当前代码已经具备：

- Canonical Runtime Evidence reader；
- ProviderOps shared warehouse reader；
- `CanonicalProviderClosureSource`；
- `assembleProviderEpisodeClosure`；
- `ProviderClosureRuntime` + Control PostgreSQL lease/fencing；
- detail-first / manifest-last publication；
- `sdar_mart.provider_closure_*_v2`；
- Benchmark formal handoff `sdar.telemetry-smpp-providerops-handoff/v2`；
- exact tenant/project/environment/episode scope；
- Runtime binding authority；
- `hintsUsedForAuthority=false`；
- `goalSuccessProven=false`；
- `physicalSuccessProven=false`；
- pagination/drift/hash/readiness 基础。

不得退化这些性质。

---

## 3. Primary Defects / Gaps To Close

### G1 — Provider Closure “binding complete” currently only proves that each binding has at least one selected Provider fact

这不足以证明：

`Remote Task -> Provider Task -> Provider Execution`

必须新增 **Exact Task→Execution Closure**。

### G2 — Provider fact DTO is too weak for new MCP Tasks semantics

现有 Provider closure fact 只保留通用 identity / fact type / times / origin hints，无法独立表达：

- Provider execution identity
- dispatch certainty
- reconciliation result
- recovered original task/execution
- Provider execution terminal
- Provider business terminal
- optional Device Mission identity

必须从冻结的 SMPP ProviderOps additive payload semantics 中做 typed normalization。禁止根据日志文本、traceId、时间接近度或 resourceId 推断。

### G3 — All external relation rows are currently normalized as non-authoritative reconciliation hints

需要区分：

A. Runtime binding authority：唯一负责选择 Remote Task / Provider tuple；

B. Provider-internal identity relation：在 A 已选中的 Provider Task 内，可证明 Provider Task -> Provider Execution / optional Mission，但 **不得选择新的 Provider Task，不能覆盖 Runtime binding**；

C. Origin / trace / correlation hints：仍然完全 non-authoritative。

`hintsUsedForAuthority` 的语义保持：任何 hint 都不得用于事实选择或 binding override。

### G4 — Dispatch uncertainty / reconciliation is not part of readiness

需要引入：

- certain
- uncertain
- recovered
- unresolved
- conflict

以及 reconciliation:

- not_required
- attempted
- found_exact
- not_found
- deferred
- unavailable
- conflict

若 Runtime 明确记录 uncertain dispatch，则 formal-ready 前必须有唯一 exact reconciliation，或明确进入非 ready/conflict。

### G5 — Four-axis terminal is not computed

必须分开计算：

1. MCP Task control state
2. Dispatch / transport certainty
3. Provider execution state
4. Provider business outcome

严禁由 3/4 推断 Goal achieved / physical success。

### G6 — Snapshot semantic completeness is insufficient

同一 input + same `asOfProjectedAt` + same contracts 必须产生同一 closure content hash / snapshot id。

后到证据不得改写旧 snapshot；只允许生成新 snapshot revision / id。

---

## 4. Frozen Authority Rules

### 4.1 Remote Task / Provider Binding Authority

仅：

- `sdar_core.sdar_evidence_v1_record` 中合法的 `mcp_task.remote_binding`
- 或已冻结的等价 Runtime authority view

可以决定：

- remoteTaskId
- providerOriginSourceId
- externalProviderId
- providerInstanceId（若 authoritative binding 中存在）

不得使用以下字段来选择 Provider Task：

- origin*
- traceId
- correlationId
- invocation hints
- relation hints
- operation name
- resource id
- nearest timestamp
- “最新一条”
- free-text logs

### 4.2 Provider Task -> Provider Execution Authority

只有在 Remote Task / Provider tuple 已经由 Runtime binding 唯一选定后，才能消费 SMPP Telemetry 冻结合同明确声明的 Provider execution identity 或 provider-internal relation。

它可以证明：

`selected provider task -> provider execution`

但不能反向改变：

`SDAR binding -> selected provider task`

### 4.3 Optional Mission Identity

只有上游提供 authoritative Device Mission identity / frozen relation 时才能计算：

`provider execution -> device mission`

否则：

`missionBindingStatus = not_required | unresolved`

不得通过时间、位置变化、operationName、resourceId 构造 Mission ID。

### 4.4 Business / Physical Boundaries

必须始终保持：

- Provider completed != Goal achieved
- Provider business success != physical success
- ACK != business outcome
- Projection success != Provider execution success
- Missing evidence != raw metric 0
- Missing relation != automatic business failure

---

## 5. Normalized Semantic Model

不要立即新增公共 protocol。先在 Telemetry 内部实现 typed normalization；只有当前 v2 handoff 无法 additive 表达时才进入 design stop。

至少形成等价于以下结构的内部模型：

### ProviderTaskExecutionClosure

- bindingId
- remoteTaskId
- providerSourceId
- providerId
- providerInstanceId?
- providerExecutionIds[]
- exactProviderExecutionId?
- matchCount
- status: `exact | unresolved | conflict`
- sourceFactIds[]
- sourceRelationIds[]
- contentHash

判定：

- 0 match -> unresolved
- 1 match -> exact
- >1 match -> conflict

### ProviderDispatchClosure

- bindingId
- dispatchStatus: `certain | uncertain | recovered | unresolved | conflict`
- uncertaintyEvidenceIds[]
- reconciliationAttemptCount
- reconciliationStatus
- recoveredRemoteTaskId?
- recoveredProviderExecutionId?
- reconciliationEvidenceIds[]
- contentHash

### ProviderTerminalClosure

- bindingId
- mcpTaskControlState
- dispatchCertainty
- providerExecutionState
- providerBusinessOutcome
- providerExecutionTerminalAt?
- providerBusinessTerminalAt?
- evidenceIds[]
- contentHash

### Optional ProviderMissionClosure

- bindingId
- providerExecutionId
- deviceMissionIds[]
- status: `not_required | exact | unresolved | conflict`
- evidenceIds[]
- contentHash

---

## 6. Provider Closure v2 Additive Handoff

优先保持：

`sdar.telemetry-smpp-providerops-handoff/v2`

不要创建 v3，除非 Phase T0/T2 明确证明 additive extension 无法满足兼容性。

Manifest 至少要可表达或等价表达：

- `identityConflictCount`
- `taskExecutionExactCount`
- `taskExecutionUnresolvedCount`
- `taskExecutionConflictCount`
- `uncertainDispatchCount`
- `reconciliationAttemptCount`
- `exactReconciliationCount`
- `unresolvedReconciliationCount`
- `providerTerminalConflictCount`
- `missionExactCount`
- `missionUnresolvedCount`
- `missionConflictCount`

正式消费条件在现有条件上增加：

- no task-execution conflict
- no unresolved required task-execution closure
- no unresolved reconciliation when uncertainty exists
- no contradictory provider terminal
- snapshot is stable / published
- all existing foreign/truncation/hint rules still pass

不能因为 optional Mission unresolved 而阻断当前 phase，除非冻结 producer contract 明确将 Mission 设为 required。

---

## 7. Runtime Canonical Evidence Sync

检查当前 Runtime Evidence 实际 schema，不要凭字段名猜测。

至少读取与本目标相关的 authoritative evidence：

- `mcp_task.remote_binding`
- `mcp_task.reconciliation`
- `mcp_task.continuation_attempt`
- `mcp_task.continuation_snapshot`
- `mcp_task.control_event`
- `mcp_task.tool_call`
- `runtime.action`
- `runtime.receipt`
- `runtime.verification`
- `runtime.outcome`

若实际 Runtime ref 中新语义使用其他 record type，以 upstream frozen registry 为准。

必须补齐 binding 中实际存在的：

- provider instance identity
- authoritative origin runtime/task/invocation IDs

如果当前 Runtime contract并不提供，标记 unresolved，不允许从 hints 回填。

---

## 8. SMPP ProviderOps Sync

上游锁定候选：

- `zhouwen-giser/smpp-telemetry-platform`
- `codex/smpp-mcp-tasks-telemetry-sync-v0.1`
- observed `f00efef6caa130cd71c4843bced7dc479dad7963`

该分支的 source lock 指向：

- Producer: `zhouwen-giser/sdar-mcp-provider-platform`
- branch `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- commit `1e67e6e421d70a3cbce2d41bf5007e99463712fe`

并声明：

- schema `sdar.provider.ops.event`
- version `1.1.0`
- payload catalog `smpp.providerops-payload-catalog/v1.1`
- 16 record types
- compatibility = additive payload semantics, no new record type

Codex 必须以执行时实际 contract / payload catalog / mapper 为准。

不得在 Telemetry 中自行增加第 17 个 ProviderOps record type 来绕过上游合同。

---

## 9. ClickHouse Strategy

### Default

继续使用：

- `sdar_core.external_provider_fact`
- `sdar_core.external_entity_relation_fact`
- `sdar_mart.provider_closure_*_v2`

不得新增 UGV-specific table。

### Allowed additive migration

若 handoff 需要保存 generic provider-task semantic detail，可以新增 Telemetry-owned additive migration，例如：

`migrations/clickhouse/016_provider_closure_task_semantics_v2.sql`

允许：

- generic provider task/execution closure detail table
- generic provider terminal detail table
- manifest additive columns / companion semantic manifest
- compatibility views

不允许：

- 修改 vendor `1.5.1-rc.2` 的 00..26 migration history
- 删除/重写既有 rows
- 以 UGV 命名 generic Provider closure table
- 将 Benchmark result 直接写入 Telemetry fact tables

Migration 必须：

- idempotent
- additive
- rollback/documentation explicit
- live preflight 后才能应用
- 不得在未授权环境自动执行

---

## 10. Readiness Semantics

Provider readiness 保持：

- `not_required`
- `not_ready`
- `degraded`
- `ready`
- `conflict`
- `blocked_drift`

建议判定：

### ready

- binding set complete
- exact Provider Task identity
- required Task→Execution closure exact
- uncertainty（若出现）已 exact reconcile
- no contradictory terminal
- expected/selected counts consistent
- foreignFactCount = 0
- unresolvedBindingCount = 0
- taskExecutionConflictCount = 0
- required taskExecutionUnresolvedCount = 0
- unresolvedReconciliationCount = 0 when uncertain
- truncated = false
- hasMore = false
- hintsUsedForAuthority = false
- source stable across capture

### degraded

仅 supporting / optional semantic evidence 不足，例如 optional Mission unresolved、non-blocking origin claim unverifiable。不得把 required identity 缺失降为 degraded。

### not_ready

required evidence 缺失，尤其：

- no binding when provider evidence is required
- no selected Provider fact for binding
- no required Task→Execution exact closure
- uncertain dispatch but reconciliation unresolved/unavailable/not_found without proof of no side effect
- required terminal not yet observed

### conflict

- foreign selected fact
- multiple execution identities for one required binding
- conflicting provider terminal
- ambiguous authoritative identity
- invalid relation used as authority
- same deterministic id with different content hash

### blocked_drift

snapshot capture/source moved and cannot stabilize within bounded retries.

---

## 11. Time Semantics

保留并明确：

- occurredAt — Provider event actually occurred
- observedAt — sensor/state observation time
- receivedAt — receiver got record
- ingestedAt — telemetry ingestion
- projectedAt — warehouse projection
- evaluatedAt — downstream evaluation

任何 state/position freshness 都必须使用 `observedAt`。

禁止：

`projectedAt is fresh => physical state is fresh`

Provider Closure 本任务只保留/传递 physical/state evidence time；不负责 physical arrival 判定。

---

## 12. Snapshot / Late Data

冻结规则：

1. closure capture pins `asOfProjectedAt`;
2. pages are all read under the same bound;
3. source is re-captured to detect movement;
4. details write first;
5. manifest publishes last;
6. immutable consumer pins `closureSnapshotId`;
7. late evidence creates a new snapshot id;
8. old snapshot remains queryable and unchanged.

必须新增 deterministic regression:

same authoritative inputs + same `asOfProjectedAt` + same contracts
→ same closureContentHash
→ same snapshot id

---

## 13. Four Diagnostic Case Coverage

Telemetry 不负责执行 Case，只必须能够正确承载/计算其 evidence。

### UGV-NODE-001

- preserve Runtime state `observedAt`
- stale state must not become fresh because of projection
- no Provider Task side effect is expected
- Provider evidence can be `not_required`

### UGV-CORE-001

- one binding
- exactly one Provider Execution
- provider terminal captured
- business outcome captured
- no identity conflict
- no physical-success inference

### UGV-MCP-003

Must prove:

- dispatch became uncertain
- no blind second selection
- reconciliation attempted
- original Provider Task / Execution found exactly
- task-execution closure remains one
- duplicate task/execution is conflict
- eventual provider terminal can be represented
- `recovered` is distinct from `certain`

This is the highest-priority semantic case.

### UGV-XCHAIN-003

Must preserve contradiction:

- Provider business success may be present
- Telemetry still returns `goalSuccessProven=false`
- Telemetry still returns `physicalSuccessProven=false`
- independent simulator physical failure remains Benchmark responsibility

---

## 14. Tests

### Mandatory local

Run at minimum:

- `npm run typecheck`
- `npm test`
- `npm run check:sdar-evidence-contract`
- `npm run check:sdar-clickhouse-contract`
- `npm run check:smpp-benchmark-handoff`
- `npm run check:benchmark-consumer`

Add focused tests for:

- exact task→execution: 0 / 1 / >1
- duplicate deterministic id same hash = idempotent
- same id different hash = conflict
- uncertain + found_exact
- uncertain + not_found
- uncertain + unavailable/deferred
- uncertain + multiple matches
- provider business success never proves Goal/physical success
- relation hint cannot select facts
- provider-internal relation cannot override Runtime binding
- provider instance mismatch rejected
- foreign tenant/project/environment rejected
- page truncation
- source movement/drift
- manifest-last crash recovery
- late data new snapshot
- deterministic re-run same hash
- observedAt preserved

### Live / integration

Only after configuration exists:

- `npm run check:smpp-benchmark-handoff:live`
- `npm run test:smpp-providerops-consumer-e2e`
- relevant real ClickHouse preflight

Live E2E must consume the real normal ingestion/projection path. Forbidden:

- direct INSERT into `sdar_core.external_provider_fact`
- direct INSERT into Provider Closure tables as test evidence
- fabricated Benchmark result
- issuing `vehicle_navigate` from this task

If a real uncertainty episode does not exist, use upstream contract fixture through the normal Producer/Processor ingestion path and label the result `contract-e2e`, not `real-ugv-e2e`.

---

## 15. Expected Code Touch Areas

Likely, not mandatory:

- `packages/telemetry-smpp-consumer/src/closure-v2.ts`
- `packages/telemetry-smpp-consumer/src/canonical-closure-source.ts`
- `packages/telemetry-smpp-consumer/src/closure-publisher.ts`
- `packages/telemetry-smpp-consumer/src/index.ts`
- `packages/telemetry-control-postgres/src/provider-closure-runtime.ts`
- `migrations/clickhouse/016_provider_closure_task_semantics_v2.sql` if proven necessary
- `integrations/sdar-benchmark-server/mcp-provider-telemetry/v2/*`
- `tests/unit/provider-closure-v2.test.ts`
- `tests/unit/smpp-consumer.test.ts`
- focused integration tests
- scripts verifying handoff / consumer qualification
- task reports

Do not mechanically modify all files. T0/T1 determines actual delta.

---

## 16. Phase Plan

### T0 — Source Lock / Gap Audit

Deliver:

- exact target HEAD
- upstream refs
- current contract hashes
- current field inventory
- current relation types
- observed/required/unresolved matrix

No implementation before T0 closes.

### T1 — ProviderOps Semantic Intake

Consume upstream additive payload semantics, freeze normalization table, add fixtures.

### T2 — Runtime Canonical Semantic Intake

Read exact Runtime authoritative evidence needed for uncertainty/reconciliation/control terminal. Do not infer absent fields.

### T3 — Exact Task→Execution Closure

Implement 0/1/>1 closure with deterministic IDs/hashes.

### T4 — Dispatch Uncertainty / Reconciliation

Implement certainty state and exact recovery semantics.

### T5 — Four-axis Terminal

Compute control / transport / execution / business axes independently.

### T6 — Readiness v2 Semantic Hardening

Integrate semantic blockers without changing Goal/physical boundaries.

### T7 — Publication / Warehouse Additive Delta

Only if needed. Keep manifest-last and immutable snapshots.

### T8 — Benchmark Handoff Compatibility

Update v2 consumer contract additively; no v1 fallback; verify existing consumers.

### T9 — Unit / Contract / Crash / Replay

Complete negative and deterministic test matrix.

### T10 — Normal-path E2E

Producer/Processor/ClickHouse -> Telemetry closure -> Handoff.

### T11 — Benchmark Consumer Qualification

Confirm downstream can consume exact closure snapshot and correctly refuse non-ready/conflict input.

### T12 — Final Acceptance

Generate reports, hashes, blockers, final gate status.

---

## 17. Required Reports

Create under:

`reports/provider-closure-mcp-sync-v0.1/`

Required:

- `00-source-lock.json`
- `00-source-lock.md`
- `01-gap-audit.md`
- `02-providerops-semantic-mapping.csv`
- `03-runtime-evidence-mapping.csv`
- `04-task-execution-closure.md`
- `05-uncertainty-reconciliation.md`
- `06-terminal-readiness.md`
- `07-snapshot-replay.md`
- `08-contract-tests.md`
- `09-live-e2e.md`
- `10-benchmark-consumer.md`
- `11-final-acceptance.md`
- `acceptance-gates.csv`
- `SHA256SUMS`

Reports must distinguish:

- observed
- required
- unresolved
- blocked

Never write “pass” for a gate not executed.

---

## 18. Hard Stop Conditions

Stop and report BLOCKED if any of the following is true:

- Runtime binding no longer provides authoritative tuple required by closure
- SMPP payload contract is not frozen enough to identify execution deterministically
- only trace/correlation/time/resource hints can link Task to Execution
- current provider relation contract can produce N candidates without deterministic disambiguation
- target main drift changes Provider Closure v2 semantics
- ClickHouse schema drift invalidates existing source table contract
- Benchmark consumer requires v3 but v2 additive compatibility is impossible
- test would require direct fact-table insertion or fake result to pass
- live E2E would require unauthorized device control

No workaround may silently weaken authority semantics.

---

## 19. Completion Criteria

Only when all gates in `matrices/acceptance-gates.csv` are PASS, output exactly:

`SDAR_TELEMETRY_MCP_TASKS_PROVIDER_CLOSURE_SYNC_V0_1_COMPLETE`

Otherwise output:

- `BLOCKED`
- `PARTIAL`
- or `FAILED`

with exact gate IDs and evidence.

No token on partial implementation.
