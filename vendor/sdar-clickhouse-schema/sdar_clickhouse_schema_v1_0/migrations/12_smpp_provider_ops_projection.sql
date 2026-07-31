-- SDAR ClickHouse Schema 1.3.0-rc.1 / SMPP ProviderOps external projection.
-- Provider-side facts are stored as external facts and relations. They do not
-- overwrite SDAR Runtime authority tables and do not participate in online
-- Provider registration or Resource Availability decisions.

CREATE TABLE IF NOT EXISTS sdar_core.external_provider_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),

    smpp_source_id String,
    source_deployment_id String,
    source_runtime_instance_id String DEFAULT '',

    fact_id UUID,
    fact_hash FixedString(64),
    fact_type LowCardinality(String),
    fact_version LowCardinality(String),

    source_system LowCardinality(String),
    source_product String,
    source_record_id String,
    source_record_hash FixedString(64),
    source_schema_name LowCardinality(String),
    source_schema_version LowCardinality(String),

    provider_id String DEFAULT '',
    provider_instance_id String DEFAULT '',
    resource_id String DEFAULT '',
    external_task_id String DEFAULT '',
    external_execution_id String DEFAULT '',
    external_command_id String DEFAULT '',
    operation_name String DEFAULT '',

    lifecycle_status LowCardinality(String) DEFAULT '',
    provider_substate LowCardinality(String) DEFAULT '',
    reason_code String DEFAULT '',
    runtime_revision String DEFAULT '',
    provider_revision String DEFAULT '',
    progress_percent Nullable(Float64),

    correlation_id String DEFAULT '',
    causation_record_id String DEFAULT '',
    trace_id String DEFAULT '',
    span_id String DEFAULT '',

    origin_sdar_runtime_ids Array(String) DEFAULT [],
    origin_sdar_task_ids Array(String) DEFAULT [],
    origin_sdar_invocation_ids Array(String) DEFAULT [],

    entity_refs_json String DEFAULT '[]' CODEC(ZSTD(3)),
    payload_json String CODEC(ZSTD(3)),
    provenance_json String DEFAULT '{}' CODEC(ZSTD(3)),

    occurred_at DateTime64(3, 'UTC'),
    observed_at Nullable(DateTime64(3, 'UTC')),
    received_at DateTime64(3, 'UTC'),
    normalized_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),

    normalizer_id LowCardinality(String),
    normalizer_version UInt32,
    mapping_version UInt32,
    policy_version UInt32,
    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, environment, smpp_source_id, fact_id) % 128
ORDER BY
(
    tenant_id,
    project_id,
    environment,
    smpp_source_id,
    fact_type,
    provider_id,
    resource_id,
    occurred_at,
    fact_id,
    projection_id,
    projection_version
)
TTL toDateTime(occurred_at, 'UTC') + INTERVAL 365 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.external_entity_relation_fact
(
    tenant_id String,
    project_id String,
    environment LowCardinality(String),

    smpp_source_id String,

    relation_id UUID,
    relation_type LowCardinality(String),
    relation_version UInt32,

    source_entity_urn String,
    source_entity_type LowCardinality(String) DEFAULT '',
    source_entity_id String DEFAULT '',

    target_entity_urn String,
    target_entity_type LowCardinality(String) DEFAULT '',
    target_entity_id String DEFAULT '',

    source_system LowCardinality(String),
    target_system LowCardinality(String),

    valid_from DateTime64(3, 'UTC'),
    valid_to Nullable(DateTime64(3, 'UTC')),

    correlation_id String DEFAULT '',
    trace_id String DEFAULT '',
    causation_fact_id Nullable(UUID),
    route_id String DEFAULT '',
    attempt_no Nullable(UInt32),

    evidence_fact_ids Array(UUID) DEFAULT [],
    binding_source LowCardinality(String),
    confidence_class LowCardinality(String),

    source_record_id String DEFAULT '',
    source_record_hash String DEFAULT '',

    created_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),

    projection_id LowCardinality(String),
    projection_version UInt32
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, environment, smpp_source_id, relation_id) % 128
ORDER BY
(
    tenant_id,
    project_id,
    environment,
    smpp_source_id,
    source_entity_urn,
    target_entity_urn,
    relation_type,
    valid_from,
    relation_id,
    projection_id,
    projection_version
)
TTL toDateTime(valid_from, 'UTC') + INTERVAL 1095 DAY DELETE
SETTINGS index_granularity = 8192;

