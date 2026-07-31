# `sdar_embodied` 完整领域事实层

## 1. 定位与边界

`sdar_embodied` 是车长智能体与 NPC 智能体的统一领域事实层，不再只是控制专题表集合。它覆盖一个 Episode 从触发到结果收口的完整可评价链路：

```text
Trigger / Goal / SuccessCriterion / Constraint
  → StateSnapshot / Event / StateDelta
  → ExecutionBasis / Decision
  → Action / Receipt / Verification
  → Failure / Recovery / Trajectory
  → FinalOutcome / EvidenceIndex / Manifest / Readiness
```

领域评价器只能读取 `sdar_embodied`，不应回查 `sdar_commander`、`sdar_npc` 或 `sdar_core`。如果评价所需事实尚未投影到本库，应将 Episode 标记为 `not_ready`，不得用上游库联表补数。

## 2. 表分组

| 领域阶段 | 表 | 用途 |
|---|---|---|
| Episode 与目标 | `episode`、`trigger`、`goal`、`success_criterion`、`constraint_record` | Episode 身份、触发事实、目标版本、可验证成功条件与约束 |
| 状态与事件 | `state_snapshot`、`state_delta`、`domain_event` | 权威状态、合法状态转换和已发生事实 |
| 执行依据与决策 | `execution_basis`、`decision` | 计划、规则、SOP、行为树分支和可审计正式决策 |
| 行动与验证 | `control_action`、`control_receipt`、`verification`、`physical_verification` | 行动请求、传输/受理/执行回执、通用成功条件验证及物理闭环验证 |
| 异常与轨迹 | `failure`、`recovery`、`trajectory_step`、`preemption_recovery` | 失败、恢复/重规划、状态因果轨迹和抢占恢复专题证据 |
| 控制安全专题 | `device_state_observation`、`target_state_observation`、`state_freshness_check`、`control_authority_event`、`safety_gate_decision`、`human_confirmation`、`resource_claim_event` | 状态时效、控制权、门槛、人工确认与资源互斥 |
| 收口与可评价性 | `final_outcome`、`operational_metric`、`evidence_index`、`episode_evidence_bundle_manifest`、`evaluation_readiness` | 最终结果、运行指标、证据索引、证据包快照与就绪结论 |

`domain_event` 和 `constraint_record` 分别对应领域 Schema 中的 Event 与 Constraint；表名避免与 SQL 语法词混淆。`verification` 是成功条件的通用验证事实，`physical_verification` 是需要设备时间戳、能力通道和稳定窗口的物理专项证据，两者不应相互替代。

## 3. 统一投影信封

所有物理表都带有同一组可追溯字段：

- `record_id` 和 `episode_key` 保留领域原始 String 标识；`canonical_record_id` 和 `canonical_episode_id` 是跨层关联和幂等所用 UUID。
- `source_deployment_id` 来自受控 Collector/Projector 部署配置；`source_environment_raw` 无损保留来源值，`environment_mapping_id/environment_map_version` 记录显式映射。已经规范为 `dev/test/staging/prod` 的来源仍保存原值；legacy 值必须命中唯一 mapping，不能从物理环境猜测部署环境。同一 mapping version/key 更新时复用 mapping record ID，语义变化则发布新版本与新 ID。
- `episode_sequence` 表示 Episode 内顺序。P1 为每个应用 Episode 建立一个规范化 Run 和一个默认 Segment，因此 `run_id`、`segment_id`、`run_sequence` 必填，DDL 强制 `run_sequence = episode_sequence`。P2 只透传该序号，不重新分配。`evidence_sequence` 仅对 durable Evidence 填写，best-effort 为 `NULL`。`sequence` 是 `episode_sequence` 的只读兼容别名。
- `source_*` 记录立即上游，即本次 Mapper 实际读取的库、表、记录和 Schema；`source_payload_hash` 是该输入载荷的 SHA-256 小写十六进制值。
- `root_source_*` 一直指向最初采集事实。Commander/NPC 直接投影时，root 与 immediate 相同；从其他领域投影二次生成时，root 必须原样传递。
- 业务记录自带的 Hash 可以是 32–128 字符的来源声明，因此 `control_action.input_hash`、`evidence_index.content_hash`、Manifest/Readiness 的 `bundle_hash` 使用 `String` 原样保留。`input_sha256` 和 `content_sha256` 只能在能从 payload/EvidenceRef 取回实际内容时计算，因此可为 `NULL`；禁止对来源 Hash 字符串本身再做 Hash 冒充内容 SHA。`bundle_sha256` 由规范化 Manifest 可确定计算，因此必填。
- `state_snapshot.state_hash` 原样保留应用声明，`state_sha256` 是 P1 对规范化领域状态强制计算的 SHA-256；P2 必须使用 `state_sha256` 写入 `sdar_core.state_snapshot.state_hash`。
- `projection_id`、`projection_version`、`projection_revision` 分别标识投影合同、合同版本和同一逻辑事实的单调投影修订。`mapping_rule_id/version` 继续记录具体字段映射规则。
- `payload_json` 保留完整领域 Schema 记录，`payload_sha256` 是 P1 对该领域目标载荷规范化后计算的 SHA-256；P2 以此作为直接来源 Hash，不得误用仍指向应用输入的 `source_payload_hash`。类型列用于常用关联、完整性检查和指标计算；类型列与 JSON 冲突时整条记录不得进入 ready 证据包。

