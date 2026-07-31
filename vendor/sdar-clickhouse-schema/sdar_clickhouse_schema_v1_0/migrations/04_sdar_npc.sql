-- SDAR ClickHouse Schema V1.1 (fresh-install baseline)
-- Compatibility: ClickHouse 24.8+; recommended 25.3 LTS+
-- All timestamps are UTC DateTime64(3).
-- Complex JSON payloads are stored as String CODEC(ZSTD(3)) for stable replay and compatibility.
-- Run migrations in filename order.

CREATE TABLE IF NOT EXISTS sdar_npc.raw_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    raw_record_id String,
    agent_type LowCardinality(String),
    record_type LowCardinality(String),
    source_type LowCardinality(String),
    source_id String,
    source_channel String DEFAULT '',
    source_trust_level LowCardinality(String) DEFAULT 'unknown',
    timestamp DateTime64(3, 'UTC'),
    storage_ref String DEFAULT '',
    redaction_json String DEFAULT '{}' CODEC(ZSTD(3)),
    validation_status LowCardinality(String) DEFAULT 'valid',
    validation_errors Array(String) DEFAULT []
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id, payload_sha256)
TTL toDateTime(occurred_at, 'UTC') + INTERVAL 365 DAY DELETE;

CREATE TABLE IF NOT EXISTS sdar_npc.episode_metadata
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    agent_type LowCardinality(String),
    episode_type LowCardinality(String),
    parent_episode_id String DEFAULT '',
    source_run_ids Array(String) DEFAULT [],
    started_at DateTime64(3, 'UTC'),
    ended_at Nullable(DateTime64(3, 'UTC')),
    episode_status LowCardinality(String),
    runtime_environment LowCardinality(String),
    software_version String DEFAULT '',
    model_version String DEFAULT '',
    profile String DEFAULT 'embodied-control',
    adapter LowCardinality(String),
    tags Array(String) DEFAULT [],
    metadata_json String DEFAULT '{}' CODEC(ZSTD(3)),
    record_version UInt32
)
ENGINE = ReplacingMergeTree(record_version)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id);

CREATE TABLE IF NOT EXISTS sdar_npc.trigger_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    trigger_id String,
    trigger_type LowCardinality(String),
    source_type LowCardinality(String),
    source_id String,
    source_channel String DEFAULT '',
    source_trust_level LowCardinality(String) DEFAULT 'unknown',
    received_at DateTime64(3, 'UTC'),
    summary String,
    priority UInt16 DEFAULT 0,
    raw_input_evidence_id String DEFAULT '',
    target_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    state_version String DEFAULT '',
    extensions_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.goal_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    goal_id String,
    goal_version UInt32,
    title String,
    description String,
    origin_trigger_id String,
    target_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    goal_status LowCardinality(String),
    created_at DateTime64(3, 'UTC'),
    created_by_type LowCardinality(String) DEFAULT '',
    created_by_id String DEFAULT '',
    created_by_channel String DEFAULT '',
    supersedes_goal_version UInt32 DEFAULT 0,
    assumptions Array(String) DEFAULT [],
    extensions_json String DEFAULT '{}' CODEC(ZSTD(3)),
    record_version UInt32
)
ENGINE = ReplacingMergeTree(record_version)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, goal_id, goal_version);

CREATE TABLE IF NOT EXISTS sdar_npc.success_criterion
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    goal_id String,
    goal_version UInt32,
    criterion_id String,
    description String,
    criterion_type LowCardinality(String),
    expected_json String DEFAULT 'null' CODEC(ZSTD(3)),
    comparator LowCardinality(String),
    actual_source_path String DEFAULT '',
    critical UInt8,
    deadline_at Nullable(DateTime64(3, 'UTC')),
    stability_window_ms UInt64 DEFAULT 0,
    evidence_requirements Array(String) DEFAULT []
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, goal_id, goal_version, criterion_id);

