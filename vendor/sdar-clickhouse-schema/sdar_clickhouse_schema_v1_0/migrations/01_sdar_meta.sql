-- SDAR ClickHouse Metadata Schema V1.1
-- Compatibility: ClickHouse 24.8+; recommended 25.3 LTS+
-- Fresh-install DDL. Run after 00_create_databases.sql.
-- Definition tables keep versioned contracts; projection runtime tables keep replay/audit state.

CREATE TABLE IF NOT EXISTS sdar_meta.schema_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    schema_name LowCardinality(String),
    schema_version UInt16,
    schema_family LowCardinality(String),
    status LowCardinality(String),
    json_schema String CODEC(ZSTD(3)),
    schema_hash FixedString(64),
    compatible_from UInt16 DEFAULT 0,
    description String DEFAULT '',
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, schema_name, schema_version);

CREATE TABLE IF NOT EXISTS sdar_meta.event_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    catalog_version String DEFAULT '1.1',
    event_type LowCardinality(String),
    event_category LowCardinality(String),
    payload_schema_name String,
    payload_schema_version UInt16,
    description String DEFAULT '',
    status LowCardinality(String) DEFAULT 'active',
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, catalog_version, event_type);

CREATE TABLE IF NOT EXISTS sdar_meta.event_policy
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    catalog_version String DEFAULT '1.1',
    policy_version UInt16 DEFAULT 1,
    event_type LowCardinality(String),
    event_category LowCardinality(String),
    delivery_class LowCardinality(String),
    required_for_evaluation UInt8,
    sampling_allowed UInt8,
    retention_days UInt32 DEFAULT 1095,
    minimum_collector_version String DEFAULT '1.1.0',
    payload_schema_name String DEFAULT '',
    payload_schema_version UInt16 DEFAULT 1,
    status LowCardinality(String) DEFAULT 'active',
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, catalog_version, event_type, policy_version);

CREATE TABLE IF NOT EXISTS sdar_meta.data_quality_rule
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    rule_id String,
    rule_version UInt16,
    scope LowCardinality(String),
    target_database String,
    target_table String,
    severity LowCardinality(String),
    blocking UInt8,
    sql_predicate String CODEC(ZSTD(3)),
    description String,
    remediation String DEFAULT '',
    status LowCardinality(String),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, rule_id, rule_version);

-- Stable UUID namespaces are data contracts. An active namespace must never be changed.
CREATE TABLE IF NOT EXISTS sdar_meta.id_namespace_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    namespace_name String,
    namespace_version UInt16 DEFAULT 1,
    namespace_uuid UUID,
    entity_type LowCardinality(String),
    algorithm LowCardinality(String) DEFAULT 'uuidv5_sha1',
    canonical_name_template String,
    description String DEFAULT '',
    status LowCardinality(String) DEFAULT 'active',
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, namespace_name, namespace_version);

CREATE TABLE IF NOT EXISTS sdar_meta.projection_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    projection_id String,
    projection_stage LowCardinality(String),
    projection_name String,
    source_databases Array(String),
    target_database String,
    contract_version String,
    owner String DEFAULT '',
    description String DEFAULT '',
    status LowCardinality(String) DEFAULT 'active',
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, projection_id);

CREATE TABLE IF NOT EXISTS sdar_meta.projection_version
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    projection_id String,
    projection_version String,
    contract_version String,
    source_schema_name String,
    source_schema_version String,
    target_schema_name String,
    target_schema_version String,
    target_database String,
    mapping_hash FixedString(64),
    mapping_document String CODEC(ZSTD(3)),
    id_namespace_version UInt16 DEFAULT 1,
    environment_map_version String DEFAULT '1',
    backward_compatible UInt8 DEFAULT 0,
    effective_from DateTime64(3, 'UTC') DEFAULT now64(3),
    effective_to Nullable(DateTime64(3, 'UTC')),
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, projection_id, projection_version);

