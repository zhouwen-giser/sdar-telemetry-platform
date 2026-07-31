# 验证与上线门槛

验证分为“DDL 能执行”“投影可追溯”“证据已就绪”“评价可重放”四层。只看到表已创建不代表数据可评价。

## 1. 构建与 DDL 编译

```bash
python3 tools/build_package.py
python3 tools/build_package.py --check

CLICKHOUSE_BIN=/opt/clickhouse-24.8/clickhouse tools/validate_clickhouse.sh
CLICKHOUSE_BIN=/opt/clickhouse-25.3/clickhouse tools/validate_clickhouse.sh
```

`09_smoke_test.sql` 保留已发布的 v1.1 基线断言，`10_sdar_v1_3_skill_aware.sql` 在追加 DDL/策略后执行 v1.3 最终断言。任何数据库、物理表、兼容视图、种子数量、规则权重或稳定分区断言不满足时都会 `throwIf`，客户端必须非零退出。`docs/static_validation.txt` 只是可复现的文本静态检查；不能替代两版 ClickHouse 实编。

## 2. 采集幂等与 Hash

来源 ID 相同但规范载荷 SHA-256 不同属于阻断冲突：

```sql
SELECT
    tenant_id,
    project_id,
    record_id,
    uniqExact(payload_sha256) AS sha_count,
    groupUniqArray(toString(payload_sha256)) AS hashes
FROM sdar_commander.raw_record
GROUP BY tenant_id, project_id, record_id
HAVING sha_count > 1;
```

对 `sdar_npc.raw_record` 执行同样查询。`payload_sha256 FixedString(64)` 存储的是 64 个 ASCII 小写十六进制字符，不是 32-byte 二进制摘要；查询时直接 `toString()`，禁止再用 `hex()` 二次编码为 128 字符。来源声明的 `payload_hash` 可以使用不同算法，但 `payload_sha256` 必须由 Collector 对同一套 canonical JSON 算法计算。相同 ID/不同 SHA 不允许由 ReplacingMergeTree 任意选择。

## 3. Projector 健康

```sql
-- 未解决的阻断死信
SELECT error_code, count()
FROM sdar_meta.projection_dead_letter
WHERE resolution_status = 'open' AND blocking = 1
GROUP BY error_code
ORDER BY count() DESC;

-- 运行失败、长期运行或输入输出不平衡
SELECT *
FROM sdar_meta.projection_run
WHERE status IN ('failed', 'stalled')
   OR dead_letter_count > 0;

-- 同一来源身份映射到多个 canonical UUID
SELECT source_key_hash, uniqExact(target_id) AS target_count
FROM sdar_meta.id_crosswalk
GROUP BY source_key_hash
HAVING target_count > 1;

-- P2 是否保留 P1 canonical 身份；synthetic run/segment 使用 p1_crosswalk 模式
SELECT *
FROM sdar_core.domain_projection_context
WHERE source_canonical_episode_id != canonical_episode_id
   OR (identity_mapping_mode = 'passthrough' AND source_canonical_record_id != target_record_id)
   OR identity_mapping_mode NOT IN ('passthrough', 'p1_crosswalk');
```

切换门槛：P1/P2 checkpoint 追平指定 source watermark；该水位之前没有 open blocking DLQ；crosswalk 和目标 Hash 冲突均为 0。

## 4. 应用层证据

应用 evaluator 只读本应用库。正式评价 Episode 至少满足：

- 最新 Bundle `build_status` 成功且 `sequence_complete=1`；
- initial/final State 与 Outcome 均存在；
- Action 的 Basis ID/version、Decision 和 before State 均可解析；
- 副作用 Action 有幂等键、适用 Gate、Receipt，成功声明还有 pass Verification；
- 最终 State 是 Bundle 水位内的最新版本。

诊断视图：

```text
sdar_commander.v_orphan_action
sdar_commander.v_completed_without_verification
sdar_commander.v_bundle_final_state_not_latest
sdar_npc.v_orphan_action
sdar_npc.v_completed_without_verification
sdar_npc.v_bundle_final_state_not_latest
```

对待评价 cohort 查询以上视图必须返回 0 行。活跃 Episode 可以暂时出现，不能和 sealed cohort 混合统计。

## 5. 领域层证据

领域 evaluator 只读 `sdar_embodied`，从以下 latest 入口固定快照：

```text
v_episode_latest
v_episode_evidence_bundle_manifest_latest
v_evaluation_readiness_latest
```

诊断视图：

```text
v_readiness_issue
v_missing_readiness
v_invalid_physical_verification_source
v_minimal_evidence_overclaim
v_control_authority_conflict
v_resource_claim_conflict
v_duplicate_control_dispatch
```

`minimal` 采集只能做允许的应用轻量评价。它不得生成物理 Verification pass、状态新鲜 pass、完整轨迹或 domain/general 正式通过；相应结果必须为 `insufficient_evidence / NE / passed=0`。