CREATE TABLE IF NOT EXISTS sdar_npc.constraint_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    goal_id String,
    goal_version UInt32,
    constraint_id String,
    category LowCardinality(String),
    description String,
    severity LowCardinality(String),
    applies_to Array(String) DEFAULT [],
    source_evidence_id String DEFAULT '',
    violation_policy LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, goal_id, goal_version, constraint_id);

CREATE TABLE IF NOT EXISTS sdar_npc.state_snapshot
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    state_id String,
    agent_type LowCardinality(String),
    state_version UInt64,
    quality_observed_at DateTime64(3, 'UTC'),
    quality_recorded_at DateTime64(3, 'UTC'),
    valid_until Nullable(DateTime64(3, 'UTC')),
    freshness_ms Nullable(UInt64) DEFAULT NULL,
    confidence Float32 DEFAULT -1,
    quality_status LowCardinality(String),
    conflict_refs Array(String) DEFAULT [],
    source_type LowCardinality(String),
    source_id String,
    source_channel String DEFAULT '',
    source_trust_level LowCardinality(String) DEFAULT 'unknown',
    episode_status LowCardinality(String),
    goal_id String DEFAULT '',
    goal_version UInt32 DEFAULT 0,
    active_execution_basis_id String DEFAULT '',
    active_execution_basis_version UInt32 DEFAULT 0,
    current_step_id String DEFAULT '',
    current_action_id String DEFAULT '',
    active_controller String DEFAULT '',
    control_mode LowCardinality(String) DEFAULT 'unknown',
    entities_json String DEFAULT '[]' CODEC(ZSTD(3)),
    pending_items_json String DEFAULT '[]' CODEC(ZSTD(3)),
    domain_schema_name String,
    domain_schema_version String,
    domain_state_json String CODEC(ZSTD(3)),
    extensions_json String DEFAULT '{}' CODEC(ZSTD(3)),
    state_hash String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, state_version, state_id);

CREATE TABLE IF NOT EXISTS sdar_npc.state_delta
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    state_delta_id String,
    from_state_id String,
    to_state_id String,
    from_state_version UInt64,
    to_state_version UInt64,
    operations_json String CODEC(ZSTD(3)),
    reason_event_id String DEFAULT '',
    source_decision_id String DEFAULT '',
    source_action_id String DEFAULT '',
    recorded_at DateTime64(3, 'UTC'),
    invariant_checks_json String DEFAULT '[]' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.event_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    event_id String,
    event_type String,
    source_type LowCardinality(String),
    source_id String,
    source_channel String DEFAULT '',
    source_trust_level LowCardinality(String) DEFAULT 'unknown',
    causation_id String DEFAULT '',
    related_action_id String DEFAULT '',
    related_decision_id String DEFAULT '',
    state_version_before UInt64 DEFAULT 0,
    state_version_after UInt64 DEFAULT 0,
    payload_evidence_id String DEFAULT '',
    severity LowCardinality(String) DEFAULT 'info',
    summary String DEFAULT '',
    extensions_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.execution_basis
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    basis_id String,
    basis_type LowCardinality(String),
    basis_version UInt32,
    basis_status LowCardinality(String),
    goal_id String,
    goal_version UInt32 DEFAULT 0,
    name String DEFAULT '',
    description String DEFAULT '',
    preconditions Array(String) DEFAULT [],
    steps_json String DEFAULT '[]' CODEC(ZSTD(3)),
    policy_ref String DEFAULT '',
    branch_path String DEFAULT '',
    utility_scores Map(String, Float64) DEFAULT map(),
    resource_claims_json String DEFAULT '[]' CODEC(ZSTD(3)),
    success_criterion_refs Array(String) DEFAULT [],
    created_by_type LowCardinality(String),
    created_by_id String,
    created_by_channel String DEFAULT '',
    created_at DateTime64(3, 'UTC'),
    approved_by_type LowCardinality(String) DEFAULT '',
    approved_by_id String DEFAULT '',
    approval_evidence_id String DEFAULT '',
    supersedes_basis_id String DEFAULT '',
    supersedes_basis_version UInt32 DEFAULT 0,
    extensions_json String DEFAULT '{}' CODEC(ZSTD(3)),
    record_version UInt32
)
ENGINE = ReplacingMergeTree(record_version)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, basis_id, basis_version);

