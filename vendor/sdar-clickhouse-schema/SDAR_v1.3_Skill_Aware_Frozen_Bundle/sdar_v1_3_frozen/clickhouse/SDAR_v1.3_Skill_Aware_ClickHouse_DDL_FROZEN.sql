-- SDAR v1.3 Skill-aware ClickHouse DDL（冻结版）
-- 目标：新增 Skill-aware 一级事实表，并为既有核心事实表增加 Skill 关联字段。
-- 注意：ALTER 部分须在基础核心表已创建后执行；生产环境只允许追加 Migration。

CREATE DATABASE IF NOT EXISTS sdar_core;
CREATE TABLE IF NOT EXISTS sdar_core.skill_usage_snapshot
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    skill_id String,
    skill_version UInt32,
    usage_spec_version String,
    usage_spec_hash FixedString(64),
    usage_spec_source LowCardinality(String),
    visibility LowCardinality(String),
    supported_modes Array(LowCardinality(String)),
    default_mode LowCardinality(String),
    normative_hash FixedString(64),
    adaptive_hash FixedString(64),
    evidence_policy_hash FixedString(64),
    package_checksum String DEFAULT '',
    package_source_ref String DEFAULT '',
    snapshot_artifact_ref String,
    lifecycle_status LowCardinality(String),
    captured_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_candidate_record
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    discovery_id String,
    candidate_id String,
    skill_id String,
    skill_version UInt32,
    retrieval_source LowCardinality(String),
    semantic_score Nullable(Float32),
    graph_score Nullable(Float32),
    quality_score Nullable(Float32),
    combined_score Nullable(Float32),
    visibility LowCardinality(String),
    usage_spec_source LowCardinality(String),
    eligible UInt8,
    exclusion_reasons_json String DEFAULT '[]' CODEC(ZSTD(3)),
    candidate_snapshot_hash FixedString(64),
    discovered_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_applicability_record
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    applicability_id String,
    skill_id String,
    skill_version UInt32,
    applicability_status LowCardinality(String),
    satisfied_requirements Array(String),
    missing_requirements Array(String),
    blocking_requirements Array(String),
    unknown_requirements Array(String),
    context_requirement_ids Array(String),
    requires_read_only_query UInt8,
    requires_user_input UInt8,
    requires_confirmation UInt8,
    reason_summary String,
    evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    assessed_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_context_resolution
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    context_resolution_id String,
    context_requirement_id String,
    skill_id String,
    skill_version UInt32,
    requirement_name String,
    requirement_type LowCardinality(String),
    resolution_status LowCardinality(String),
    source LowCardinality(String),
    value_hash String DEFAULT '',
    value_summary String DEFAULT '',
    value_artifact_ref String DEFAULT '',
    authoritative UInt8,
    freshness_observed_at Nullable(DateTime64(3, 'UTC')),
    valid_until Nullable(DateTime64(3, 'UTC')),
    conflict_refs Array(String),
    evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    resolved_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_selection_record
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    selection_id String,
    candidate_ids Array(String),
    selected_skill_id String DEFAULT '',
    selected_skill_version UInt32 DEFAULT 0,
    selection_status LowCardinality(String),
    no_skill_fallback LowCardinality(String),
    reason_summary String,
    decision_id String,
    applicability_id String DEFAULT '',
    selected_usage_spec_hash String DEFAULT '',
    selected_usage_spec_source LowCardinality(String) DEFAULT '',
    evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    selected_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_mode_selection
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    mode_selection_id String,
    skill_id String,
    skill_version UInt32,
    supported_modes Array(LowCardinality(String)),
    selected_mode LowCardinality(String) DEFAULT '',
    selection_status LowCardinality(String),
    risk_level LowCardinality(String),
    context_completeness LowCardinality(String),
    task_readiness_summary LowCardinality(String),
    human_confirmation_id String DEFAULT '',
    reason_summary String,
    evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    selected_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_composition_record
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    composition_id String,
    root_skill_id String,
    root_skill_version UInt32,
    composition_status LowCardinality(String),
    default_depth_limit UInt8,
    hard_depth_limit UInt8,
    effective_depth_limit UInt8,
    max_expanded_skills UInt32,
    max_expanded_nodes UInt32,
    actual_max_depth UInt8,
    expanded_skill_count UInt32,
    expanded_node_count UInt32,
    cycle_detected UInt8,
    duplicate_expansion_detected UInt8,
    budget_exceeded UInt8,
    composition_hash FixedString(64),
    composition_artifact_ref String DEFAULT '',
    created_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_composition_edge
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    composition_edge_id String,
    composition_id String,
    parent_skill_id String,
    parent_skill_version UInt32,
    child_skill_id String,
    child_skill_version UInt32,
    edge_type LowCardinality(String),
    capability_slot_id String DEFAULT '',
    input_mapping_hash String DEFAULT '',
    output_mapping_hash String DEFAULT '',
    input_compatible UInt8,
    output_compatible UInt8,
    recursion_depth UInt8,
    remaining_recursion_budget UInt8,
    failure_policy LowCardinality(String),
    selected_by LowCardinality(String),
    evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_capability_slot_resolution
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    slot_resolution_id String,
    composition_id String,
    capability_slot_id String,
    capability_name String,
    required_input_schema_ref String DEFAULT '',
    required_output_schema_ref String DEFAULT '',
    candidate_skill_ids Array(String),
    selected_skill_id String DEFAULT '',
    selected_skill_version UInt32 DEFAULT 0,
    resolution_status LowCardinality(String),
    selection_reason String,
    input_compatible UInt8,
    output_compatible UInt8,
    provider_policy_satisfied UInt8,
    recursion_budget_satisfied UInt8,
    evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    resolved_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_interpretation_record
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    interpretation_id String,
    skill_id String,
    skill_version UInt32,
    execution_mode LowCardinality(String),
    bounded_instruction_hash FixedString(64),
    normative_hash FixedString(64),
    adaptive_hash FixedString(64),
    template_instance_ref String DEFAULT '',
    procedure_program_ref String DEFAULT '',
    guidance_context_ref String DEFAULT '',
    interpretation_status LowCardinality(String),
    invalid_reasons Array(String),
    created_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_procedure_compilation
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    compilation_id String,
    skill_id String,
    skill_version UInt32,
    procedure_program_hash FixedString(64),
    procedure_program_artifact_ref String,
    target_workflow_definition_id String DEFAULT '',
    target_workflow_version UInt32 DEFAULT 0,
    target_workflow_hash String DEFAULT '',
    compilation_status LowCardinality(String),
    deterministic UInt8,
    validation_errors Array(String),
    compiler_version String,
    compiled_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_plan_compliance
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    plan_compliance_id String,
    skill_execution_id String,
    root_skill_execution_id String,
    skill_id String,
    skill_version UInt32,
    plan_id String,
    plan_version UInt32,
    compliance_result LowCardinality(String),
    checks_json String CODEC(ZSTD(3)),
    repair_attempt_count UInt16,
    repaired_plan_version UInt32 DEFAULT 0,
    report_hash FixedString(64),
    report_artifact_ref String DEFAULT '',
    checked_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_execution_record
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    skill_execution_id String,
    root_skill_execution_id String,
    parent_skill_execution_id String DEFAULT '',
    skill_id String,
    skill_version UInt32,
    usage_spec_version String,
    usage_spec_hash FixedString(64),
    usage_spec_source LowCardinality(String),
    execution_mode LowCardinality(String),
    execution_status LowCardinality(String),
    recursion_depth UInt8,
    remaining_recursion_budget UInt8,
    failure_policy LowCardinality(String),
    selection_id String,
    applicability_id String,
    mode_selection_id String,
    composition_id String DEFAULT '',
    plan_compliance_id String DEFAULT '',
    plan_id String DEFAULT '',
    plan_version UInt32 DEFAULT 0,
    workflow_instance_id String DEFAULT '',
    context_snapshot_hash String DEFAULT '',
    context_snapshot_artifact_ref String DEFAULT '',
    started_at Nullable(DateTime64(3, 'UTC')),
    waiting_external_at Nullable(DateTime64(3, 'UTC')),
    ended_at Nullable(DateTime64(3, 'UTC')),
    degraded UInt8,
    degraded_reasons Array(String),
    missing_effects Array(String),
    outcome_summary String DEFAULT '',
    record_version UInt32,

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_execution_relation
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    relation_id String,
    root_skill_execution_id String,
    parent_skill_execution_id String,
    child_skill_execution_id String,
    composition_id String,
    composition_edge_id String,
    capability_slot_id String DEFAULT '',
    failure_policy LowCardinality(String),
    relation_status LowCardinality(String),
    created_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_failure_propagation
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    propagation_id String,
    child_skill_execution_id String,
    parent_skill_execution_id String DEFAULT '',
    failure_policy LowCardinality(String),
    child_outcome LowCardinality(String),
    propagation_action LowCardinality(String),
    replacement_skill_execution_id String DEFAULT '',
    missing_effects Array(String),
    degraded_reasons Array(String),
    evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    propagated_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_evidence_requirement
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    evidence_requirement_id String,
    skill_execution_id String,
    requirement_name String,
    requirement_type LowCardinality(String),
    required UInt8,
    critical UInt8,
    requirement_status LowCardinality(String),
    expected_evidence_types Array(String),
    actual_evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    failure_code String DEFAULT '',
    failure_summary String DEFAULT '',
    checked_at Nullable(DateTime64(3, 'UTC')),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;