Input/Evidence 内容无法取回时，`input_sha256/content_sha256` 保持 NULL 并使 readiness 降级；禁止对已有 Hash 字符串再次求 Hash 来伪造内容 SHA-256。

## 6. 通用层证据

先检查 v1.3 策略与 Canonical Envelope：

```sql
SELECT record_type, delivery_guarantee, evaluation_role, sampling_allowed
FROM sdar_meta.evidence_policy FINAL
WHERE status = 'active'
  AND (delivery_guarantee != 'transactional' OR sampling_allowed != 0);

SELECT record_id, uniqExact(payload_hash) AS hash_count
FROM sdar_core.raw_envelope
WHERE evidence_family = 'sdar.evidence/v1'
GROUP BY record_id
HAVING hash_count > 1;
```

冻结的 18 类策略均为 transactional、需要 evidence sequence 且禁止采样；除 `skill_patch_candidate` 为 supporting 外均为 required。正式 Skill-aware cohort 还必须验证 Skill 执行树无孤儿/环、选择结果属于候选且满足适用性、计划合规引用可解析、失败传播和证据要求闭合。相关检查结果写入 `evaluation_readiness` 的 Skill 完整性列；`ready` 仍不等于评价通过。

正式 general 评价先检查：

```text
sdar_core.v_evidence_sequence_gap
sdar_core.v_duplicate_evidence_sequence
sdar_core.v_unsealed_episode
sdar_core.v_terminal_state_mismatch
sdar_core.v_remote_task_without_terminal
sdar_core.v_unprocessed_control_event
sdar_core.v_uncertain_cancellation
sdar_core.v_not_ready_evaluation
sdar_core.v_completed_action_without_passed_verification
sdar_core.v_domain_projection_reference_issue
```

durable evidence 的完整性按 `(tenant_id, project_id, episode_id, run_id)` 检查：最小序号必须为 1，中间无缺口/不同 record 的重号，最大序号等于最新 `run_seal.last_evidence_sequence`，seal 后不得新增较大 evidence sequence。物理业务成功不能由 Receipt 单独证明。

`v_domain_projection_reference_issue` 必须在发布 cohort 中返回 0 行。它以 `issue_code` 区分：P1 crosswalk 缺失、非唯一或非 active；legacy 环境缺少 mapping、任意已填写 mapping ID 未唯一命中 active 配置；P1/P2 `projection_version` 的 id/version/contract/mapping hash 未唯一命中；P2 目标缺少同 ID/Hash 的 `raw_envelope`，以及 durable 目标缺少同 ID/Hash 的 `evidence_index`。任一行都是阻断性投影或重放问题。

## 7. 评价结果一致性

每个父结果及其 Metric/Gate/Fatal 子记录必须完全一致地绑定：

```text
evaluation_group_id
evaluation_id + result_version
framework/profile
metric_set + gate_set + fatal_set
evaluator/config hash
projection/version
evidence snapshot/hash/watermark
```

检查：

```text
sdar_mart.v_evaluation_orphan_child
sdar_mart.v_evaluation_duplicate_payload_conflict
sdar_mart.v_evaluation_provenance_mismatch
sdar_mart.v_evaluation_outcome_inconsistent
sdar_mart.v_evaluation_score_reconciliation_issue
sdar_mart.v_evaluation_rule_set_registry_mismatch
```

六个视图对发布 cohort 必须为 0 行。规则集 registry 只有唯一且 `active` 的完整身份/Hash 才能用于正式结果；`draft` 试算会由 `RULE_SET_NOT_ACTIVE` 明确标记，不能进入发布 cohort。同一 `evaluation_group_id` 下可以有 application/domain/general 三份结果，但它们的 `evaluation_id`、证据快照和分数各自独立。规则、事实、Projector 或 Evaluator 任一版本变化都必须创建新的 `result_version`；相同 result version 的不同 row payload Hash 是非确定性错误。

## 8. 发布门槛

发布前固定 cohort 和水位，并全部满足：

1. 24.8 与 25.3 fresh-install 编译通过，生成产物无 stale。
2. v1.1 Event Policy 历史目录仍为 103 条；v1.3 Evidence Policy 为 18 条，均 transactional、需要 evidence sequence、禁止采样，且评价角色与冻结目录一致。
3. 四个 draft/待激活 Profile 各有 15 Metric、7 Gate、7 Fatal，Metric 权重合计 100；12 个规则集 registry 的数量与 Hash 可重算，实际生产使用的 Profile 和 registry 均已审批 active。
4. Collector Hash 冲突、crosswalk 冲突、P1/P2 open blocking DLQ 为 0。
5. Projector checkpoint 到达冻结水位，Manifest/Readiness 与该水位一致。
6. 应用、领域、通用质量视图在发布 cohort 上均为 0。
7. 随机抽样可从应用源记录追到领域事实、通用事实和三份独立评价结果，并复算得到相同结果 Hash。
