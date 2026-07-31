# P1 / P2 投影合同 V1.1

本文定义领域应用事实向领域事实、再向通用事实投影时必须遵守的身份、语义、幂等和审计规则。它与 `sdar_meta.projection_*`、`id_namespace_definition`、`id_crosswalk` 表共同构成可执行合同。

## 1. 边界与版本

| 投影 | `projection_id` | 输入 | 输出 | 当前版本 |
|---|---|---|---|---|
| P1 | `application_to_embodied` | `sdar_commander`、`sdar_npc` | `sdar_embodied` | `1.1.0` |
| P2 | `embodied_to_core` | `sdar_embodied` | `sdar_core` | `1.1.0` |

投影只处理事实，不读取或复制 `sdar_mart` 中的分数、等级、Metric、Gate 或 Fatal 结果。application、domain、general 三层评价器必须分别从 `sdar_commander/sdar_npc`、`sdar_embodied`、`sdar_core` 的本层事实重新计算。

SDAR v1.3 的 17 类 Skill-aware 记录是 Runtime 原生 Core 一级事实，不经过 P1/P2。P2 只有在应用/领域来源已经显式提供 Skill ID、版本、Usage Spec Hash、执行树和合规证据时，才把这些字段投影到既有 Core 事实；不能从节点名、工具名、Prompt 或 OTel span 猜测 Skill。无法无损证明时保留空关联，并由 readiness 标记缺证，而不是合成虚假 Skill 记录。

每个进程启动时必须取得唯一 `status=active` 的 `projection_version`，并固定其 `projection_version + mapping_hash + contract_version + id_namespace_version + environment_map_version`。五项快照都必须写入 `projection_run`；同一次 run 内禁止热切换版本，即使该 run 失败或没有输出，也必须能独立审计其合同快照。

评价器必须用完整键选择配置：

```text
framework + framework_version + evaluation_tier + profile + profile_version
+ metric_set_version + gate_set_version + fatal_set_version
```

四个预置 profile（commander application、NPC application、domain、general）各自拥有独立的 15 个 Metric、7 个 Gate 和 7 个 Fatal 定义。规则文本可以同源，但取证查询必须指向本层数据库，评价结果不得跨层复制。

## 2. Canonical UUIDv5

### 2.1 固定参数

- 算法：RFC 9562 UUIDv5（SHA-1）。
- namespace UUID：`5832c301-3d9e-5927-8f15-fa6262c8fc4e`。
- 该 namespace 等于 `UUIDv5(NAMESPACE_URL, "urn:sdar:canonical:v1")`，一经启用永久不变。
- 分隔符：单个 Unicode `U+001F`（Unit Separator），UTF-8 字节为 `0x1F`。

UUIDv5 的 name 必须是下列字符串的 UTF-8 字节，不得使用平台默认编码：

```text
sdar-id-v1\u001F{tenant_id}\u001F{project_id}\u001F{source_agent_type}\u001F{source_entity_type}\u001F{normalized_source_id}
```

上述 `\u001F` 表示一个真实的 U+001F 字符，不是六个可见字符。示例中的字段按如下顺序处理：

1. `tenant_id`、`project_id`、`source_agent_type`、`source_entity_type`、`source_id` 均为必填；
2. 每个分量先执行 Unicode NFC，再去除首尾 Unicode 空白；
3. 保留大小写，不做 locale 相关转换，不解析数字，不重写 UUID 文本；
4. 任一分量为空或包含 U+001F，记录进入 `projection_dead_letter`，错误码为 `INVALID_ID_COMPONENT`；
5. `normalized_source_id` 是按上述规则处理后的 `source_id`；
6. `source_agent_type` 固定为 `commander`、`npc` 或原生通用运行时的 `sdar`；
7. `source_entity_type` 使用具体合同名，例如 `episode`、`run`、`segment`、`embodied.domain_event`、`embodied.control_action`；禁止用笼统的 `record` 代替所有事实类型。