ALTER TABLE sdar_core.tool_call_record
    ADD COLUMN IF NOT EXISTS provider_origin_type LowCardinality(String) DEFAULT 'direct';
ALTER TABLE sdar_core.tool_call_record
    ADD COLUMN IF NOT EXISTS provider_origin_source_id String DEFAULT '';
ALTER TABLE sdar_core.tool_call_record
    ADD COLUMN IF NOT EXISTS external_provider_id String DEFAULT '';
ALTER TABLE sdar_core.tool_call_record
    ADD COLUMN IF NOT EXISTS external_server_id String DEFAULT '';
ALTER TABLE sdar_core.tool_call_record
    ADD COLUMN IF NOT EXISTS registry_revision UInt64 DEFAULT 0;
ALTER TABLE sdar_core.tool_call_record
    ADD COLUMN IF NOT EXISTS registry_checksum String DEFAULT '';

ALTER TABLE sdar_core.task_availability_check
    ADD COLUMN IF NOT EXISTS provider_origin_type LowCardinality(String) DEFAULT 'direct';
ALTER TABLE sdar_core.task_availability_check
    ADD COLUMN IF NOT EXISTS provider_origin_source_id String DEFAULT '';
ALTER TABLE sdar_core.task_availability_check
    ADD COLUMN IF NOT EXISTS external_provider_id String DEFAULT '';
ALTER TABLE sdar_core.task_availability_check
    ADD COLUMN IF NOT EXISTS external_server_id String DEFAULT '';
ALTER TABLE sdar_core.task_availability_check
    ADD COLUMN IF NOT EXISTS registry_revision UInt64 DEFAULT 0;
ALTER TABLE sdar_core.task_availability_check
    ADD COLUMN IF NOT EXISTS registry_checksum String DEFAULT '';

ALTER TABLE sdar_core.remote_task_binding
    ADD COLUMN IF NOT EXISTS provider_origin_type LowCardinality(String) DEFAULT 'direct';
ALTER TABLE sdar_core.remote_task_binding
    ADD COLUMN IF NOT EXISTS provider_origin_source_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding
    ADD COLUMN IF NOT EXISTS external_provider_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding
    ADD COLUMN IF NOT EXISTS external_provider_instance_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding
    ADD COLUMN IF NOT EXISTS external_server_id String DEFAULT '';
ALTER TABLE sdar_core.remote_task_binding
    ADD COLUMN IF NOT EXISTS registry_revision UInt64 DEFAULT 0;
ALTER TABLE sdar_core.remote_task_binding
    ADD COLUMN IF NOT EXISTS registry_checksum String DEFAULT '';

INSERT INTO sdar_meta.schema_definition
(
    tenant_id, project_id, schema_name, schema_version, schema_family,
    status, json_schema, schema_hash, compatible_from, description
)
VALUES
('global','global','smpp.canonical-telemetry-fact',1,'smpp.providerops/v1.1','active','{}',lower(hex(SHA256('smpp.canonical-telemetry-fact/1'))),1,'SMPP canonical ProviderOps fact source contract.'),
('global','global','smpp.entity-relation-fact',1,'smpp.providerops/v1.1','active','{}',lower(hex(SHA256('smpp.entity-relation-fact/1'))),1,'SMPP entity relation source contract.'),
('global','global','sdar.external-provider-fact',1,'sdar.telemetry/v1','active','{}',lower(hex(SHA256('sdar.external-provider-fact/1'))),1,'SDAR external ProviderOps target fact.'),
('global','global','sdar.external-entity-relation-fact',1,'sdar.telemetry/v1','active','{}',lower(hex(SHA256('sdar.external-entity-relation-fact/1'))),1,'SDAR external entity relation target fact.');

