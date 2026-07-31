-- SDAR ClickHouse Schema 1.2.0 / Runtime v1.3 Skill-aware additive migration.
-- Source: SDAR v1.3 Skill-aware Frozen Bundle, frozen 2026-07-17.
-- This migration preserves the published 00..09 baseline and adapts the frozen
-- DDL to the existing six-database, multi-tenant model.
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



-- schema_definition, data_quality_rule and projection_version already exist in
-- sdar_meta with the project-wide tenancy and lifecycle contract. Only the new
-- record-level evidence policy needs a physical table here.
CREATE TABLE IF NOT EXISTS sdar_meta.evidence_policy
(
    tenant_id String DEFAULT '__global__',
    project_id String DEFAULT '__global__',
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
    status LowCardinality(String) DEFAULT 'active',
    effective_from DateTime64(3, 'UTC'),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, record_type, policy_version);


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

-- Canonical sdar.evidence/v1 envelope fields. Legacy delivery_class,
-- required_for_evaluation and evidence_refs remain readable during migration.
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS evidence_family LowCardinality(String) DEFAULT 'sdar.evidence/v1';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS record_type LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS delivery_guarantee LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS evaluation_role LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS usage_spec_version String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS usage_spec_source LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS recursion_depth UInt16 DEFAULT 0;
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS remaining_recursion_budget UInt16 DEFAULT 0;
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS aggregate_type LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS aggregate_id String DEFAULT '';
ALTER TABLE sdar_core.raw_envelope ADD COLUMN IF NOT EXISTS evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3));

ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS evidence_family LowCardinality(String) DEFAULT 'sdar.evidence/v1';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS record_type LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS delivery_guarantee LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS evaluation_role LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS skill_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS skill_version UInt32 DEFAULT 0;
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS root_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS parent_skill_execution_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS usage_spec_version String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS usage_spec_hash String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS usage_spec_source LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS skill_execution_mode LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS composition_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS capability_slot_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS recursion_depth UInt16 DEFAULT 0;
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS remaining_recursion_budget UInt16 DEFAULT 0;
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS failure_policy LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS plan_compliance_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS aggregate_type LowCardinality(String) DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS aggregate_id String DEFAULT '';
ALTER TABLE sdar_core.evidence_index ADD COLUMN IF NOT EXISTS evidence_refs_json String DEFAULT '[]' CODEC(ZSTD(3));

-- Evaluation readiness reports evidence completeness only; it is not a score.
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_usage_snapshot_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_candidate_trace_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_applicability_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_context_resolution_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_selection_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_mode_selection_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_composition_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_capability_slot_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_plan_compliance_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_execution_tree_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_failure_propagation_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS skill_evidence_requirement_complete UInt8 DEFAULT 0;
ALTER TABLE sdar_core.evaluation_readiness ADD COLUMN IF NOT EXISTS unresolved_skill_execution_count UInt64 DEFAULT 0;

-- Frozen v1.3 record-level delivery and evaluation policy. These rows are
-- global defaults; tenant/project overrides use a higher policy_version.
INSERT INTO sdar_meta.evidence_policy
(
    record_type, schema_name, schema_version, delivery_guarantee,
    evaluation_role, sampling_allowed, evidence_sequence_required,
    retention_class, target_table, max_payload_bytes, policy_version,
    effective_from
)
VALUES
('skill_usage_snapshot', 'sdar.skill-usage-snapshot', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_usage_snapshot', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_candidate_record', 'sdar.skill-candidate-record', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_candidate_record', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_applicability_record', 'sdar.skill-applicability-record', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_applicability_record', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_context_resolution', 'sdar.skill-context-resolution', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_context_resolution', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_selection_record', 'sdar.skill-selection-record', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_selection_record', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_mode_selection', 'sdar.skill-mode-selection', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_mode_selection', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_composition_record', 'sdar.skill-composition-record', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_composition_record', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_composition_edge', 'sdar.skill-composition-edge', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_composition_edge', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_capability_slot_resolution', 'sdar.skill-capability-slot-resolution', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_capability_slot_resolution', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_interpretation_record', 'sdar.skill-interpretation-record', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_interpretation_record', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_procedure_compilation', 'sdar.skill-procedure-compilation', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_procedure_compilation', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_plan_compliance', 'sdar.skill-plan-compliance', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_plan_compliance', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_execution_record', 'sdar.skill-execution-record', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_execution_record', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_execution_relation', 'sdar.skill-execution-relation', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_execution_relation', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_failure_propagation', 'sdar.skill-failure-propagation', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_failure_propagation', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_evidence_requirement', 'sdar.skill-evidence-requirement', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.skill_evidence_requirement', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('skill_patch_candidate', 'sdar.skill-patch-candidate', 1, 'transactional', 'supporting', 0, 1, 'standard', 'sdar_core.skill_patch_candidate', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
('evaluation_readiness', 'sdar.evaluation-readiness', 1, 'transactional', 'required', 0, 1, 'audit', 'sdar_core.evaluation_readiness', 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z'));

-- v1.3 post-migration assertions (09 retains the published v1.1 baseline checks).
SELECT throwIf(countIf(engine != 'View') != 20, 'SMOKE v1.3: sdar_meta physical table count mismatch')
FROM system.tables WHERE database = 'sdar_meta';

SELECT throwIf(countIf(engine != 'View') != 61, 'SMOKE v1.3: sdar_core physical table count mismatch')
FROM system.tables WHERE database = 'sdar_core';

SELECT throwIf(count() != 18, 'SMOKE v1.3: frozen evidence policy count mismatch')
FROM sdar_meta.evidence_policy FINAL
WHERE tenant_id = '__global__' AND project_id = '__global__' AND policy_version = 1 AND status = 'active';

SELECT throwIf(
    countIf(delivery_guarantee != 'transactional') != 0
    OR countIf(sampling_allowed != 0) != 0
    OR countIf(evidence_sequence_required != 1) != 0
    OR countIf(record_type != 'skill_patch_candidate' AND evaluation_role != 'required') != 0
    OR countIf(record_type = 'skill_patch_candidate' AND evaluation_role != 'supporting') != 0,
    'SMOKE v1.3: evidence policy violates frozen delivery/evaluation rules'
)
FROM sdar_meta.evidence_policy FINAL
WHERE tenant_id = '__global__' AND project_id = '__global__' AND policy_version = 1 AND status = 'active';