计算结果：

```text
canonical_name = join(U+001F, [
  "sdar-id-v1",
  tenant_id,
  project_id,
  source_agent_type,
  source_entity_type,
  normalized_source_id
])

target_id       = UUIDv5(namespace_uuid, UTF8(canonical_name))
source_key_hash = lower(hex(SHA256(UTF8(canonical_name))))
```

P1 为应用字符串 ID 生成 canonical UUID，并将映射写入 `sdar_meta.id_crosswalk`。`sdar_embodied.episode_key` 原样保留来源 Episode String，`canonical_episode_id` 单独保存 canonical UUID；二者不得互相覆盖。P2 必须原样携带 `canonical_episode_id`，禁止再次 UUIDv5。

在本基线中，crosswalk 的 `source_system` 与 `source_agent_type` 都写 `commander` 或 `npc`，实际来源库另写入 `source_database`；不得把部署名、主机名或库名混入这两个 Agent 类型字段。发布质量视图按这三个字段、namespace version 和完整派生身份共同校验。

当一个 source record 投影为多条或多个目标表时，`source_entity_type` 必须使用稳定的目标逻辑实体类型，例如 `embodied.control_action`，不能全部写成 `record`。一条 source record 产生多条同型实体时，UUID name 中的 `normalized_source_id` 使用下列长度前缀复合值：

```text
derived-v1:{source_record_id_utf8_length}:{source_record_id}:{discriminator_utf8_length}:{business_discriminator}
```

`business_discriminator` 必须是合同规定且重放稳定的业务键，例如 actionId、criterionId、resourceId 或 patch path；禁止使用数组下标、处理批次内序号或随机数。`id_crosswalk.source_record_id/business_discriminator/target_entity_type` 与 `projection_lineage.source_record_id/mapping_rule_id` 必须保留直接来源，确保一对多投影仍可反查。crosswalk 的 ReplacingMergeTree 逻辑键必须包含 `business_discriminator + target_entity_type`，不能仅凭上游 source record 合并一对多目标。

P2 需要一对多或非 passthrough 身份时，P1 必须在提交领域事实前按上述 `source_entity_type + derived-v1 discriminator` 预生成所有目标 crosswalk。除默认 Run/Segment 外，这同样适用于额外 PolicyDecision、同型派生事实等目标；Run/Segment 也要使用稳定且非空的 discriminator，例如 `default-run/default-segment`。P2 只能读取预生成的 `target_id`；找不到唯一 active crosswalk 时写 `ID_CROSSWALK_MISSING/ID_CROSSWALK_CONFLICT`，不得现场执行 UUIDv5 或生成随机 UUID。发布质量检查必须联查 sidecar 与 `id_crosswalk`，DDL 的非空检查不替代真实性验证。

长度按各子分量完成 NFC 与 trim 后的 UTF-8 字节数计算；子分量同样禁止 U+001F。`projection_lineage.lineage_id` 也必须用本节算法确定性生成，其 `source_entity_type=projection_lineage`，业务 discriminator 由 projection/version、source key、target key 与 mapping rule id/version 的长度前缀复合值构成。

同一个 source key 计算出不同 target UUID、同一个 target UUID 对应无显式合并关系的不同 source key，或同一个 source record ID 出现不同 Collector/Projector `payload_sha256`，都属于阻断冲突，必须写入死信，不得随机生成替代 ID。多个来源确需合并为同一 Episode 时，先建立版本化 merge manifest；manifest 指定的主 source key 决定 canonical UUID，其余 key 只增加 crosswalk，不重新选号。

<a id="P1"></a>

## 3. P1：领域应用到领域

P1 将车长和 NPC 的不同实现归一为同一领域证据图，但保留原始实现语义与直接/根血缘。