CREATE TABLE IF NOT EXISTS sdar_npc.decision_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    decision_id String,
    decision_type LowCardinality(String),
    title String,
    conclusion String,
    decision_status LowCardinality(String),
    based_on_state_id String,
    execution_basis_id String DEFAULT '',
    execution_basis_version UInt32 DEFAULT 0,
    candidate_options_json String DEFAULT '[]' CODEC(ZSTD(3)),
    selected_option_id String DEFAULT '',
    rationale_summary String DEFAULT '',
    decision_evidence_refs Array(String) DEFAULT [],
    risk_assessment_json String DEFAULT '{}' CODEC(ZSTD(3)),
    expected_effects Array(String) DEFAULT [],
    created_at DateTime64(3, 'UTC'),
    created_by_type LowCardinality(String),
    created_by_id String,
    extensions_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.gate_decision
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    gate_decision_id String,
    gate_action_id String,
    gate_type LowCardinality(String),
    gate_result LowCardinality(String),
    based_on_state_id String,
    policy_refs Array(String) DEFAULT [],
    reasons Array(String) DEFAULT [],
    gate_evidence_refs Array(String) DEFAULT [],
    evaluated_at DateTime64(3, 'UTC'),
    expires_at Nullable(DateTime64(3, 'UTC'))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.confirmation_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    confirmation_id String,
    confirmation_action_id String,
    requested_at DateTime64(3, 'UTC'),
    requested_from_type LowCardinality(String),
    requested_from_id String,
    requested_from_channel String DEFAULT '',
    confirmation_status LowCardinality(String),
    decided_at Nullable(DateTime64(3, 'UTC')),
    decided_by_type LowCardinality(String) DEFAULT '',
    decided_by_id String DEFAULT '',
    scope_json String CODEC(ZSTD(3)),
    valid_from Nullable(DateTime64(3, 'UTC')),
    valid_until Nullable(DateTime64(3, 'UTC')),
    invalidation_conditions Array(String) DEFAULT [],
    confirmation_evidence_refs Array(String) DEFAULT [],
    comment String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.action_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    action_id String,
    basis_id String,
    basis_version UInt32,
    step_id String DEFAULT '',
    decision_id String,
    action_type LowCardinality(String),
    capability String DEFAULT '',
    target_entity_type String,
    target_entity_id String,
    target_display_name String DEFAULT '',
    target_namespace String DEFAULT '',
    target_version String DEFAULT '',
    target_attributes_json String DEFAULT '{}' CODEC(ZSTD(3)),
    input_summary String,
    input_payload_evidence_id String DEFAULT '',
    input_hash String,
    risk_level LowCardinality(String),
    gate_decision_refs Array(String) DEFAULT [],
    confirmation_ref String DEFAULT '',
    idempotency_key String,
    execution_status LowCardinality(String),
    side_effect UInt8,
    controller_ref String DEFAULT '',
    resource_claims_json String DEFAULT '[]' CODEC(ZSTD(3)),
    attempt UInt16 DEFAULT 1,
    retry_of_action_id String DEFAULT '',
    dispatched_at Nullable(DateTime64(3, 'UTC')),
    started_at Nullable(DateTime64(3, 'UTC')),
    ended_at Nullable(DateTime64(3, 'UTC')),
    receipt_refs Array(String) DEFAULT [],
    before_state_id String,
    after_state_id String DEFAULT '',
    extensions_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.receipt_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    receipt_id String,
    receipt_action_id String,
    provider_type LowCardinality(String),
    provider_id String,
    provider_channel String DEFAULT '',
    provider_trust_level LowCardinality(String) DEFAULT 'unknown',
    provider_request_id String DEFAULT '',
    received_at DateTime64(3, 'UTC'),
    transport_status LowCardinality(String),
    acceptance_status LowCardinality(String),
    execution_status LowCardinality(String),
    output_summary String DEFAULT '',
    raw_response_evidence_id String DEFAULT '',
    observed_state_evidence_id String DEFAULT '',
    error_json String DEFAULT '{}' CODEC(ZSTD(3)),
    metrics_json String DEFAULT '[]' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.verification_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    verification_id String,
    criterion_id String,
    verification_action_id String DEFAULT '',
    verification_state_id String DEFAULT '',
    verification_type LowCardinality(String),
    expected_json String CODEC(ZSTD(3)),
    actual_json String CODEC(ZSTD(3)),
    comparator LowCardinality(String),
    verification_status LowCardinality(String),
    critical UInt8,
    verification_evidence_refs Array(String) DEFAULT [],
    verified_at DateTime64(3, 'UTC'),
    verifier_type LowCardinality(String),
    verifier_id String,
    verifier_channel String DEFAULT '',
    stability_window_ms UInt64 DEFAULT 0,
    notes String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.failure_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    failure_id String,
    related_action_id String DEFAULT '',
    related_decision_id String DEFAULT '',
    failure_category LowCardinality(String),
    failure_severity LowCardinality(String),
    detected_at DateTime64(3, 'UTC'),
    failure_state_id String,
    error_evidence_id String DEFAULT '',
    retryable UInt8,
    side_effect_risk LowCardinality(String),
    impact String DEFAULT '',
    failure_status LowCardinality(String),
    failure_evidence_refs Array(String) DEFAULT []
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.recovery_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    recovery_id String,
    failure_id String,
    strategy LowCardinality(String),
    recovery_decision_id String,
    new_basis_id String DEFAULT '',
    new_basis_version UInt32 DEFAULT 0,
    recovery_action_ids Array(String) DEFAULT [],
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    recovery_status LowCardinality(String),
    result_verification_id String DEFAULT '',
    residual_risk_json String DEFAULT '{}' CODEC(ZSTD(3)),
    notes String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.remaining_item
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    outcome_id String,
    item_id String,
    description String,
    item_status LowCardinality(String),
    owner_type LowCardinality(String),
    owner_id String,
    owner_channel String DEFAULT '',
    due_at Nullable(DateTime64(3, 'UTC')),
    risk_level LowCardinality(String) DEFAULT 'none',
    item_evidence_refs Array(String) DEFAULT []
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, outcome_id, item_id);