-- No physical/runtime environment is implicitly converted into a deployment environment.
-- A legacy source must have an explicit tenant/project/deployment mapping row.
CREATE TABLE IF NOT EXISTS sdar_meta.deployment_environment_mapping
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    mapping_version String,
    source_system LowCardinality(String),
    deployment_id String,
    source_environment String,
    target_environment LowCardinality(String),
    configured_by String,
    reason String,
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY
(
    tenant_id,
    project_id,
    mapping_version,
    source_system,
    deployment_id,
    source_environment
);

-- One row binds a source identity to its canonical UUID. source_key_hash is SHA-256 of
-- the canonical UUIDv5 name and allows collision/conflict checks without parsing JSON.
CREATE TABLE IF NOT EXISTS sdar_meta.id_crosswalk
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    projection_id String,
    projection_version String,
    namespace_name String,
    namespace_version UInt16,
    source_system LowCardinality(String),
    source_agent_type LowCardinality(String),
    source_database String,
    source_entity_type LowCardinality(String),
    source_record_id String,
    business_discriminator String DEFAULT '',
    source_id String,
    normalized_source_id String,
    source_key_hash FixedString(64),
    target_entity_type LowCardinality(String),
    target_id UUID,
    first_seen_at DateTime64(3, 'UTC'),
    last_seen_at DateTime64(3, 'UTC'),
    status LowCardinality(String) DEFAULT 'active',
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID ALIAS if(target_entity_type = 'episode', target_id, toUUID('00000000-0000-0000-0000-000000000000'))
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY cityHash64(source_key_hash) % 64
ORDER BY
(
    tenant_id,
    project_id,
    projection_id,
    projection_version,
    source_system,
    source_agent_type,
    source_database,
    source_entity_type,
    business_discriminator,
    target_entity_type,
    source_id
);

CREATE TABLE IF NOT EXISTS sdar_meta.projection_checkpoint
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    projection_id String,
    projection_version String,
    consumer_group String,
    source_stream String,
    source_partition String,
    source_offset Int64 DEFAULT -1,
    source_watermark Nullable(DateTime64(3, 'UTC')),
    last_source_record_id String DEFAULT '',
    last_source_payload_hash String DEFAULT '',
    checkpoint_token String DEFAULT '',
    projection_run_id UUID,
    processed_count UInt64 DEFAULT 0,
    status LowCardinality(String),
    committed_at DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY cityHash64(tenant_id, project_id, projection_id, projection_version, source_stream, source_partition) % 64
ORDER BY
(
    tenant_id,
    project_id,
    projection_id,
    projection_version,
    consumer_group,
    source_stream,
    source_partition
);

CREATE TABLE IF NOT EXISTS sdar_meta.projection_run
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    projection_run_id UUID,
    projection_id String,
    projection_version String,
    contract_version String,
    mapping_hash FixedString(64),
    id_namespace_version UInt16,
    environment_map_version String,
    run_mode LowCardinality(String),
    source_checkpoint_json String DEFAULT '{}' CODEC(ZSTD(3)),
    target_checkpoint_json String DEFAULT '{}' CODEC(ZSTD(3)),
    source_watermark_from Nullable(DateTime64(3, 'UTC')),
    source_watermark_to Nullable(DateTime64(3, 'UTC')),
    worker_id String DEFAULT '',
    trigger_reason String DEFAULT '',
    status LowCardinality(String),
    input_count UInt64 DEFAULT 0,
    output_count UInt64 DEFAULT 0,
    duplicate_count UInt64 DEFAULT 0,
    dead_letter_count UInt64 DEFAULT 0,
    started_at DateTime64(3, 'UTC'),
    finished_at Nullable(DateTime64(3, 'UTC')),
    error_summary String DEFAULT '',
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY cityHash64(projection_run_id) % 64
ORDER BY (tenant_id, project_id, projection_id, projection_version, projection_run_id);