INSERT INTO sdar_meta.projection_definition
(
    tenant_id, project_id, projection_id, projection_stage, projection_name,
    source_databases, target_database, contract_version, owner, description, status
)
VALUES
('global','global','smpp_provider_ops_to_sdar_core','external','SMPP ProviderOps to SDAR Core',['smpp_telemetry'],'sdar_core','1.0','sdar-telemetry-platform','Projects ProviderOps canonical facts into external_provider_fact.','active'),
('global','global','smpp_relations_to_sdar_core','external','SMPP Relations to SDAR Core',['smpp_telemetry'],'sdar_core','1.0','sdar-telemetry-platform','Projects N-to-N entity relations into external_entity_relation_fact.','active');

INSERT INTO sdar_meta.projection_version
(
    tenant_id, project_id, projection_id, projection_version, contract_version,
    source_schema_name, source_schema_version, target_schema_name,
    target_schema_version, target_database, mapping_hash, mapping_document,
    id_namespace_version, environment_map_version, backward_compatible, status
)
VALUES
('global','global','smpp_provider_ops_to_sdar_core','1','1.0','smpp.canonical-telemetry-fact','1','sdar.external-provider-fact','1','sdar_core',lower(hex(SHA256('smpp-provider-ops-v1'))),'{"idempotency":["smpp_source_id","fact_id","projection_id","projection_version"],"scope":["tenant_id","project_id","environment","smpp_source_id"],"unsupported":"dlq"}',1,'1',0,'active'),
('global','global','smpp_relations_to_sdar_core','1','1.0','smpp.entity-relation-fact','1','sdar.external-entity-relation-fact','1','sdar_core',lower(hex(SHA256('smpp-relations-v1'))),'{"cardinality":"N:N","scope":["tenant_id","project_id","environment","smpp_source_id"],"unsupported":"dlq"}',1,'1',0,'active');

INSERT INTO sdar_meta.data_quality_rule
(
    tenant_id, project_id, rule_id, rule_version, scope,
    target_database, target_table, severity, blocking,
    sql_predicate, description, remediation, status
)
VALUES
('global','global','DQ-SMPP-01',1,'record','sdar_core','external_provider_fact','error',1,'smpp_source_id = ''''','smpp_source_id must be non-empty.','Fix the trusted source mapping and replay.','active'),
('global','global','DQ-SMPP-02',1,'record','sdar_core','external_provider_fact','error',1,'fact_hash = repeat(''0'',64)','Logical fact identity must keep a stable fact hash.','Quarantine conflicting logical fact IDs.','active'),
('global','global','DQ-SMPP-03',1,'record','sdar_core','external_provider_fact','error',1,'source_record_id = '''' OR source_record_hash = repeat(''0'',64)','Source record identity and hash are required.','Fix source outbox identity.','active'),
('global','global','DQ-SMPP-04',1,'record','sdar_core','external_provider_fact','error',1,'fact_type = ''provider.task.lifecycle'' AND (provider_id = '''' OR external_task_id = '''')','Provider task lifecycle requires provider and task identity.','Fix ProviderOps payload.','active'),
('global','global','DQ-SMPP-05',1,'record','sdar_core','external_provider_fact','error',1,'fact_type IN (''resource.state'',''resource.health'') AND (provider_id = '''' OR resource_id = '''')','Resource facts require provider and resource identity.','Fix ProviderOps payload.','active'),
('global','global','DQ-SMPP-06',1,'route','sdar_core','external_provider_fact','error',1,'tenant_id = '''' OR project_id = '''' OR environment = ''''','Trusted route scope is required.','Fix source route mapping.','active'),
('global','global','DQ-SMPP-07',1,'projection','sdar_core','external_provider_fact','error',1,'projection_id = ''''','External facts must identify their projection.','Fix projection configuration.','active'),
('global','global','DQ-SMPP-08',1,'security','sdar_core','external_provider_fact','error',1,'positionCaseInsensitive(payload_json,''Authorization'') > 0 OR positionCaseInsensitive(payload_json,''Password'') > 0 OR positionCaseInsensitive(payload_json,''Private Key'') > 0','Secrets must not enter ProviderOps payloads.','Reject source record and rotate exposed secret.','active'),
('global','global','DQ-SMPP-09',1,'record','sdar_core','remote_task_binding','error',1,'provider_origin_type = ''smpp_registry'' AND (provider_origin_source_id = '''' OR external_provider_id = '''' OR external_server_id = '''' OR registry_revision = 0)','SMPP remote task bindings require full origin identity.','Fix Runtime collector mapping.','active'),
('global','global','DQ-SMPP-10',1,'reconciliation','sdar_core','external_provider_fact','error',1,'0','Same revision terminal conflicts are detected by the reconciliation query.','Investigate Runtime/Provider authority divergence.','active'),
('global','global','DQ-SMPP-11',1,'reconciliation','sdar_core','external_provider_fact','warning',0,'0','Provider terminal preceding SDAR terminal beyond threshold creates a lag warning.','Inspect notification/poll delivery.','active'),
('global','global','DQ-SMPP-12',1,'reconciliation','sdar_core','external_provider_fact','error',1,'0','SDAR and Provider terminal mismatch creates a blocking quality issue.','Investigate before evaluation publication.','active'),
('global','global','DQ-SMPP-13',1,'relation','sdar_core','external_entity_relation_fact','error',1,'0','External relations must not assert unique Resource-to-Provider ownership.','Remove invalid uniqueness assumptions.','active'),
('global','global','DQ-SMPP-14',1,'relation','sdar_core','external_entity_relation_fact','warning',0,'confidence_class IN (''derived'',''traced'') AND binding_source = ''registry_authority''','Derived relations cannot claim Registry authority.','Correct binding_source or confidence_class.','active');

