-- SDAR ClickHouse Schema V1.1 (fresh-install baseline)
-- Compatibility: ClickHouse 24.8+; recommended 25.3 LTS+
-- All timestamps are UTC DateTime64(3).
-- Complex JSON payloads are stored as String CODEC(ZSTD(3)) for stable replay and compatibility.
-- Run migrations in filename order.

CREATE TABLE IF NOT EXISTS sdar_commander.raw_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.episode_metadata
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

CREATE TABLE IF NOT EXISTS sdar_commander.trigger_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.goal_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.success_criterion
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

CREATE TABLE IF NOT EXISTS sdar_commander.constraint_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.state_snapshot
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

CREATE TABLE IF NOT EXISTS sdar_commander.state_delta
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

CREATE TABLE IF NOT EXISTS sdar_commander.event_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.execution_basis
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

CREATE TABLE IF NOT EXISTS sdar_commander.decision_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.gate_decision
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

CREATE TABLE IF NOT EXISTS sdar_commander.confirmation_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.action_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.receipt_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.verification_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.failure_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.recovery_record
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

CREATE TABLE IF NOT EXISTS sdar_commander.remaining_item
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

CREATE TABLE IF NOT EXISTS sdar_commander.trajectory_step
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

CREATE TABLE IF NOT EXISTS sdar_commander.operational_metric
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

CREATE TABLE IF NOT EXISTS sdar_commander.final_outcome
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

CREATE TABLE IF NOT EXISTS sdar_commander.evidence_index
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

CREATE TABLE IF NOT EXISTS sdar_commander.entity_ref
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

CREATE TABLE IF NOT EXISTS sdar_commander.resource_claim
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

CREATE TABLE IF NOT EXISTS sdar_commander.episode_evidence_bundle_manifest
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

CREATE TABLE IF NOT EXISTS sdar_commander.evaluation_readiness
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

CREATE TABLE IF NOT EXISTS sdar_commander.commander_node_record
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
    node_run_id String,
    graph_run_id String,
    node_name String,
    node_type LowCardinality(String) DEFAULT 'other',
    started_at DateTime64(3, 'UTC'),
    ended_at Nullable(DateTime64(3, 'UTC')),
    node_status LowCardinality(String),
    state_before_id String,
    state_after_id String DEFAULT '',
    state_delta_id String DEFAULT '',
    decision_ids Array(String) DEFAULT [],
    action_ids Array(String) DEFAULT [],
    goto_node String DEFAULT '',
    error_evidence_id String DEFAULT '',
    span_id String DEFAULT '',
    parent_span_id String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, node_run_id);

CREATE TABLE IF NOT EXISTS sdar_commander.route_decision_detail
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
    route_decision_id String,
    request_id String,
    route_mode LowCardinality(String),
    action_type String,
    shortcut_id String DEFAULT '',
    confidence Float32 DEFAULT -1,
    confidence_threshold Float32 DEFAULT -1,
    selected_graph String,
    fallback_reason String DEFAULT '',
    task_points_resolved UInt8,
    decision_id_ref String DEFAULT '',
    basis_id_ref String DEFAULT '',
    basis_version_ref UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_commander.plan_detail
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
    plan_detail_id String,
    basis_id_ref String,
    basis_version_ref UInt32 DEFAULT 0,
    plan_version UInt32,
    planning_mode LowCardinality(String),
    action_list_json String CODEC(ZSTD(3)),
    action_list_report String DEFAULT '',
    path_source LowCardinality(String) DEFAULT '',
    task_points_json String DEFAULT '[]' CODEC(ZSTD(3)),
    mission_id String DEFAULT '',
    validation_status LowCardinality(String),
    error_summary String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_commander.plan_step_detail
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
    basis_id_ref String,
    basis_version_ref UInt32 DEFAULT 0,
    step_id String,
    step_index UInt32,
    capability LowCardinality(String),
    intent String,
    sop_name String DEFAULT '',
    tool_hint String DEFAULT '',
    dependency_step_ids Array(String) DEFAULT [],
    resource_channels Array(String) DEFAULT [],
    step_status LowCardinality(String),
    action_id_ref String DEFAULT '',
    detail_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, basis_id_ref, step_index, record_id);

CREATE TABLE IF NOT EXISTS sdar_commander.sop_run_detail
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
    sop_run_id String,
    sop_name String,
    sop_version String DEFAULT '',
    invoked_by LowCardinality(String),
    basis_id_ref String DEFAULT '',
    basis_version_ref UInt32 DEFAULT 0,
    step_id_ref String DEFAULT '',
    mission_id String DEFAULT '',
    resource_channels Array(String) DEFAULT [],
    input_json String DEFAULT '{}' CODEC(ZSTD(3)),
    sop_status LowCardinality(String),
    started_at DateTime64(3, 'UTC'),
    ended_at Nullable(DateTime64(3, 'UTC')),
    error_code String DEFAULT '',
    result_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_commander.sop_step_detail
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
    sop_run_id String,
    sop_step_id String,
    step_index UInt32,
    step_name String,
    resource_channel LowCardinality(String),
    action_id_ref String DEFAULT '',
    step_status LowCardinality(String),
    started_at DateTime64(3, 'UTC'),
    ended_at Nullable(DateTime64(3, 'UTC')),
    result_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, sop_run_id, step_index, record_id);

CREATE TABLE IF NOT EXISTS sdar_commander.mcp_call_detail
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
    tool_version String DEFAULT '',
    arguments_json String CODEC(ZSTD(3)),
    arguments_hash String,
    mission_id String DEFAULT '',
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

CREATE TABLE IF NOT EXISTS sdar_commander.capability_track_detail
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
    track_record_id String,
    action_id_ref String DEFAULT '',
    step_id_ref String DEFAULT '',
    capability LowCardinality(String),
    track_name LowCardinality(String),
    raw_state String,
    normalized_status LowCardinality(String),
    mission_id String DEFAULT '',
    verify_failed UInt8,
    failure_code String DEFAULT '',
    observed_at DateTime64(3, 'UTC'),
    details_json String DEFAULT '{}' CODEC(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_commander.context_snapshot
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
    context_snapshot_id String,
    node_name String,
    mcp_tools_version String DEFAULT '',
    landmarks_version String DEFAULT '',
    vehicle_state_version String DEFAULT '',
    skills_json String DEFAULT '[]' CODEC(ZSTD(3)),
    sop_catalog_json String DEFAULT '[]' CODEC(ZSTD(3)),
    prompt_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    context_hash String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);

CREATE TABLE IF NOT EXISTS sdar_commander.report_detail
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
    report_id String,
    report_type LowCardinality(String),
    report_text String,
    report_status LowCardinality(String),
    related_outcome_id String DEFAULT '',
    artifact_ref String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, episode_id, occurred_at, sequence, record_id);