CREATE TABLE IF NOT EXISTS sdar_npc.trajectory_step
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    trajectory_step_id String,
    from_state_id String,
    from_state_version UInt64,
    trigger_event_id String,
    trajectory_decision_id String DEFAULT '',
    trajectory_action_id String DEFAULT '',
    receipt_ids Array(String) DEFAULT [],
    state_delta_id String,
    to_state_id String,
    to_state_version UInt64,
    invariant_checks_json String DEFAULT '[]' CODEC(ZSTD(3)),
    trajectory_timestamp DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.operational_metric
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    metric_id String,
    metric_name LowCardinality(String),
    metric_value Float64,
    unit String DEFAULT '',
    threshold Nullable(Float64),
    metric_status LowCardinality(String) DEFAULT 'unknown',
    collected_at DateTime64(3, 'UTC'),
    source_evidence_id String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.final_outcome
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    outcome_id String,
    outcome_status LowCardinality(String),
    goal_id String,
    goal_version UInt32,
    final_state_id String,
    completed_criterion_refs Array(String) DEFAULT [],
    failed_criterion_refs Array(String) DEFAULT [],
    pending_criterion_refs Array(String) DEFAULT [],
    remaining_items_json String DEFAULT '[]' CODEC(ZSTD(3)),
    residual_risks_json String DEFAULT '[]' CODEC(ZSTD(3)),
    summary String,
    reported_at DateTime64(3, 'UTC'),
    report_evidence_id String DEFAULT '',
    record_version UInt32
)
ENGINE = ReplacingMergeTree(record_version)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, outcome_id);