CREATE TABLE IF NOT EXISTS sdar_meta.projection_dead_letter
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    dead_letter_id UUID,
    projection_run_id UUID,
    projection_id String,
    projection_version String,
    source_system LowCardinality(String),
    source_agent_type LowCardinality(String) DEFAULT 'unknown',
    source_database String,
    source_table String,
    source_record_id String DEFAULT '',
    source_position String DEFAULT '',
    target_database String DEFAULT '',
    target_table String DEFAULT '',
    error_stage LowCardinality(String),
    error_code String,
    error_message String,
    severity LowCardinality(String) DEFAULT 'error',
    blocking UInt8 DEFAULT 1,
    quality_rule_id String DEFAULT '',
    quality_rule_version UInt16 DEFAULT 0,
    retryable UInt8,
    retry_count UInt32 DEFAULT 0,
    resolution_status LowCardinality(String) DEFAULT 'open',
    resolved_by_run_id Nullable(UUID),
    payload_hash String DEFAULT '',
    payload_json String CODEC(ZSTD(3)),
    failed_at DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS failed_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY cityHash64(dead_letter_id) % 64
ORDER BY (tenant_id, project_id, projection_id, projection_version, dead_letter_id);

CREATE TABLE IF NOT EXISTS sdar_meta.projection_lineage
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    lineage_id UUID,
    projection_run_id UUID,
    projection_id String,
    projection_version String,
    contract_version String,
    mapping_hash FixedString(64),
    id_namespace_version UInt16,
    environment_map_version String,
    mapping_rule_id String,
    mapping_rule_version String,
    source_system LowCardinality(String),
    source_agent_type LowCardinality(String),
    source_database String,
    source_table String,
    source_record_id String,
    source_position String DEFAULT '',
    source_payload_hash String,
    target_database String,
    target_table String,
    target_record_id String,
    target_payload_hash String,
    relationship LowCardinality(String) DEFAULT 'derived_from',
    projected_at DateTime64(3, 'UTC'),
    status LowCardinality(String) DEFAULT 'active',
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS projected_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY cityHash64(target_database, target_table, target_record_id, source_database, source_table, source_record_id) % 64
ORDER BY
(
    tenant_id,
    project_id,
    projection_id,
    projection_version,
    target_database,
    target_table,
    target_record_id,
    source_database,
    source_table,
    source_record_id,
    mapping_rule_id
);

CREATE TABLE IF NOT EXISTS sdar_meta.collector_version
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    collector_id String,
    collector_type LowCardinality(String),
    collector_version String,
    supported_schema_versions Map(String, String),
    status LowCardinality(String),
    deployed_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC') ALIAS deployed_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(deployed_at)
ORDER BY (tenant_id, project_id, collector_id, collector_version);

-- Evaluation definitions deliberately include the complete evaluation identity in their keys.
-- application/domain/general are independent tiers and must never reuse result rows or scores.
CREATE TABLE IF NOT EXISTS sdar_meta.evaluation_profile_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    framework String,
    framework_version String,
    evaluation_tier LowCardinality(String),
    profile String,
    profile_version String,
    applicable_adapters Array(String) DEFAULT [],
    applicable_agent_types Array(String) DEFAULT [],
    source_database_patterns Array(String) DEFAULT [],
    output_table_prefix String,
    metric_set_id String,
    metric_set_version String,
    gate_set_id String,
    gate_set_version String,
    fatal_set_id String,
    fatal_set_version String,
    metric_weight_total Float64 DEFAULT 100,
    minimum_pass_score Float64 DEFAULT 75,
    score_scale_json String DEFAULT '{}' CODEC(ZSTD(3)),
    evaluation_policy_json String DEFAULT '{}' CODEC(ZSTD(3)),
    description String DEFAULT '',
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
    CONSTRAINT ck_evaluation_profile_set_identity CHECK
        notEmpty(metric_set_id) AND notEmpty(metric_set_version)
        AND notEmpty(gate_set_id) AND notEmpty(gate_set_version)
        AND notEmpty(fatal_set_id) AND notEmpty(fatal_set_version),
    CONSTRAINT ck_evaluation_profile_score_scale_json CHECK isValidJSON(score_scale_json),
    CONSTRAINT ck_evaluation_profile_policy_json CHECK isValidJSON(evaluation_policy_json)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY
