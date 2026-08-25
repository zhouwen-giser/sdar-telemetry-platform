-- SDAR ClickHouse Schema 1.4.1-rc.1 / Experience, Replay and Artifact facts.
-- Runtime PostgreSQL remains the source of truth; these facts support mining,
-- replay analysis, evaluation dataset construction and artifact governance.

CREATE TABLE IF NOT EXISTS sdar_core.goal_experience_episode_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    episode_id String,
    task_id String,
    goal_id String,
    goal_version UInt32,
    source_hash FixedString(64),
    completeness Float32,
    data_classification LowCardinality(String),
    terminal_outcome_ref String DEFAULT '',
    episode_status LowCardinality(String),
    snapshot_artifact_ref String,
    missing_fact_codes Array(String),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.experience_trace_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    trace_id String,
    source_episode_id String,
    normalizer_version String,
    contract_version String,
    task_type_refs Array(String),
    goal_fingerprint FixedString(64),
    capability_fingerprint FixedString(64),
    environment_fingerprint FixedString(64),
    trace_hash FixedString(64),
    completeness Float32,
    outcome_status LowCardinality(String),
    data_classification LowCardinality(String),
    event_count UInt32,
    missing_fact_codes Array(String),
    trace_artifact_ref String,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, trace_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.experience_trace_event_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    trace_id String,
    source_episode_id String,
    trace_sequence UInt64,
    trace_event_id String,
    event_type LowCardinality(String),
    actor_type LowCardinality(String),
    activity_key String DEFAULT '',
    activity_kind LowCardinality(String) DEFAULT '',
    parent_event_refs Array(String),
    concurrency_group String DEFAULT '',
    branch_ref String DEFAULT '',
    capability_refs Array(String),
    authority_refs Array(String),
    payload_summary_json String CODEC(ZSTD(3)),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, trace_id, trace_sequence, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.experience_activity_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    trace_id String,
    activity_key String,
    activity_kind LowCardinality(String),
    objective_summary String,
    source_plan_node_ref String DEFAULT '',
    source_skill_goal_ref String DEFAULT '',
    source_attempt_ref String DEFAULT '',
    operation_ref String DEFAULT '',
    capability_refs Array(String),
    effect_refs Array(String),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, trace_id, activity_key, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.planning_correction_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    correction_id String,
    task_id String,
    goal_id String,
    correction_scope LowCardinality(String),
    actor_type LowCardinality(String),
    before_hash FixedString(64),
    instruction_hash FixedString(64),
    patch_hash FixedString(64),
    after_hash FixedString(64),
    validation_result LowCardinality(String),
    correction_artifact_ref String,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, correction_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.interaction_episode_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    interaction_episode_id String,
    task_id String,
    goal_id String,
    interaction_type LowCardinality(String),
    correction_refs Array(String),
    input_hash FixedString(64),
    output_hash FixedString(64),
    outcome_status LowCardinality(String),
    snapshot_artifact_ref String,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, interaction_episode_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.process_variant_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    variant_id String,
    cohort_fingerprint FixedString(64),
    algorithm_version String,
    activity_sequence Array(String),
    activity_kind_sequence Array(String),
    concurrency_groups_json String CODEC(ZSTD(3)),
    branch_sequence Array(String),
    occurrence_count UInt64,
    success_count UInt64,
    failure_count UInt64,
    trace_refs Array(String),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, variant_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.workflow_pattern_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    workflow_pattern_id String,
    task_type_id String,
    algorithm_version String,
    source_pattern_ref String,
    source_trace_refs Array(String),
    support_count UInt64,
    support_rate Float32,
    success_rate Float32,
    trace_coverage Float32,
    fitness Float32,
    precision_proxy Float32,
    contradiction_rate Float32,
    generalization Float32,
    pattern_hash FixedString(64),
    pattern_artifact_ref String,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, workflow_pattern_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.workflow_pattern_dependency_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    workflow_pattern_id String,
    predecessor_activity_key String,
    successor_activity_key String,
    relation LowCardinality(String),
    condition_hash String DEFAULT '',
    support_refs Array(String),
    contradiction_refs Array(String),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, workflow_pattern_id, predecessor_activity_key, successor_activity_key, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.recovery_pattern_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    workflow_pattern_id String,
    recovery_pattern_id String,
    trigger_activity_key String,
    resume_activity_key String DEFAULT '',
    activity_sequence Array(String),
    required_capability_refs Array(String),
    support_refs Array(String),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, workflow_pattern_id, recovery_pattern_id, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.replay_dataset_version_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    dataset_id String,
    dataset_version String,
    dataset_status LowCardinality(String),
    source_snapshot_hash FixedString(64),
    split_policy_hash FixedString(64),
    case_count UInt64,
    leakage_check_status LowCardinality(String),
    no_physical_effects UInt8,
    manifest_artifact_ref String,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, dataset_id, dataset_version, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.replay_case_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    dataset_id String,
    dataset_version String,
    case_id String,
    case_version UInt32,
    scenario_family String,
    split LowCardinality(String),
    input_hash FixedString(64),
    expected_contract_hash FixedString(64),
    input_artifact_ref String,
    expected_contract_artifact_ref String,
    case_status LowCardinality(String),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, dataset_id, dataset_version, case_id, case_version, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.replay_run_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    replay_run_id String,
    dataset_id String,
    dataset_version String,
    agent_version String,
    skill_version_refs Array(String),
    run_status LowCardinality(String),
    physical_call_count UInt64,
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    run_config_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, replay_run_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.replay_case_result_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    replay_run_id String,
    dataset_id String,
    dataset_version String,
    case_id String,
    case_version UInt32,
    result_status LowCardinality(String),
    verdict LowCardinality(String),
    score Float64,
    evidence_refs Array(String),
    failure_codes Array(String),
    result_hash FixedString(64),
    result_artifact_ref String,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, replay_run_id, case_id, case_version, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.replay_metric_result_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    replay_run_id String,
    case_id String,
    metric_id String,
    metric_version String,
    applicable UInt8,
    raw_score UInt8,
    weight Float64,
    weighted_score Float64,
    evidence_level LowCardinality(String),
    evidence_refs Array(String),
    finding String DEFAULT '',
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, replay_run_id, case_id, metric_id, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.counterexample_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    counterexample_id String,
    replay_run_id String,
    case_id String,
    source_pattern_ref String DEFAULT '',
    failure_type LowCardinality(String),
    severity LowCardinality(String),
    expected_contract_ref String,
    actual_result_ref String,
    evidence_refs Array(String),
    counterexample_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, counterexample_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.artifact_lifecycle_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    artifact_id String,
    artifact_version UInt64,
    artifact_type LowCardinality(String),
    lifecycle_status LowCardinality(String),
    content_hash FixedString(64),
    source_refs Array(String),
    supersedes_refs Array(String),
    actor_id String,
    lifecycle_reason String DEFAULT '',
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, artifact_id, artifact_version, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.artifact_validation_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    artifact_id String,
    artifact_version UInt64,
    validation_id String,
    validator_id String,
    validator_version String,
    validation_status LowCardinality(String),
    rule_set_hash FixedString(64),
    findings_json String CODEC(ZSTD(3)),
    validation_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, artifact_id, artifact_version, validation_id, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.artifact_retrieval_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    retrieval_id String,
    artifact_id String,
    artifact_version UInt64,
    task_id String DEFAULT '',
    requester_scope String,
    retrieval_stage LowCardinality(String),
    rank UInt32,
    applicability_status LowCardinality(String),
    policy_result LowCardinality(String),
    cache_hit UInt8,
    latency_ms UInt64,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, retrieval_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.artifact_usage_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    usage_id String,
    artifact_id String,
    artifact_version UInt64,
    task_id String,
    goal_id String DEFAULT '',
    plan_id String DEFAULT '',
    usage_stage LowCardinality(String),
    usage_status LowCardinality(String),
    selected UInt8,
    fallback_used UInt8,
    outcome_ref String DEFAULT '',
    usage_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, usage_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.artifact_feedback_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    feedback_id String,
    artifact_id String,
    artifact_version UInt64,
    usage_id String,
    feedback_type LowCardinality(String),
    feedback_status LowCardinality(String),
    score Nullable(Float64),
    reason_codes Array(String),
    evidence_refs Array(String),
    drift_signal UInt8,
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, feedback_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.artifact_promotion_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id UUID,
    evidence_record_id String,
    source_system LowCardinality(String),
    source_table String,
    source_record_id String,
    source_revision String DEFAULT '',
    correlation_id String,
    causation_id String DEFAULT '',
    payload_hash FixedString(64),
    promotion_id String,
    artifact_id String,
    artifact_version UInt64,
    from_status LowCardinality(String),
    to_status LowCardinality(String),
    policy_id String,
    policy_version String,
    replay_run_refs Array(String),
    approval_refs Array(String),
    promotion_status LowCardinality(String),
    actor_id String,
    promotion_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, promotion_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE VIEW IF NOT EXISTS sdar_core.v_experience_trace_current AS