CREATE TABLE IF NOT EXISTS sdar_npc.evidence_index
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    evidence_id String,
    evidence_type String,
    owner_record_type LowCardinality(String),
    owner_record_id String,
    relation LowCardinality(String) DEFAULT 'related',
    schema_ref String DEFAULT '',
    storage_ref String DEFAULT '',
    evidence_payload_hash String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, evidence_id, owner_record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.entity_ref
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    owner_record_type LowCardinality(String),
    owner_record_id String,
    role LowCardinality(String),
    entity_type String,
    entity_id String,
    display_name String DEFAULT '',
    namespace String DEFAULT '',
    entity_version String DEFAULT '',
    attributes_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, owner_record_id, role, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS sdar_npc.resource_claim
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    owner_record_type LowCardinality(String),
    owner_record_id String,
    resource_type LowCardinality(String),
    resource_id String,
    claim_mode LowCardinality(String),
    acquired_at Nullable(DateTime64(3, 'UTC')),
    released_at Nullable(DateTime64(3, 'UTC'))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, resource_type, resource_id, occurred_at, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.episode_evidence_bundle_manifest
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    bundle_id String,
    bundle_schema_version String,
    trigger_id String,
    goal_ids Array(String),
    initial_state_id String,
    final_state_id String,
    outcome_id String,
    record_counts Map(String, UInt64),
    first_sequence UInt64,
    last_sequence UInt64,
    sequence_complete UInt8,
    bundle_hash String,
    build_status LowCardinality(String),
    validation_errors Array(String) DEFAULT [],
    built_at DateTime64(3, 'UTC'),
    record_version UInt32
)
ENGINE = ReplacingMergeTree(record_version)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, bundle_id);

CREATE TABLE IF NOT EXISTS sdar_npc.evaluation_readiness
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    readiness_id String,
    readiness_status LowCardinality(String),
    collection_profile_name LowCardinality(String),
    evidence_level LowCardinality(String),
    evidence_completeness_json String CODEC(ZSTD(3)),
    sequence_complete UInt8,
    state_trajectory_complete UInt8,
    action_receipt_complete UInt8,
    verification_complete UInt8,
    missing_evidence_types Array(String) DEFAULT [],
    quality_issue_ids Array(String) DEFAULT [],
    checked_at DateTime64(3, 'UTC'),
    record_version UInt32
)
ENGINE = ReplacingMergeTree(record_version)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, readiness_id);