### 3.1 Canonical UUID 生成规则

Mapper 不得使用随机 UUID。P1 必须使用 projection contract V1 唯一的 UUIDv5 规则：

```text
NAMESPACE = 5832c301-3d9e-5927-8f15-fa6262c8fc4e

name = "sdar-id-v1" + U+001F
     + tenant_id + U+001F
     + project_id + U+001F
     + source_agent_type + U+001F
     + source_entity_type + U+001F
     + normalized_source_id

canonical_id = uuid5(NAMESPACE, UTF8(name))
```

`U+001F` 是真实的 Unit Separator 字符，不是六个可见字符 `\u001F`。各分量在计算前必须先执行 Unicode NFC，再去除首尾 Unicode 空白；保留大小写，不进行 locale 转换、数字解析或 UUID 文本重写。任一分量为空或包含 U+001F 时必须拒绝记录并写入 `INVALID_ID_COMPONENT` 死信。`normalized_source_id` 是按上述规则处理后的源 ID。

Episode、Record、Action 等实体共用同一 namespace，并通过 `source_entity_type` 隔离命名空间。一条 source record 投影为多条或跨多个目标表时，必须使用 `projection_contract.md` 第 2 节定义的 `source_entity_type` 和 `derived-v1:{length}:{source_record_id}:{length}:{business_discriminator}` 复合源 ID；长度是 NFC/trim 后的 UTF-8 字节数，`business_discriminator` 必须是合同规定且可重放的业务键，禁止数组下标、批内序号或随机数。一对多的完整规则以 `projection_contract.md` 为唯一权威来源，本文不另行扩展。

P1 把计算结果写入 `sdar_meta.id_crosswalk`。P2 会产生一对多或非 passthrough 目标时，P1 也必须按目标 `source_entity_type + derived-v1 discriminator` 预生成相应 crosswalk；crosswalk 逻辑键包含 business discriminator 与 target entity type。P2 只能读取其 `target_id`，真实性由发布质量检查联查，不得临时 UUIDv5。`episode_key` 原样保留来源 Episode String，`canonical_episode_id` 单独保存 canonical UUID，二者不得相互覆盖。

当前 fresh-baseline 合同不拆分一个应用 Episode 内的多个来源 Run。P1 分别以 `source_entity_type=run/segment` 和稳定源 ID `p1-default-run:{episode_id}` / `p1-default-segment:{episode_id}` 计算 `run_id` 与 `segment_id`，并写入 crosswalk。Episode 的 `source_run_ids` 仅作为无损来源列表，不用于当前版本的 Run 拆分；未来支持多 Run 时必须发布新投影合同版本。

## 4. 追加写入、幂等与修正

事实表只允许 `INSERT`，不使用 `ALTER ... UPDATE`、`DELETE` 或业务时间分区上的替换。事实表统一使用：