CREATE TABLE IF NOT EXISTS sdar_core.skill_patch_candidate
(
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

    trace_id FixedString(32),
    span_id String DEFAULT '',

    sequence UInt64,
    evidence_sequence Nullable(UInt64),

    schema_name LowCardinality(String),
    schema_version UInt16,

    payload_hash FixedString(64),
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    patch_candidate_id String,
    source_skill_id String,
    source_skill_version UInt32,
    source_skill_execution_ids Array(String),
    target_area LowCardinality(String),
    summary String,
    rationale String,
    proposed_patch_artifact_ref String,
    proposed_patch_hash FixedString(64),
    candidate_status LowCardinality(String),
    created_at DateTime64(3, 'UTC'),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
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
SETTINGS index_granularity = 8192;



CREATE DATABASE IF NOT EXISTS sdar_meta;

CREATE TABLE IF NOT EXISTS sdar_meta.schema_definition
(
    schema_name String,
    schema_version UInt16,
    schema_id String,
    compatibility LowCardinality(String),
    status LowCardinality(String),
    json_schema String CODEC(ZSTD(3)),
    schema_hash FixedString(64),
    effective_from DateTime64(3, 'UTC'),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (schema_name, schema_version);

CREATE TABLE IF NOT EXISTS sdar_meta.evidence_policy
(
    record_type String,
    schema_name String,
    schema_version UInt16,
    delivery_guarantee LowCardinality(String),
    evaluation_role LowCardinality(String),
    sampling_allowed UInt8,
    evidence_sequence_required UInt8,
    retention_class LowCardinality(String),
    target_table String,
    max_payload_bytes UInt64,
    policy_version UInt32,
    effective_from DateTime64(3, 'UTC'),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(policy_version)
ORDER BY (record_type, policy_version);

CREATE TABLE IF NOT EXISTS sdar_meta.data_quality_rule
(
    rule_id String,
    rule_version UInt32,
    rule_scope LowCardinality(String),
    severity LowCardinality(String),
    rule_type LowCardinality(String),
    rule_definition_json String CODEC(ZSTD(3)),
    enabled UInt8,
    effective_from DateTime64(3, 'UTC'),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(rule_version)
ORDER BY (rule_id, rule_version);

CREATE TABLE IF NOT EXISTS sdar_meta.projection_version
(
    projection_name String,
    projection_version UInt32,
    source_schema_versions_json String CODEC(ZSTD(3)),
    status LowCardinality(String),
    effective_from DateTime64(3, 'UTC'),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projection_version)
ORDER BY (projection_name, projection_version);


-- Existing core tables: Skill-aware additive columns
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.plan_record ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.plan_step ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.execution_basis ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.decision_record ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.action_record ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.action_receipt ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.verification_record ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.episode_outcome ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