CREATE TABLE IF NOT EXISTS sdar_npc.minimal_runtime_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    minimal_schema_version String,
    record_type LowCardinality(String),
    case_id String DEFAULT '',
    mission_id String DEFAULT '',
    tick_id String DEFAULT '',
    scenario_type LowCardinality(String),
    runtime_environment LowCardinality(String),
    started_at DateTime64(3, 'UTC'),
    ended_at DateTime64(3, 'UTC'),
    trigger_type LowCardinality(String),
    trigger_source String,
    trigger_name String,
    trigger_priority UInt16 DEFAULT 0,
    trigger_summary String DEFAULT '',
    decision_type LowCardinality(String),
    priority_level LowCardinality(String),
    basis_type LowCardinality(String),
    selected_branch String,
    selected_intent LowCardinality(String),
    decision_status LowCardinality(String),
    decision_reason_code String DEFAULT '',
    action_type LowCardinality(String),
    tool_name String DEFAULT '',
    target String DEFAULT '',
    execution_status LowCardinality(String),
    side_effect UInt8,
    attempt_count UInt16,
    result_code String DEFAULT '',
    action_started_at Nullable(DateTime64(3, 'UTC')),
    action_ended_at Nullable(DateTime64(3, 'UTC')),
    previous_mode LowCardinality(String) DEFAULT '',
    current_mode LowCardinality(String),
    control_owner String,
    preempted_mission UInt8,
    approval_required UInt8,
    approval_status LowCardinality(String),
    approval_at Nullable(DateTime64(3, 'UTC')),
    outcome_status LowCardinality(String),
    outcome_reason_code String,
    outcome_summary String DEFAULT '',
    error_present UInt8,
    error_code String DEFAULT '',
    error_category LowCardinality(String) DEFAULT '',
    error_retryable UInt8 DEFAULT 0,
    error_message_summary String DEFAULT '',
    decision_latency_ms UInt64 DEFAULT 0,
    dispatch_latency_ms UInt64 DEFAULT 0,
    total_duration_ms UInt64 DEFAULT 0,
    tags Array(String) DEFAULT [],
    metadata Map(String, String) DEFAULT map()
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.npc_tick_record
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    tick_id String,
    started_at DateTime64(3, 'UTC'),
    ended_at Nullable(DateTime64(3, 'UTC')),
    snapshot_id String,
    threat_evaluation_json String DEFAULT '{}' CODEC(ZSTD(3)),
    utility_evaluation Map(String, Float64) DEFAULT map(),
    active_branch String,
    decision_id_ref String DEFAULT '',
    action_ids Array(String) DEFAULT [],
    state_after_id String DEFAULT '',
    reset_applied UInt8 DEFAULT 0,
    overrun_ms UInt64 DEFAULT 0,
    tick_status LowCardinality(String),
    notes String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, tick_id);

CREATE TABLE IF NOT EXISTS sdar_npc.blackboard_snapshot_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    snapshot_id String,
    tick_id String DEFAULT '',
    blackboard_version UInt64,
    snapshot_kind LowCardinality(String),
    self_state_json String CODEC(ZSTD(3)),
    perception_state_json String CODEC(ZSTD(3)),
    threat_state_json String DEFAULT '{}' CODEC(ZSTD(3)),
    memory_state_json String DEFAULT '{}' CODEC(ZSTD(3)),
    tactical_decision_state_json String CODEC(ZSTD(3)),
    mission_state_json String CODEC(ZSTD(3)),
    command_state_json String DEFAULT '{}' CODEC(ZSTD(3)),
    move_task_state_json String DEFAULT '{}' CODEC(ZSTD(3)),
    hmi_approval_state_json String DEFAULT '{}' CODEC(ZSTD(3)),
    route_obstacle_state_json String DEFAULT '{}' CODEC(ZSTD(3)),
    communication_state_json String CODEC(ZSTD(3)),
    snapshot_hash String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, blackboard_version, snapshot_id);

CREATE TABLE IF NOT EXISTS sdar_npc.threat_evaluation_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    threat_evaluation_id String,
    tick_id String,
    snapshot_id String,
    target_id String DEFAULT '',
    threat_level LowCardinality(String),
    threat_score Float64,
    features Map(String, Float64) DEFAULT map(),
    evaluator_version String,
    selected UInt8,
    summary String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.utility_score_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    utility_record_id String,
    tick_id String,
    candidate_intent LowCardinality(String),
    score Float64,
    rank UInt16,
    selected UInt8,
    target_id String DEFAULT '',
    feature_values Map(String, Float64) DEFAULT map(),
    evaluator_version String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, tick_id, rank, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.bt_transition_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    bt_transition_id String,
    tick_id String,
    tree_name String,
    node_path String,
    node_type LowCardinality(String),
    priority_level LowCardinality(String),
    previous_status LowCardinality(String),
    current_status LowCardinality(String),
    selected UInt8,
    branch_changed UInt8,
    preempted_lower_branch UInt8,
    decision_id_ref String DEFAULT '',
    action_id_ref String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.mission_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    mission_record_id String,
    mission_id String,
    mission_version UInt32,
    mission_status LowCardinality(String),
    natural_language_task String DEFAULT '',
    display_plan_json String DEFAULT '[]' CODEC(ZSTD(3)),
    tool_calls_json String DEFAULT '[]' CODEC(ZSTD(3)),
    current_tool_call_index UInt32 DEFAULT 0,
    planning_model String DEFAULT '',
    xodr_route_ref String DEFAULT '',
    basis_id_ref String DEFAULT '',
    basis_version_ref UInt32 DEFAULT 0,
    record_version UInt32
)
ENGINE = ReplacingMergeTree(record_version)
PARTITION BY cityHash64(episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, mission_id, mission_version);