| 应用事实 | `sdar_embodied` 事实 | 规则 |
|---|---|---|
| `episode_metadata` | `episode` | 生成 canonical Episode；保留 adapter、scenario、父 Episode 与 source run 引用 |
| `trigger_record` | `trigger` | 保留触发类型、原始输入与对象引用 |
| `goal_record` | `goal` | 目标版本不得覆盖；更正追加新版本 |
| `success_criterion` | `success_criterion` | 保留 expected/comparator/critical |
| `constraint_record` | `constraint_record` | 保留 scope、severity、有效期与来源 |
| `state_snapshot` | `state_snapshot` | 保留状态版本、来源、时效和质量；可另投影设备/目标观察 |
| `state_delta` | `state_delta` | `from/to` 版本必须可验证；缺口进入质量问题 |
| `event_record` | `domain_event` | 事件表示已发生事实，不得当作状态或结果 |
| `execution_basis` | `execution_basis` | 原 `basis_type` 作为 `basis_kind` 完整保留 |
| `decision_record` | `decision` | 保留状态、Basis、候选项、风险与影响引用 |
| `gate_decision` | `safety_gate_decision` | 保留门槛、判定、审批要求与有效期 |
| `confirmation_record` | `human_confirmation` | 审批必须早于其授权行动且在有效期内 |
| `action_record` | `control_action` | 保留 basis/decision/before-state/idempotency key |
| `receipt_record` | `control_receipt` | transport、acceptance、execution 三层状态不合并 |
| `verification_record` | `verification` | 实际物理/业务验证可同时产生 `physical_verification` 专题事实 |
| `failure_record` | `failure` | 不得因恢复成功删除原失败 |
| `recovery_record` | `recovery` | 抢占恢复可同时产生 `preemption_recovery` 专题事实 |
| `trajectory_step` | `trajectory_step` | 保留 Episode sequence、前后状态和节点/Tick 引用 |
| `resource_claim` | `resource_claim_event` | acquire/release 均为追加事件，exclusive 冲突必须可检测 |
| `operational_metric` | `operational_metric` | 只保存运行测量值，不当作评价分数 |
| `final_outcome` | `final_outcome` | 成功必须能关联关键 success criterion 的 pass verification |
| `evidence_index` | `evidence_index` | 保留证据类型、哈希、存储引用和敏感级别 |

应用专用节点、Tick、Blackboard、UgvState 和任务轨道记录必须先解释成上表中的领域事实；原始日志本身不能绕过 Schema 校验直接成为可评分事实。每一个目标行至少写入：

```text
canonical_record_id / canonical_episode_id
source_database / source_table / source_record_id / source_payload_hash
root_source_database / root_source_table / root_source_record_id / root_source_payload_hash
mapping_rule_id / mapping_rule_version
projection_id / projection_version / projection_revision
source_deployment_id / source_environment_raw / environment_mapping_id / environment_map_version
payload_json / payload_sha256 / occurred_at
```

应用层 `payload_hash` 保留来源声明的 Hash，`payload_sha256` 是 Collector 对规范化完整载荷计算的 SHA-256。P1 的 `source_payload_hash/root_source_payload_hash` 只复制应用 `payload_sha256`；领域行自己的 `payload_sha256` 则对投影后的规范化 `payload_json` 重新计算。P2 必须把领域 `payload_sha256` 当作直接来源 Hash，不能误用仍指向应用输入的 `source_payload_hash`。Manifest 的 `fact_set_hash` 由按 canonical record ID 排序的 `(target_table, canonical_record_id, projection_revision, payload_sha256)` 元组计算。

P2 sidecar 的赋值没有自由度：`p1_source_payload_sha256=领域 source_payload_hash`、`root_source_payload_hash=领域 root_source_payload_hash`、`source_payload_sha256=领域 payload_sha256`、`target_payload_hash=core 目标事实 payload_hash`。P1 的 `projection_lineage.source_payload_hash` 写 Collector `payload_sha256`，P2 则写领域 `payload_sha256`；meta lineage 的 `target_payload_hash` 始终写对应目标规范化载荷 Hash。任何一层都不得把来源声明 Hash 冒充 Collector/Projector SHA-256。

