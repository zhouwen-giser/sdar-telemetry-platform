-- DESIGN-FROZEN TARGET for sdar-clickhouse-schema 1.3.0.
-- Must be compiled on ClickHouse 24.8 and 25.3 before implementation freeze.

CREATE TABLE IF NOT EXISTS sdar_core.node_capability_version_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    node_id String,
    record_id UUID,
    capability_id String,
    capability_version UInt64,
    domain LowCardinality(String),
    name String,
    status LowCardinality(String),
    risk_level LowCardinality(String),
    definition_hash FixedString(64),
    success_criteria_hash FixedString(64),
    evidence_requirement_hash FixedString(64),
    source_record_id String,
    source_record_hash FixedString(64),
    payload_json String CODEC(ZSTD(3)),
    occurred_at DateTime64(3, 'UTC'),
    received_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id, capability_id) % 64
ORDER BY (tenant_id, project_id, environment, node_id, capability_id, capability_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.capability_implementation_binding_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    node_id String,
    record_id UUID,
    binding_id String,
    capability_id String,
    capability_version UInt64,
    implementation_type LowCardinality(String),
    implementation_id String,
    implementation_version String,
    binding_role LowCardinality(String),
    priority UInt32,
    status LowCardinality(String),
    provider_policy_hash String DEFAULT '',
    source_record_id String,
    source_record_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    received_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id, capability_id) % 64
ORDER BY (tenant_id, project_id, environment, node_id, capability_id, capability_version, binding_id, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.capability_readiness_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    node_id String,
    record_id UUID,
    capability_id String,
    capability_version UInt64,
    snapshot_version UInt64,
    readiness_status LowCardinality(String),
    catalog_hash String,
    policy_hash String,
    reasons_json String CODEC(ZSTD(3)),
    evaluated_at DateTime64(3, 'UTC'),
    valid_until DateTime64(3, 'UTC'),
    received_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id, capability_id) % 64
ORDER BY (tenant_id, project_id, environment, node_id, capability_id, capability_version, snapshot_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.a2a_exposure_revision_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    node_id String,
    record_id UUID,
    exposure_id String,
    exposure_version UInt64,
    agent_skill_id String,
    capability_id String,
    capability_version UInt64,
    visibility LowCardinality(String),
    status LowCardinality(String),
    exposure_hash FixedString(64),
    occurred_at DateTime64(3, 'UTC'),
    received_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id, exposure_id) % 64
ORDER BY (tenant_id, project_id, environment, node_id, exposure_id, exposure_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.agent_card_revision_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    node_id String,
    record_id UUID,
    agent_card_revision UInt64,
    status LowCardinality(String),
    content_hash FixedString(64),
    capability_catalog_hash FixedString(64),
    exposure_refs Array(String),
    occurred_at DateTime64(3, 'UTC'),
    activated_at Nullable(DateTime64(3, 'UTC')),
    received_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id) % 64
ORDER BY (tenant_id, project_id, environment, node_id, agent_card_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.task_capability_binding_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    node_id String,
    record_id UUID,
    task_id String,
    binding_id String,
    capability_id String,
    capability_version UInt64,
    exposure_id String DEFAULT '',
    exposure_version UInt64 DEFAULT 0,
    binding_hash FixedString(64),
    success_criteria_hash FixedString(64),
    evidence_requirement_hash FixedString(64),
    initial_implementation_refs Array(String),
    occurred_at DateTime64(3, 'UTC'),
    received_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id, task_id) % 128
ORDER BY (tenant_id, project_id, environment, node_id, task_id, binding_id, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.task_capability_attempt_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),
    node_id String,
    record_id UUID,
    task_id String,
    binding_id String,
    attempt_id String,
    attempt_no UInt32,
    reason LowCardinality(String),
    attempt_status LowCardinality(String),
    plan_id String DEFAULT '',
    plan_template_ref String DEFAULT '',
    skill_version_refs Array(String),
    provider_binding_refs Array(String),
    occurred_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    received_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, node_id, task_id) % 128
ORDER BY (tenant_id, project_id, environment, node_id, task_id, attempt_no, attempt_id, record_id);

CREATE VIEW IF NOT EXISTS sdar_core.v_node_capability_current AS
SELECT *
FROM sdar_core.node_capability_version_fact
ORDER BY capability_version DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, environment, node_id, capability_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_capability_readiness_current AS
SELECT *
FROM sdar_core.capability_readiness_fact
ORDER BY snapshot_version DESC, evaluated_at DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, environment, node_id, capability_id, capability_version;

CREATE VIEW IF NOT EXISTS sdar_core.v_a2a_exposure_current AS
SELECT *
FROM sdar_core.a2a_exposure_revision_fact
ORDER BY exposure_version DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, environment, node_id, exposure_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_agent_card_current AS
SELECT *
FROM sdar_core.agent_card_revision_fact
WHERE status = 'active'
ORDER BY agent_card_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, environment, node_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_task_capability_execution_chain AS
SELECT
    b.tenant_id,
    b.project_id,
    b.environment,
    b.node_id,
    b.task_id,
    b.capability_id,
    b.capability_version,
    b.exposure_id,
    a.attempt_id,
    a.attempt_no,
    a.reason,
    a.attempt_status,
    a.plan_template_ref,
    a.skill_version_refs,
    a.provider_binding_refs,
    a.occurred_at,
    a.completed_at
FROM sdar_core.task_capability_binding_fact AS b
LEFT JOIN sdar_core.task_capability_attempt_fact AS a
  ON b.tenant_id = a.tenant_id
 AND b.project_id = a.project_id
 AND b.environment = a.environment
 AND b.node_id = a.node_id
 AND b.task_id = a.task_id
 AND b.binding_id = a.binding_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_task_capability_contract_issue AS
SELECT
    b.tenant_id,
    b.project_id,
    b.environment,
    b.node_id,
    b.task_id,
    b.capability_id,
    b.capability_version,
    'NO_IMPLEMENTATION_ATTEMPT' AS issue_code
FROM sdar_core.task_capability_binding_fact AS b
LEFT JOIN sdar_core.task_capability_attempt_fact AS a
  ON b.tenant_id = a.tenant_id
 AND b.project_id = a.project_id
 AND b.environment = a.environment
 AND b.node_id = a.node_id
 AND b.task_id = a.task_id
WHERE a.attempt_id = '';
