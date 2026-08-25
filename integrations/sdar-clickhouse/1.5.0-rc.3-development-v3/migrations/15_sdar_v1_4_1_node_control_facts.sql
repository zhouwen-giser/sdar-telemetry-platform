-- SDAR ClickHouse Schema 1.4.1-rc.1 / complete Node Control governance facts.
-- These are analytical projections. Control PostgreSQL remains authoritative.

CREATE TABLE IF NOT EXISTS sdar_core.node_profile_revision_fact
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
    node_id String,
    profile_revision UInt64,
    profile_status LowCardinality(String),
    display_name String,
    node_type LowCardinality(String),
    public_url String DEFAULT '',
    runtime_endpoint_ref String DEFAULT '',
    profile_hash FixedString(64),
    etag String DEFAULT '',
    published_at Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, profile_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_health_observation_fact
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
    node_id String,
    health_status LowCardinality(String),
    readiness_status LowCardinality(String),
    component_status_json String CODEC(ZSTD(3)),
    reason_codes Array(String),
    observed_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, observed_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.node_configuration_revision_fact
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
    node_id String,
    configuration_id String,
    configuration_revision UInt64,
    configuration_status LowCardinality(String),
    apply_mode LowCardinality(String),
    desired_hash FixedString(64),
    definition_artifact_ref String DEFAULT '',
    published_at Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, configuration_id, configuration_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_configuration_apply_ack_fact
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
    node_id String,
    configuration_id String,
    requested_revision UInt64,
    applied_revision UInt64 DEFAULT 0,
    acknowledged_revision UInt64 DEFAULT 0,
    ack_status LowCardinality(String),
    error_code String DEFAULT '',
    runtime_observed_hash String DEFAULT '',
    acknowledged_at Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, configuration_id, requested_revision, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.node_configuration_lkg_transition_fact
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
    node_id String,
    configuration_id String,
    from_revision UInt64 DEFAULT 0,
    to_revision UInt64,
    transition_reason LowCardinality(String),
    transition_status LowCardinality(String),
    rollback_operation_id String DEFAULT '',
    transitioned_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, configuration_id, to_revision, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.node_llm_provider_revision_fact
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
    node_id String,
    provider_id String,
    provider_revision UInt64,
    provider_status LowCardinality(String),
    endpoint_ref String,
    credential_ref_hash String DEFAULT '',
    configuration_hash FixedString(64),
    effective_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, provider_id, provider_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_model_route_revision_fact
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
    node_id String,
    route_id String,
    route_revision UInt64,
    route_status LowCardinality(String),
    stage LowCardinality(String),
    provider_id String,
    model_id String,
    fallback_route_refs Array(String),
    route_hash FixedString(64),
    effective_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, route_id, route_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_smpp_source_revision_fact
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
    node_id String,
    source_id String,
    smpp_source_revision UInt64,
    source_status LowCardinality(String),
    endpoint_ref String,
    source_hash FixedString(64),
    valid_until Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, source_id, smpp_source_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_mcp_provider_binding_revision_fact
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
    node_id String,
    provider_binding_id String,
    binding_revision UInt64,
    provider_id String,
    server_id String,
    binding_status LowCardinality(String),
    catalog_hash String DEFAULT '',
    policy_hash String DEFAULT '',
    drift_status LowCardinality(String),
    valid_until Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, provider_binding_id, binding_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_skill_governance_revision_fact
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
    node_id String,
    skill_id String,
    skill_version UInt64,
    governance_operation LowCardinality(String),
    lifecycle_status LowCardinality(String),
    artifact_ref String,
    content_hash FixedString(64),
    operation_id String,
    actor_id String,
    effective_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, skill_id, skill_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_plan_template_governance_revision_fact
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
    node_id String,
    template_id String,
    template_version UInt64,
    governance_operation LowCardinality(String),
    lifecycle_status LowCardinality(String),
    artifact_ref String,
    content_hash FixedString(64),
    operation_id String,
    actor_id String,
    effective_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, template_id, template_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_management_operation_fact
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
    node_id String,
    operation_id String,
    operation_type String,
    target_type String,
    target_id String,
    target_revision UInt64 DEFAULT 0,
    actor_id String,
    reason String,
    operation_status LowCardinality(String),
    input_hash FixedString(64),
    result_json String DEFAULT '{}' CODEC(ZSTD(3)),
    error_code String DEFAULT '',
    completed_at Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, operation_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.node_audit_event_fact
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
    node_id String,
    audit_id String,
    operation_id String DEFAULT '',
    actor_id String,
    actor_roles Array(String),
    action String,
    target_type String,
    target_id String,
    decision LowCardinality(String),
    reason_code String DEFAULT '',
    audit_payload_json String CODEC(ZSTD(3)),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, audit_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.node_event_fact
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
    node_id String,
    node_event_id String,
    event_type String,
    aggregate_type String,
    aggregate_id String,
    aggregate_revision UInt64,
    actor_id String DEFAULT '',
    data_classification LowCardinality(String),
    event_payload_json String CODEC(ZSTD(3)),
    control_recorded_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, aggregate_type, aggregate_id, aggregate_revision, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.node_telemetry_export_configuration_fact
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
    node_id String,
    export_id String,
    export_revision UInt64,
    export_status LowCardinality(String),
    endpoint_ref String,
    source_id String,
    included_families Array(String),
    batch_policy_json String CODEC(ZSTD(3)),
    retry_policy_json String CODEC(ZSTD(3)),
    outbox_policy_json String CODEC(ZSTD(3)),
    redaction_profile String,
    artifact_mode LowCardinality(String),
    configuration_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, node_id, export_id, export_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.node_telemetry_export_delivery_fact
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
    node_id String,
    export_id String,
    export_revision UInt64,
    batch_id String,
    first_sequence UInt64,
    last_sequence UInt64,
    record_count UInt32,
    batch_hash FixedString(64),
    delivery_status LowCardinality(String),
    delivery_attempt UInt32,
    error_code String DEFAULT '',
    delivered_at Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, export_id, first_sequence, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.node_telemetry_export_ack_fact
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
    node_id String,
    export_id String,
    export_revision UInt64,
    batch_id String,
    acknowledged_sequence UInt64,
    previous_acknowledged_sequence UInt64,
    ack_valid UInt8,
    ack_error_code String DEFAULT '',
    acknowledged_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, node_id, export_id, acknowledged_sequence, record_id)