<a id="P2"></a>

## 4. P2：领域到通用

P2 使用领域事实重新构造 SDAR 统一信封。下列映射是默认合同；条件映射必须将所用 `mapping_rule_id` 写入血缘。

| `sdar_embodied` | `sdar_core` | 规则 |
|---|---|---|
| `episode` | `episode` | canonical Episode UUID 原样携带 |
| `trigger` | `request_record` 或 `event_record` | 用户/结构化/同伴请求映射 Request；状态变化、异常、定时器、操作员控制和系统启动映射 Domain Event |
| `goal` | `goal_record` | 目标 ID 与版本稳定 |
| `success_criterion` | `success_criterion` | 不从 Outcome 反推成功条件 |
| `constraint_record` | `constraint_record` | 保留约束作用域与来源 |
| `state_snapshot` | `state_snapshot` | 状态版本、observedAt、质量和来源原样保留 |
| `state_delta` | `state_transition` | 仅在前后版本与 patch/变化可证明时生成 |
| `trajectory_step` | `state_trajectory` | 保留轨迹步、前后状态以及 Action/Receipt/Verification 因果引用 |
| `domain_event` | `event_record` | 保持事实语义 |
| `execution_basis` | `execution_basis` | 按第 7 节映射 `basis_purpose` |
| `decision` | `decision_record` | 策略评估可另生成 `policy_decision`，不得替代正式 Decision |
| `safety_gate_decision` | `execution_gate_decision` | 保留决策前状态、风险与适用 Action |
| `human_confirmation` | `human_confirmation` | 保留 scope、过期时间和关联行动 |
| `control_action` | `action_record` | 不从 Receipt 反推不存在的 Action |
| `control_receipt` | `action_receipt` | 按第 8 节映射三个状态层级 |
| `verification` | `verification_record` | `physical_verification` 只补充证据，不重复生成同一 verification |
| `failure`、`recovery`、`preemption_recovery` | `event_record` | 以独立不可变事件表达；不得覆盖原 Action 或 Decision |
| `final_outcome` | `episode_outcome` | 完成、失败、取消、部分完成与剩余事项必须保留 |
| `evidence_index` | `artifact_reference`/信封 `evidence_refs` | 外部内容按 hash 和 URI 引用 |
| `episode_evidence_bundle_manifest` | `artifact_reference` | bundle hash、证据水位与 projection version 必须保留 |
| `evaluation_readiness` | `evaluation_readiness` | 每次检查追加；消费者用 checkedAt/record version 取最新 |

设备/目标观察、状态时效、控制权和资源占用等专题事实，必须引用或生成上表中的 State、Policy、Decision、Event、Action、Verification 之一；专题表不能成为通用层无法追溯的旁路事实。

每个 P2 目标事实同步写入 `sdar_core.domain_projection_context`。普通一对一转换使用 `identity_mapping_mode=passthrough`，目标 `record_id` 等于领域 `canonical_record_id`，四个 `target_identity_*` 字段均为空。Run/Segment 及一对多派生实体等身份已由 P1 crosswalk 预先生成时使用 `identity_mapping_mode=p1_crosswalk`，目标 UUID 取对应 crosswalk，并完整填写 `target_identity_source_entity_type/source_id/business_discriminator/target_entity_type`。sidecar 必须快照 P1 `source_projection_contract_version/source_projection_mapping_hash` 以及 P2 `target_projection_contract_version/target_projection_mapping_hash/target_projection_revision`；同一目标表示的幂等重试复用 revision 和 Hash，新 projection version 改变表示时单调增加 revision，并以 `supersedes_lineage_id` 指向上一份上下文。P2 不得自行生成随机 UUID，也不得绕开 P1 identity contract。