CREATE VIEW IF NOT EXISTS sdar_core.v_smpp_provider_task_timeline AS
SELECT
    tenant_id,
    project_id,
    environment,
    smpp_source_id,
    provider_id,
    provider_instance_id,
    external_task_id,
    resource_id,
    operation_name,
    lifecycle_status,
    provider_substate,
    runtime_revision,
    provider_revision,
    reason_code,
    progress_percent,
    correlation_id,
    trace_id,
    occurred_at,
    received_at,
    projected_at,
    payload_json
FROM sdar_core.external_provider_fact
WHERE fact_type = 'provider.task.lifecycle';

CREATE VIEW IF NOT EXISTS sdar_core.v_smpp_resource_current_state AS
SELECT
    tenant_id,
    project_id,
    environment,
    smpp_source_id,
    provider_id,
    resource_id,
    argMax(lifecycle_status, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS lifecycle_status,
    argMax(provider_substate, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS provider_substate,
    argMax(payload_json, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS payload_json,
    max(occurred_at) AS last_occurred_at,
    max(received_at) AS last_received_at,
    max(projected_at) AS last_projected_at
FROM sdar_core.external_provider_fact
WHERE fact_type = 'resource.state'
GROUP BY tenant_id, project_id, environment, smpp_source_id, provider_id, resource_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_smpp_resource_current_health AS
SELECT
    tenant_id,
    project_id,
    environment,
    smpp_source_id,
    provider_id,
    resource_id,
    argMax(lifecycle_status, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS health_status,
    argMax(reason_code, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS reason_code,
    argMax(payload_json, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS payload_json,
    max(occurred_at) AS last_occurred_at,
    max(received_at) AS last_received_at,
    max(projected_at) AS last_projected_at
FROM sdar_core.external_provider_fact
WHERE fact_type = 'resource.health'
GROUP BY tenant_id, project_id, environment, smpp_source_id, provider_id, resource_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_smpp_execution_latest_progress AS
SELECT
    tenant_id,
    project_id,
    environment,
    smpp_source_id,
    provider_id,
    external_execution_id,
    external_task_id,
    argMax(progress_percent, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS progress_percent,
    argMax(provider_substate, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS provider_substate,
    argMax(payload_json, tuple(coalesce(observed_at, occurred_at), occurred_at, projected_at)) AS payload_json,
    max(occurred_at) AS last_occurred_at,
    max(projected_at) AS last_projected_at
FROM sdar_core.external_provider_fact
WHERE fact_type = 'execution.progress'
GROUP BY tenant_id, project_id, environment, smpp_source_id, provider_id, external_execution_id, external_task_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_sdar_smpp_task_reconciliation AS
WITH provider_latest AS
(
    SELECT
        tenant_id,
        project_id,
        environment,
        smpp_source_id,
        provider_id,
        external_task_id,
        argMax(lifecycle_status, tuple(occurred_at, projected_at)) AS provider_lifecycle_status,
        argMax(provider_substate, tuple(occurred_at, projected_at)) AS provider_reported_substate,
        argMax(runtime_revision, tuple(occurred_at, projected_at)) AS smpp_runtime_revision,
        max(occurred_at) AS last_provider_fact_time
    FROM sdar_core.external_provider_fact
    WHERE fact_type = 'provider.task.lifecycle'
    GROUP BY tenant_id, project_id, environment, smpp_source_id, provider_id, external_task_id
)
SELECT
    l.tenant_id,
    l.project_id,
    l.environment,
    l.binding_id,
    l.remote_task_id,
    l.provider_origin_source_id AS smpp_source_id,
    l.external_provider_id,
    l.protocol_status AS local_protocol_status,
    l.current_provider_substate AS local_provider_substate,
    l.current_observation_revision AS local_runtime_revision,
    p.provider_lifecycle_status,
    p.provider_reported_substate,
    p.smpp_runtime_revision,
    l.updated_at AS last_local_observation_time,
    p.last_provider_fact_time,
    (l.protocol_status != '' AND p.provider_lifecycle_status != '' AND l.protocol_status != p.provider_lifecycle_status) AS status_mismatch,
    (l.current_observation_revision != '' AND p.smpp_runtime_revision != '' AND l.current_observation_revision != p.smpp_runtime_revision) AS revision_mismatch,
    dateDiff('millisecond', p.last_provider_fact_time, l.updated_at) AS observation_lag_ms
FROM sdar_core.remote_task_binding AS l
LEFT JOIN provider_latest AS p
  ON l.tenant_id = p.tenant_id
 AND l.project_id = p.project_id
 AND l.environment = p.environment
 AND l.provider_origin_source_id = p.smpp_source_id
 AND l.external_provider_id = p.provider_id
 AND l.remote_task_id = p.external_task_id
WHERE l.provider_origin_type = 'smpp_registry';

CREATE VIEW IF NOT EXISTS sdar_core.v_sdar_smpp_execution_topology AS
SELECT
    tenant_id,
    project_id,
    environment,
    smpp_source_id,
    relation_id,
    relation_type,
    source_entity_urn,
    source_entity_type,
    source_entity_id,
    target_entity_urn,
    target_entity_type,
    target_entity_id,
    source_system,
    target_system,
    valid_from,
    valid_to,
    correlation_id,
    trace_id,
    evidence_fact_ids,
    binding_source,
    confidence_class,
    projected_at
FROM sdar_core.external_entity_relation_fact;

SELECT throwIf(countIf(engine != 'View') != 63, 'SMOKE SMPP: sdar_core physical table count mismatch after Migration 12')
FROM system.tables WHERE database = 'sdar_core';

SELECT throwIf(
    count() != 6,
    'SMOKE SMPP: expected six SMPP views'
)
FROM system.tables
WHERE database = 'sdar_core'
  AND name IN
  (
      'v_smpp_provider_task_timeline',
      'v_smpp_resource_current_state',
      'v_smpp_resource_current_health',
      'v_smpp_execution_latest_progress',
      'v_sdar_smpp_task_reconciliation',
      'v_sdar_smpp_execution_topology'
  )
  AND engine = 'View';

SELECT throwIf(
    count() < 14,
    'SMOKE SMPP: DQ-SMPP rules missing'
)
FROM sdar_meta.data_quality_rule FINAL
WHERE startsWith(rule_id, 'DQ-SMPP-')
  AND status = 'active';