```sql
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(canonical_episode_id) % 64
ORDER BY (tenant_id, project_id, canonical_episode_id,
          projection_id, projection_version, canonical_record_id)
```

它同时满足：

1. 原样重试使用相同 `projection_id/version + canonical_record_id + projection_revision`、来源 Hash 和输出载荷，后台合并后只保留一份逻辑事实。
2. 语义映射变化必须发布新的 `projection_version`；新旧版本保持相同 canonical entity ID，但因排序键含 projection id/version 而同时保留。同一版本的 `projection_revision` 只用于确定性修复，不能承载语义热改。
3. 业务事实本身被更正时，追加新的 `canonical_record_id`，并使用 `supersedes_record_id` 指向被更正的事实。
4. 同一 `projection_id/version + canonical_record_id + projection_revision` 若出现不同 payload/hash，是 Mapper 非确定性冲突，必须进入 DLQ，不得依赖 ReplacingMergeTree 任意选取。

按 `canonical_episode_id` 哈希分区保证同一逻辑键的所有修订不会跨月分区，避免时间分区下永不替换的重复版本。

`episode`、`episode_evidence_bundle_manifest`、`evaluation_readiness` 是 Episode 级可变对象，使用稳定 Episode 分区和 `ReplacingMergeTree(record_version)`，排序键同样包含 projection id/version。对象状态变化增加 `record_version`；投影语义变化发布新的 `projection_version`；相同版本的重试必须字节级一致。

## 5. 查询 latest 语义

ReplacingMergeTree 的后台合并是异步的。评价或证据包构建不得直接假设表中只有一个版本：

- 评价器先冻结明确的 `projection_id + projection_version`。Episode 级对象在该版本范围内使用 `v_episode_latest`、`v_episode_evidence_bundle_manifest_latest` 和 `v_evaluation_readiness_latest`；这些视图会保留不同 projection version 的各自 latest 行，调用方不能省略版本过滤。
- 事实表在冻结版本内使用 `FROM <table> FINAL`，或按 `projection_id/version + canonical_record_id` 执行 `argMax(..., projection_revision)`。大规模批评优先使用经过验证的 `argMax` 投影，并限定 `canonical_episode_id`。
- `FINAL` 只解决 Mapper 重试/投影修订；业务更正链还需根据 `supersedes_record_id` 排除已被替代事实。

Manifest 的 `record_counts`、序号范围、`projection_watermarks`、`source_max_ingested_at`、`fact_set_hash` 和 `bundle_hash` 固定一次证据快照。Readiness 必须绑定 `bundle_id + bundle_hash + manifest_record_version + facts_cutoff_at`，使评价输入可重放。

## 6. 状态时效的缺失语义

`freshness_ms`、缺失时的 `observed_at` 和无法计算的 `age_ms` 使用 `Nullable`。`NULL` 表示“未采集或无法计算”，`0` 只表示可证明的零毫秒。评价器不得将 `NULL` 按新鲜状态处理；高风险动作引用的关键状态时效缺失时，应生成质量问题并按 Profile 规则触发门槛判定。

## 7. 领域评价最小读取流程

```text
冻结 projection_id + projection_version
  → v_episode_latest
  → v_evaluation_readiness_latest (status = ready)
  → v_episode_evidence_bundle_manifest_latest
  → 按 canonical_episode_id 读取各事实表的 latest 投影
  → 校验 EvidenceIndex、引用、时序、状态轨迹和成功条件
  → 从本层事实独立计算 embodied_* 评价
```

Readiness 为 `ready` 至少要满足：Trigger、一个有效 Goal 及关键 SuccessCriterion、初始/最终 StateSnapshot、Event/Decision/Action 因果链、副作用 Action 的 Receipt、关键 Criterion 的 Verification、可重建 Trajectory、FinalOutcome，以及与 Manifest 一致的 EvidenceIndex。缺失项必须写入 `missing_evidence_types`，而不是通过默认值补齐。

`input_sha256` / `content_sha256` 因实际内容不可取而为 `NULL` 时，领域事实仍可保留，但 Readiness 必须按 Profile 标记为 `not_ready` 或 `degraded`；需要内容可核验的高证据等级不得启用。