P2 对每个通用输出必须先写一条 `sdar_core.raw_envelope`，其 `record_id/payload_hash/payload_json` 与随后列化到目标专表的行完全一致；写完 raw 后再写目标专表和 sidecar。属于 durable Evidence 的输出还必须以相同 `record_id/payload_hash` 写入 `sdar_core.evidence_index` 并取得 evidence sequence；目标本身就是 `evidence_index` 时不重复写第二行。任何专表行都不得缺少可重放的 raw envelope，raw 与 typed Hash 不一致时进入阻断质量问题。

## 5. Sequence 合同

当前 P1 合同把每个应用 Episode 规范化为一个 Run 和一个默认 Segment。这样即使应用只提供 Episode 级全局序号、`source_run_ids` 有多个且逐事实无法归属，P2 仍有确定且可重放的分区键。原 `source_run_ids` 完整保存在 Episode 中，不被当作已证明的分段关系。

P1 使用第 2 节的同一 UUIDv5 合同生成：

```text
run_id:
  source_entity_type = run
  source_id = "p1-default-run:" + normalized_episode_id
  business_discriminator = default-run
  target_entity_type = run

segment_id:
  source_entity_type = segment
  source_id = "p1-default-segment:" + normalized_episode_id
  business_discriminator = default-segment
  target_entity_type = segment
```

两项都写入 `id_crosswalk`。`sdar_embodied.run_id` 就是 canonical Run UUID，`segment_id` 是 canonical Segment UUID；二者在所有领域事实中必填。P2 原样透传它们，并用 Segment UUID 作为生成 `run_segment` 事实的目标身份。未来若要从 `source_run_ids` 拆分多 Run，必须发布新的投影合同版本并回放，不能在 1.1 运行中改变归属。

三类序号含义不同：

| 字段 | 作用域 | 规则 |
|---|---|---|
| `episode_sequence` | 应用/领域 Episode | P1 原样保留应用 `sequence`；重复或倒退阻断，缺口记录质量问题 |
| `run_sequence` / core `sequence` | 规范化 Run | P1 在一 Episode 一 Run 合同下复制已验证的 `episode_sequence`；P2 原样透传 |
| `evidence_sequence` | 通用 Run 内 durable Evidence | 仅 durable 事件分配，必须连续；best-effort 为 NULL |

P1 先按 `run_id` 重分区并验证 Episode sequence 单调性；重复、倒退或同序号多条不同事实均写阻断质量问题。P2 也按同一 `run_id` 有序消费，禁止用可能迟到的 `occurred_at` 重新编号。`source_position=(stream, partition, offset)` 写入 lineage，用于重放与解释迟到，但不是第二套业务序号。

迟到记录必须由采集端取得新的 Episode 末尾 sequence，同时保留真实 `occurred_at`；不得改写已发布序号。P2 只为 durable Evidence 分配 `evidence_sequence`，并把分配水位持久化到 checkpoint。`run_seal.last_evidence_sequence` 必须等于最后已提交 durable 序号。无法保证单 Run 单分区或恢复 evidence sequencer 时停止该 Run 并写死信。

## 6. Environment 与 Agent

`environment` 在通用信封中只允许 `dev/test/staging/prod`，而领域 `runtime_environment` 表示 `simulation/field_test/real_vehicle/replay/unknown`。二者必须分栏保存：