CREATE TABLE IF NOT EXISTS sdar_npc.mission_tool_call_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    mission_id String,
    mission_version UInt32,
    tool_call_index UInt32,
    tool_call_id String,
    tool_name String,
    capability LowCardinality(String),
    arguments_json String CODEC(ZSTD(3)),
    arguments_hash String,
    schema_adapted UInt8,
    injected_mission_id String DEFAULT '',
    approval_required UInt8,
    approval_id String DEFAULT '',
    action_id_ref String DEFAULT '',
    call_status LowCardinality(String),
    advanced_to_next UInt8,
    physical_completion_verified UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, mission_id, mission_version, tool_call_index, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.mcp_call_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    mcp_call_id String,
    action_id_ref String,
    server_id String,
    tool_name String,
    arguments_json String CODEC(ZSTD(3)),
    arguments_hash String,
    transport_status LowCardinality(String),
    acceptance_status LowCardinality(String),
    execution_status LowCardinality(String),
    latency_ms UInt64 DEFAULT 0,
    response_json String DEFAULT '{}' CODEC(ZSTD(3)),
    error_code String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.hmi_approval_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    approval_id String,
    target_id String,
    action_scope LowCardinality(String),
    requested_action String,
    approval_status LowCardinality(String),
    requested_at DateTime64(3, 'UTC'),
    responded_at Nullable(DateTime64(3, 'UTC')),
    approved_by String DEFAULT '',
    valid_from Nullable(DateTime64(3, 'UTC')),
    expires_at Nullable(DateTime64(3, 'UTC')),
    invalidated_at Nullable(DateTime64(3, 'UTC')),
    invalidation_reason String DEFAULT '',
    state_version_at_approval UInt64 DEFAULT 0,
    evidence_refs Array(String) DEFAULT []
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.operator_command_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    operator_command_id String,
    command_type LowCardinality(String),
    command_text String DEFAULT '',
    operator_id String,
    priority UInt16,
    received_at DateTime64(3, 'UTC'),
    acknowledged_at Nullable(DateTime64(3, 'UTC')),
    command_status LowCardinality(String),
    related_action_id String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_npc.preemption_detail
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    record_id String,
    episode_id String,
    agent_id String,
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',
    correlation_id String DEFAULT '',
    sequence UInt64 DEFAULT 0,
    schema_name LowCardinality(String),
    schema_version String,
    collection_profile LowCardinality(String),
    payload_json String CODEC(ZSTD(3)),
    payload_hash String,
    payload_sha256 FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    preemption_id String,
    tick_id String DEFAULT '',
    trigger_type LowCardinality(String),
    preempted_branch String,
    selected_branch String,
    selected_intent String,
    preempted_action_id String DEFAULT '',
    selected_action_id String DEFAULT '',
    required_deadline_ms UInt64 DEFAULT 0,
    actual_latency_ms UInt64 DEFAULT 0,
    stop_confirmed UInt8,
    recovery_strategy LowCardinality(String) DEFAULT '',
    recovery_status LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);