SELECT * FROM sdar_core.experience_trace_fact
ORDER BY recorded_at DESC, ingested_at DESC
LIMIT 1 BY tenant_id,project_id,trace_id,normalizer_version;

CREATE VIEW IF NOT EXISTS sdar_core.v_experience_trace_missing_fact AS
SELECT tenant_id,project_id,trace_id,arrayJoin(missing_fact_codes) AS missing_fact_code,
       completeness,occurred_at
FROM sdar_core.experience_trace_fact
WHERE length(missing_fact_codes)>0;

CREATE VIEW IF NOT EXISTS sdar_core.v_experience_trace_parent_gap AS
SELECT e.tenant_id,e.project_id,e.trace_id,e.trace_event_id,parent_ref
FROM sdar_core.experience_trace_event_fact AS e
ARRAY JOIN e.parent_event_refs AS parent_ref
LEFT JOIN sdar_core.experience_trace_event_fact AS p
 ON e.tenant_id=p.tenant_id AND e.project_id=p.project_id
 AND e.trace_id=p.trace_id AND parent_ref=p.trace_event_id
WHERE p.trace_event_id='';

CREATE VIEW IF NOT EXISTS sdar_core.v_replay_dataset_current AS
SELECT * FROM sdar_core.replay_dataset_version_fact
ORDER BY dataset_version DESC, recorded_at DESC
LIMIT 1 BY tenant_id,project_id,dataset_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_artifact_lifecycle_current AS
SELECT * FROM sdar_core.artifact_lifecycle_fact
ORDER BY artifact_version DESC, recorded_at DESC
LIMIT 1 BY tenant_id,project_id,artifact_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_experience_pattern_replay_chain AS
SELECT t.tenant_id,t.project_id,t.trace_id,t.source_episode_id,p.workflow_pattern_id,
       p.task_type_id,d.dataset_id,d.dataset_version,r.replay_run_id,r.run_status
FROM sdar_core.experience_trace_fact AS t
LEFT JOIN
(
    SELECT tenant_id,project_id,workflow_pattern_id,task_type_id,pattern_hash,
           arrayJoin(source_trace_refs) AS source_trace_id
    FROM sdar_core.workflow_pattern_fact
) AS p
  ON t.tenant_id=p.tenant_id
 AND t.project_id=p.project_id
 AND t.trace_id=p.source_trace_id
LEFT JOIN sdar_core.replay_dataset_version_fact AS d
  ON p.tenant_id=d.tenant_id
 AND p.project_id=d.project_id
 AND p.pattern_hash=d.source_snapshot_hash
LEFT JOIN sdar_core.replay_run_fact AS r ON d.tenant_id=r.tenant_id AND d.project_id=r.project_id
 AND d.dataset_id=r.dataset_id AND d.dataset_version=r.dataset_version;