(
    tenant_id,
    project_id,
    framework,
    framework_version,
    evaluation_tier,
    profile,
    profile_version,
    metric_set_id,
    metric_set_version,
    gate_set_id,
    gate_set_version,
    fatal_set_id,
    fatal_set_version
);

-- Verifiable identity for one immutable metric, gate or fatal rule-set version.
-- rule_set_hash is derived from the semantic definition rows; transport metadata,
-- status and timestamps are deliberately outside the canonical byte stream.
CREATE TABLE IF NOT EXISTS sdar_meta.evaluation_rule_set_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    framework String,
    framework_version String,
    evaluation_tier LowCardinality(String),
    profile String,
    profile_version String,
    rule_set_kind LowCardinality(String),
    rule_set_id String,
    rule_set_version String,
    rule_set_hash FixedString(64),
    definition_count UInt32,
    canonicalization_version String,
    description String DEFAULT '',
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
    CONSTRAINT ck_evaluation_rule_set_kind CHECK rule_set_kind IN ('metric', 'gate', 'fatal'),
    CONSTRAINT ck_evaluation_rule_set_hash CHECK match(toString(rule_set_hash), '^[0-9a-f]{64}$'),
    CONSTRAINT ck_evaluation_rule_set_definition_count CHECK definition_count > 0,
    CONSTRAINT ck_evaluation_rule_set_canonicalization CHECK notEmpty(canonicalization_version)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY
(
    tenant_id,
    project_id,
    framework,
    framework_version,
    evaluation_tier,
    profile,
    profile_version,
    rule_set_kind,
    rule_set_id,
    rule_set_version
);

CREATE TABLE IF NOT EXISTS sdar_meta.metric_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    framework String,
    framework_version String,
    evaluation_tier LowCardinality(String),
    profile String,
    profile_version String,
    metric_set_version String,
    metric_id String,
    metric_version UInt16,
    dimension_id String,
    dimension_name String,
    name String,
    description String,
    weight Float64,
    max_raw_score UInt8 DEFAULT 2,
    scoring_rule_json String CODEC(ZSTD(3)),
    required_evidence_types Array(String),
    minimum_evidence_level_for_max_score LowCardinality(String) DEFAULT 'E2',
    required UInt8 DEFAULT 1,
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY
(
    tenant_id,
    project_id,
    framework,
    framework_version,
    evaluation_tier,
    profile,
    profile_version,
    metric_set_version,
    metric_id,
    metric_version
);

CREATE TABLE IF NOT EXISTS sdar_meta.gate_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    framework String,
    framework_version String,
    evaluation_tier LowCardinality(String),
    profile String,
    profile_version String,
    gate_set_version String,
    gate_id String,
    gate_version UInt16,
    name String,
    description String,
    pass_condition String,
    required_evidence_types Array(String),
    rule_json String DEFAULT '{}' CODEC(ZSTD(3)),
    failure_level LowCardinality(String) DEFAULT 'HG',
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY
(
    tenant_id,
    project_id,
    framework,
    framework_version,
    evaluation_tier,
    profile,
    profile_version,
    gate_set_version,
    gate_id,
    gate_version
);

CREATE TABLE IF NOT EXISTS sdar_meta.fatal_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    framework String,
    framework_version String,
    evaluation_tier LowCardinality(String),
    profile String,
    profile_version String,
    fatal_set_version String,
    fatal_id String,
    fatal_version UInt16,
    name String,
    description String,
    detection_condition String,
    required_evidence_types Array(String),
    rule_json String DEFAULT '{}' CODEC(ZSTD(3)),
    failure_level LowCardinality(String) DEFAULT 'F',
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3),
    occurred_at DateTime64(3, 'UTC') ALIAS updated_at,
    sequence UInt64 DEFAULT 0,
    episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY
(
    tenant_id,
    project_id,
    framework,
    framework_version,
    evaluation_tier,
    profile,
    profile_version,
    fatal_set_version,
    fatal_id,
    fatal_version
);