- Collector/Projector 从受控部署配置取得非空 `source_deployment_id`，不得从物理环境、主机名或代码运行环境猜测；
- P1 将采集信封的原始环境值保存到 `source_environment_raw`，把规范化部署环境写入 `environment`，并在所有领域事实中保存 `environment_map_version`；将 Episode 的 `runtime_environment` 保存为物理环境；
- P2 将部署环境写入 core `environment`；物理环境同时写入通用事实 `attributes['physical_environment']` 供筛选，并以 `sdar_core.domain_projection_context.source_runtime_environment` 作为无损权威值；
- 来源值已经是 `dev/test/staging/prod` 时仍保存原值，`environment_mapping_id` 可为 NULL；legacy 或其他非规范值必须由管理员在 `sdar_meta.deployment_environment_mapping` 配置精确的 tenant/project/source_system/deployment_id/source_environment 映射，并把所用行的 `record_id` 写入 `environment_mapping_id`；
- legacy 数据只有物理环境时，不允许从 `simulation/field_test/real_vehicle/replay` 推导部署环境；缺少受控 deployment 配置时同样不得投影；
- 找不到唯一 active 配置时进入 `ENVIRONMENT_UNMAPPED` 死信；映射版本必须进入 projection version 和 lineage，禁止按物理环境或代码运行环境临时猜测。
- 同一 `mapping_version + tenant/project/source_system/deployment_id/source_environment` 的状态更新必须复用 `deployment_environment_mapping.record_id`；映射内容或目标语义变化必须发布新的 `mapping_version` 并使用新的 record ID。否则已经写入领域事实和 sidecar 的 `environment_mapping_id` 会失去可解析目标。

P1 保留 `agent_type=commander|npc`。P2 根据统一信封约束写 `agent_type='sdar'`，同时写入：

```text
attributes['source_agent_type'] = commander | npc
attributes['source_adapter']    = commander | npc
attributes['source_agent_id']   = 原 agent_id
```

`agent_id` 与版本字段原样携带；不得把 commander/NPC 的来源身份丢失或伪装成原生 SDAR Runtime。

## 7. Execution Basis

领域 `basis_type` 表示依据的种类，通用 `basisType` 表示依据在通用流程中的使用阶段。二者没有安全的一对一字符串映射。

P2 必须从目标事实的明确关系确定 `basis_purpose`：用于 Plan 构造为 `planning`，用于正式 Decision 为 `decision`，直接授权 Action 为 `action`，用于 Verification 为 `verification`，用于恢复 Continuation 为 `continuation`。plan/SOP/policy/behavior-tree 等原值写入 `source_basis_type` 和 `attributes['basis_kind']`。同一领域 Basis 若被不同阶段使用，可以产生多个带不同 purpose 的通用 ExecutionBasis 表示，但每条都必须有独立、确定的 mapping rule 与 lineage。仅凭 basis kind 无法判定阶段时进入 `BASIS_PURPOSE_UNMAPPED` 死信。

## 8. Receipt

三个状态层级必须独立映射，transport 或 acceptance 成功绝不等于业务成功。

| 领域值 | 通用字段和值 |
|---|---|
| transport `ok/error/timeout/unknown` | `success/failure/timeout/unknown` |
| acceptance `rejected` | executor `rejected` |
| execution `planned/gated/dispatched` | executor `accepted` 仅当 acceptance=accepted，否则 `unknown` |
| execution `accepted/running/succeeded/failed/cancelled` | executor `accepted/working/completed/failed/cancelled` |
| execution `timed_out/unknown` | executor `failed/unknown` |
| execution `planned/gated/dispatched/accepted` | business `not_started` |
| execution `running/succeeded/failed/cancelled/timed_out/unknown` | business `running/succeeded/failed/cancelled/failed/unknown` |

若 acceptance=`rejected` 但 execution 为 running/succeeded，或 transport=`failure/timeout` 却无后续独立 Receipt 即宣告业务 succeeded，记录 `RECEIPT_STATUS_CONFLICT` 质量问题；不得择一覆盖。`receiptType` 只能依据明确的 remote-task binding/control 事实确定，无 remote-task 证据时使用 `immediate_result`，不能凭耗时猜测。

## 9. 幂等、提交与重放

每个输入事实的幂等键为：

```text
(tenant_id, project_id, projection_id, projection_version,
 source_database, source_table, source_record_id)
```

处理顺序固定为：