SETTINGS index_granularity = 8192;

CREATE VIEW IF NOT EXISTS sdar_core.v_node_profile_current AS
SELECT * FROM sdar_core.node_profile_revision_fact
ORDER BY profile_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, node_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_node_health_current AS
SELECT * FROM sdar_core.node_health_observation_fact
ORDER BY observed_at DESC, ingested_at DESC
LIMIT 1 BY tenant_id, project_id, node_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_node_configuration_current AS
SELECT * FROM sdar_core.node_configuration_revision_fact
ORDER BY configuration_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, node_id, configuration_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_node_configuration_apply_state AS
SELECT r.tenant_id,r.project_id,r.environment,r.node_id,r.configuration_id,r.configuration_revision,
       a.applied_revision,a.acknowledged_revision,a.ack_status,a.error_code,a.acknowledged_at
FROM sdar_core.v_node_configuration_current AS r
LEFT JOIN sdar_core.node_configuration_apply_ack_fact AS a
 ON r.tenant_id=a.tenant_id AND r.project_id=a.project_id AND r.node_id=a.node_id
 AND r.configuration_id=a.configuration_id AND r.configuration_revision=a.requested_revision;

CREATE VIEW IF NOT EXISTS sdar_core.v_node_event_sequence_gap AS
SELECT tenant_id,project_id,node_id,aggregate_type,aggregate_id,
       min(aggregate_revision) AS min_revision,max(aggregate_revision) AS max_revision,
       countDistinct(aggregate_revision) AS revision_count
FROM sdar_core.node_event_fact
GROUP BY tenant_id,project_id,node_id,aggregate_type,aggregate_id
HAVING max_revision - min_revision + 1 != revision_count;

CREATE VIEW IF NOT EXISTS sdar_core.v_node_telemetry_delivery_current AS
SELECT * FROM sdar_core.node_telemetry_export_delivery_fact
ORDER BY last_sequence DESC, ingested_at DESC
LIMIT 1 BY tenant_id,project_id,node_id,export_id;