1. 验证 source ID、Schema、Collector/Projector `payload_sha256`、引用和投影版本；
2. 计算/校验 crosswalk；
3. P2 计算目标规范化载荷，并先写同 `record_id/payload_hash` 的 `raw_envelope`；P1 无此 core 步骤；
4. 以 deterministic canonical ID 写目标事实；P2 durable 输出同时写 `evidence_index`，并写 `domain_projection_context`；
5. 写 `projection_lineage`，并重复固定的 `contract_version/mapping_hash/id_namespace_version/environment_map_version` 及 `mapping_rule_id/mapping_rule_version`；
6. 更新 `projection_run` 的非终态计数与目标水位；该更新必须可由同一 run ID 幂等重放；
7. 整批以上写入完成后，最后提交 `projection_checkpoint`/消息消费位点；
8. 整次 run 的最终 `succeeded/failed` 状态可在最终 checkpoint 后写入，但不能作为已提交事实可见性的前置条件。

ClickHouse 不提供上述跨表事务，因此 checkpoint/消息位点必须是每批最后一个提交动作。崩溃恢复时从最后 checkpoint 重放，缺失的 raw/typed/index/sidecar/lineage 任一部分都按相同 ID 补齐；相同幂等键和 Collector/Projector `payload_sha256` 计为 duplicate，不产生新的语义事实。最终 run 状态写失败不得回滚已提交 checkpoint，也不得让已提交事实重新变成不可见。ReplacingMergeTree 只负责后台收敛，projector 与在线查询不得把它当成即时唯一约束。

同一 source record ID 的 Collector/Projector `payload_sha256` 改变时写 `SOURCE_MUTATION` 死信。合法更正必须使用新 source record ID 并声明 supersedes 关系。相同 projection version 的全量重放必须得到相同 canonical ID、目标规范化 payload SHA-256 和 mapping rule/version；否则 `projection_run.status=failed`。

任何语义映射变化都必须发布新的 `projection_version` 并使用新 `projection_run` 进行 shadow/backfill，禁止在同一 version 下热改规则。`sdar_embodied` 以 `projection_id + projection_version` 作为历史边界；同一版本内的 `projection_revision` 只用于确定性幂等修复。P2 sidecar 以唯一 `lineage_id` 保存每次版本化上下文，并通过 `target_projection_revision/supersedes_lineage_id` 串联表示变化。

core 专用事实表表达当前通用表示，并不承诺每张专表都携带或永久保留 projection revision。完整投影历史以 `sdar_core.raw_envelope/evidence_index`、版本化 `domain_projection_context.target_payload_hash` 和 meta lineage 为重放依据；不得声称只查询任意一张 core 专表即可恢复全部旧表示。评价结果必须绑定所读取的 projection version、bundle hash、readiness ID 和 source watermark，切换 active 版本后才能正式使用新结果。

## 10. 死信与可评价水位

至少以下错误必须进入 `sdar_meta.projection_dead_letter`：

```text
INVALID_ID_COMPONENT
ID_CROSSWALK_MISSING
ID_CROSSWALK_CONFLICT
SOURCE_MUTATION
RAW_TYPED_HASH_MISMATCH
SCHEMA_VALIDATION_FAILED
REFERENCE_NOT_FOUND
SEQUENCE_CONFLICT
ENVIRONMENT_UNMAPPED
BASIS_PURPOSE_UNMAPPED
RECEIPT_STATUS_CONFLICT
TARGET_WRITE_FAILED
LINEAGE_WRITE_FAILED
```

可重试死信由新的 projection run 处理，通过 `resolved_by_run_id` 关联；禁止原地删除。`severity`、`blocking` 和 `quality_rule_id/version` 决定其是否阻断评价。只有 checkpoint 已覆盖 Episode/Run 的 seal 水位、所有 required durable Evidence 已投影、无 open blocking dead letter且最新 readiness 为 ready/degraded 时，评价器才能启动。`not_ready` 不得产生正式分数。
