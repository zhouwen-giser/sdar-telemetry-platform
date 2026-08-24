-- SDAR ClickHouse Schema 1.4.1-rc.1 / Canonical Evidence warehouse foundation.
-- Pre-aligned to sdar.evidence/v1. Exact Runtime source-table mappings and payload
-- schema hashes remain pending the v1.4.1 Phase 14 ClickHouse handoff bundle.

CREATE TABLE IF NOT EXISTS sdar_meta.record_type_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    catalog_version String,
    contract_version String,
    record_family LowCardinality(String),
    record_type String,
    schema_name String,
    schema_version UInt16,
    target_database String,
    target_table String,
    delivery_guarantee LowCardinality(String),
    evaluation_role LowCardinality(String),
    requiredness LowCardinality(String),
    sampling_allowed UInt8,
    runtime_schema_status LowCardinality(String),
    runtime_schema_hash String DEFAULT '',
    status LowCardinality(String),
    description String DEFAULT '',
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, catalog_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.source_mapping_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    mapping_version String,
    contract_version String,
    record_type String,
    source_system LowCardinality(String),
    source_authority String,
    source_table String DEFAULT '',
    source_table_status LowCardinality(String),
    source_identity_rule String,
    projection_id String,
    target_table String,
    mapping_hash String DEFAULT '',
    mapping_document String CODEC(ZSTD(3)),
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, mapping_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.record_policy_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    policy_version String,
    record_type String,
    delivery_guarantee LowCardinality(String),
    evaluation_role LowCardinality(String),
    requiredness LowCardinality(String),
    episode_applicability_rule String CODEC(ZSTD(3)),
    artifact_policy_id String DEFAULT '',
    redaction_profile_id String,
    retention_days UInt32,
    sampling_allowed UInt8,
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, policy_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.redaction_profile_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    redaction_profile_id String,
    profile_version UInt16,
    forbidden_key_patterns Array(String),
    pii_policy_json String CODEC(ZSTD(3)),
    credential_policy_json String CODEC(ZSTD(3)),
    maximum_inline_bytes UInt64,
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, redaction_profile_id, record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.artifact_policy_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    artifact_policy_id String,
    policy_version UInt16,
    artifact_mode LowCardinality(String),
    inline_limit_bytes UInt64,
    required_content_hash UInt8,
    allowed_media_types Array(String),
    retention_days UInt32,
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, artifact_policy_id, record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.warehouse_release_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    release_version String,
    runtime_baseline String,
    evidence_contract String,
    record_catalog_hash FixedString(64),
    source_mapping_hash FixedString(64),
    migration_range String,
    implementation_status LowCardinality(String),
    validation_json String CODEC(ZSTD(3)),
    status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, project_id, release_version, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.canonical_evidence_record
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
    contract_version LowCardinality(String),
    schema_name String,
    schema_version UInt16,
    record_family LowCardinality(String),
    record_type String,
    delivery_guarantee LowCardinality(String),
    evaluation_role LowCardinality(String),
    tenant_scope_id String DEFAULT '',
    user_scope_id String DEFAULT '',
    task_id String DEFAULT '',
    context_id String DEFAULT '',
    episode_id String DEFAULT '',
    run_id String DEFAULT '',
    goal_id String DEFAULT '',
    goal_version UInt32 DEFAULT 0,
    plan_id String DEFAULT '',
    plan_version UInt32 DEFAULT 0,
    skill_execution_id String DEFAULT '',
    capability_binding_id String DEFAULT '',
    remote_task_binding_id String DEFAULT '',
    node_id String DEFAULT '',
    evidence_sequence Nullable(UInt64),
    evidence_refs Array(String) DEFAULT [],
    artifact_refs Array(String) DEFAULT [],
    payload_json String CODEC(ZSTD(3)),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, record_type, occurred_at, evidence_record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.evidence_source_checkpoint_fact
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
    source_family String,
    source_partition String,
    last_source_occurred_at DateTime64(3, 'UTC'),
    last_source_record_id String,
    last_source_revision String DEFAULT '',
    last_source_payload_hash String DEFAULT '',
    last_projected_at DateTime64(3, 'UTC'),
    projector_version String,
    processed_count UInt64,
    failed_count UInt64,
    checkpoint_status LowCardinality(String),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, source_family) % 64
ORDER BY (tenant_id, project_id, source_family, source_partition, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.evidence_export_status_fact
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
    export_id String,
    export_revision UInt64,
    export_status LowCardinality(String),
    last_acknowledged_sequence UInt64,
    pending_records UInt64,
    oldest_pending_at Nullable(DateTime64(3, 'UTC')),
    last_error_code String DEFAULT '',
    last_error_at Nullable(DateTime64(3, 'UTC')),
    observed_at DateTime64(3, 'UTC'),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, export_id) % 64
ORDER BY (tenant_id, project_id, export_id, export_revision, record_id);

CREATE TABLE IF NOT EXISTS sdar_core.evidence_projection_issue_fact
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
    issue_id String,
    issue_type LowCardinality(String),
    severity LowCardinality(String),
    record_type String DEFAULT '',
    affected_evidence_record_id String DEFAULT '',
    description String,
    issue_status LowCardinality(String),
    resolved_at Nullable(DateTime64(3, 'UTC')),
    remediation String DEFAULT '',
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, project_id, issue_id, occurred_at, record_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS sdar_core.episode_evidence_manifest_fact
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
    manifest_id String,
    manifest_version UInt32,
    episode_id String,
    task_id String,
    terminal_outcome_id String,
    expected_required_records UInt64,
    projected_required_records UInt64,
    pending_required_records UInt64,
    failed_required_records UInt64,
    expected_families Array(String),
    completed_families Array(String),
    missing_families Array(String),
    source_coverage_json String CODEC(ZSTD(3)),
    last_evidence_sequence UInt64,
    manifest_status LowCardinality(String),
    quality_issue_ids Array(String),
    sealed_at Nullable(DateTime64(3, 'UTC')),
    occurred_at DateTime64(3, 'UTC'),
    recorded_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY cityHash64(tenant_id, project_id, episode_id) % 64
ORDER BY (tenant_id, project_id, episode_id, manifest_version, record_id);

CREATE VIEW IF NOT EXISTS sdar_core.v_canonical_evidence_latest AS
SELECT * FROM sdar_core.canonical_evidence_record
ORDER BY recorded_at DESC, ingested_at DESC
LIMIT 1 BY tenant_id, project_id, evidence_record_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_episode_evidence_manifest_current AS
SELECT * FROM sdar_core.episode_evidence_manifest_fact
ORDER BY manifest_version DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, episode_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_source_projection_coverage AS
SELECT source_system, source_table, record_type,
       uniqExact(source_record_id) AS source_record_count,
       uniqExact(evidence_record_id) AS evidence_record_count,
       countIf(evaluation_role='required') AS required_record_count,
       max(recorded_at) AS last_recorded_at
FROM sdar_core.canonical_evidence_record
GROUP BY source_system, source_table, record_type;

CREATE VIEW IF NOT EXISTS sdar_core.v_payload_hash_conflict AS
SELECT evidence_record_id, uniqExact(payload_hash) AS payload_hash_count,
       groupUniqArray(payload_hash) AS payload_hashes
FROM sdar_core.canonical_evidence_record
GROUP BY evidence_record_id
HAVING payload_hash_count > 1;

CREATE VIEW IF NOT EXISTS sdar_core.v_required_evidence_gap AS
SELECT * FROM sdar_core.v_episode_evidence_manifest_current
WHERE manifest_status='incomplete' OR failed_required_records > 0 OR pending_required_records > 0;

INSERT INTO sdar_meta.record_type_definition
(tenant_id,project_id,catalog_version,contract_version,record_family,record_type,schema_name,schema_version,target_database,target_table,delivery_guarantee,evaluation_role,requiredness,sampling_allowed,runtime_schema_status,runtime_schema_hash,status,description)
VALUES
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.episode','sdar.runtime-episode',1,'sdar_core','sdar_core.episode','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.request','sdar.runtime-request',1,'sdar_core','sdar_core.request_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.a2a_task','sdar.runtime-a2a-task',1,'sdar_core','sdar_core.a2a_task_state','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.goal','sdar.runtime-goal',1,'sdar_core','sdar_core.goal_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.goal_contract','sdar.runtime-goal-contract',1,'sdar_core','sdar_core.execution_basis','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.goal_patch','sdar.runtime-goal-patch',1,'sdar_core','sdar_core.event_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.plan','sdar.runtime-plan',1,'sdar_core','sdar_core.plan_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.plan_step','sdar.runtime-plan-step',1,'sdar_core','sdar_core.plan_step','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.state_transition','sdar.runtime-state-transition',1,'sdar_core','sdar_core.state_transition','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.decision','sdar.runtime-decision',1,'sdar_core','sdar_core.decision_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.policy_decision','sdar.runtime-policy-decision',1,'sdar_core','sdar_core.policy_decision','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.execution_gate','sdar.runtime-execution-gate',1,'sdar_core','sdar_core.execution_gate_decision','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.human_confirmation','sdar.runtime-human-confirmation',1,'sdar_core','sdar_core.human_confirmation','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.action','sdar.runtime-action',1,'sdar_core','sdar_core.action_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.receipt','sdar.runtime-receipt',1,'sdar_core','sdar_core.action_receipt','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.verification','sdar.runtime-verification',1,'sdar_core','sdar_core.verification_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.outcome','sdar.runtime-outcome',1,'sdar_core','sdar_core.episode_outcome','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime','runtime.run_seal','sdar.runtime-run-seal',1,'sdar_core','sdar_core.run_seal','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.usage_snapshot','sdar.skill-usage-snapshot',1,'sdar_core','sdar_core.skill_usage_snapshot','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.candidate','sdar.skill-candidate',1,'sdar_core','sdar_core.skill_candidate_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.applicability','sdar.skill-applicability',1,'sdar_core','sdar_core.skill_applicability_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.context_resolution','sdar.skill-context-resolution',1,'sdar_core','sdar_core.skill_context_resolution','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.selection','sdar.skill-selection',1,'sdar_core','sdar_core.skill_selection_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.mode_selection','sdar.skill-mode-selection',1,'sdar_core','sdar_core.skill_mode_selection','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.composition','sdar.skill-composition',1,'sdar_core','sdar_core.skill_composition_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.composition_edge','sdar.skill-composition-edge',1,'sdar_core','sdar_core.skill_composition_edge','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.capability_slot_resolution','sdar.skill-capability-slot-resolution',1,'sdar_core','sdar_core.skill_capability_slot_resolution','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.procedure_compilation','sdar.skill-procedure-compilation',1,'sdar_core','sdar_core.skill_procedure_compilation','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.plan_compliance','sdar.skill-plan-compliance',1,'sdar_core','sdar_core.skill_plan_compliance','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.execution','sdar.skill-execution',1,'sdar_core','sdar_core.skill_execution_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.execution_event','sdar.skill-execution-event',1,'sdar_core','sdar_core.event_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.execution_reference','sdar.skill-execution-reference',1,'sdar_core','sdar_core.skill_execution_relation','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.failure_propagation','sdar.skill-failure-propagation',1,'sdar_core','sdar_core.skill_failure_propagation','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill','skill.evidence_requirement','sdar.skill-evidence-requirement',1,'sdar_core','sdar_core.skill_evidence_requirement','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.tool_call','sdar.mcp-tool-call',1,'sdar_core','sdar_core.tool_call_record','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.availability','sdar.mcp-task-availability',1,'sdar_core','sdar_core.task_availability_check','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.remote_binding','sdar.mcp-remote-binding',1,'sdar_core','sdar_core.remote_task_binding','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.observation','sdar.mcp-task-observation',1,'sdar_core','sdar_core.remote_task_observation','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.control_event','sdar.mcp-task-control-event',1,'sdar_core','sdar_core.remote_task_control_event','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.poll_attempt','sdar.mcp-task-poll-attempt',1,'sdar_core','sdar_core.remote_task_poll_attempt','buffered','diagnostic','optional',1,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.input_link','sdar.mcp-task-input-link',1,'sdar_core','sdar_core.remote_task_input_link','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.cancel','sdar.mcp-task-cancel',1,'sdar_core','sdar_core.remote_task_cancel','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.reconciliation','sdar.mcp-task-reconciliation',1,'sdar_core','sdar_core.remote_task_reconciliation','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.continuation_snapshot','sdar.mcp-continuation-snapshot',1,'sdar_core','sdar_core.workflow_continuation_snapshot','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task','mcp_task.continuation_attempt','sdar.mcp-continuation-attempt',1,'sdar_core','sdar_core.workflow_continuation_attempt','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability','capability.definition','sdar.capability-definition',1,'sdar_core','sdar_core.node_capability_version_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability','capability.implementation_binding','sdar.capability-implementation-binding',1,'sdar_core','sdar_core.capability_implementation_binding_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability','capability.readiness','sdar.capability-readiness',1,'sdar_core','sdar_core.capability_readiness_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability','capability.task_binding','sdar.capability-task-binding',1,'sdar_core','sdar_core.task_capability_binding_fact','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability','capability.execution_attempt','sdar.capability-execution-attempt',1,'sdar_core','sdar_core.task_capability_attempt_fact','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability','capability.a2a_exposure','sdar.capability-a2a-exposure',1,'sdar_core','sdar_core.a2a_exposure_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability','capability.agent_card_revision','sdar.capability-agent-card-revision',1,'sdar_core','sdar_core.agent_card_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.episode','sdar.experience-episode',1,'sdar_core','sdar_core.goal_experience_episode_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.trace','sdar.experience-trace',1,'sdar_core','sdar_core.experience_trace_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.trace_event','sdar.experience-trace-event',1,'sdar_core','sdar_core.experience_trace_event_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.activity','sdar.experience-activity',1,'sdar_core','sdar_core.experience_activity_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.process_variant','sdar.experience-process-variant',1,'sdar_core','sdar_core.process_variant_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.workflow_pattern','sdar.experience-workflow-pattern',1,'sdar_core','sdar_core.workflow_pattern_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.workflow_pattern_dependency','sdar.experience-workflow-pattern-dependency',1,'sdar_core','sdar_core.workflow_pattern_dependency_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.recovery_pattern','sdar.experience-recovery-pattern',1,'sdar_core','sdar_core.recovery_pattern_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.planning_correction','sdar.experience-planning-correction',1,'sdar_core','sdar_core.planning_correction_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience','experience.interaction_episode','sdar.experience-interaction-episode',1,'sdar_core','sdar_core.interaction_episode_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay','replay.dataset','sdar.replay-dataset',1,'sdar_core','sdar_core.replay_dataset_version_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay','replay.case','sdar.replay-case',1,'sdar_core','sdar_core.replay_case_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay','replay.run','sdar.replay-run',1,'sdar_core','sdar_core.replay_run_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay','replay.case_result','sdar.replay-case-result',1,'sdar_core','sdar_core.replay_case_result_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay','replay.metric_result','sdar.replay-metric-result',1,'sdar_core','sdar_core.replay_metric_result_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay','replay.counterexample','sdar.replay-counterexample',1,'sdar_core','sdar_core.counterexample_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact','artifact.lifecycle','sdar.artifact-lifecycle',1,'sdar_core','sdar_core.artifact_lifecycle_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact','artifact.validation','sdar.artifact-validation',1,'sdar_core','sdar_core.artifact_validation_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact','artifact.retrieval','sdar.artifact-retrieval',1,'sdar_core','sdar_core.artifact_retrieval_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact','artifact.usage','sdar.artifact-usage',1,'sdar_core','sdar_core.artifact_usage_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact','artifact.feedback','sdar.artifact-feedback',1,'sdar_core','sdar_core.artifact_feedback_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact','artifact.promotion','sdar.artifact-promotion',1,'sdar_core','sdar_core.artifact_promotion_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.profile_revision','sdar.node-profile-revision',1,'sdar_core','sdar_core.node_profile_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.health_observation','sdar.node-health-observation',1,'sdar_core','sdar_core.node_health_observation_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.configuration_revision','sdar.node-configuration-revision',1,'sdar_core','sdar_core.node_configuration_revision_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.configuration_apply_ack','sdar.node-configuration-apply-ack',1,'sdar_core','sdar_core.node_configuration_apply_ack_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.configuration_lkg_transition','sdar.node-configuration-lkg-transition',1,'sdar_core','sdar_core.node_configuration_lkg_transition_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.llm_provider_revision','sdar.node-llm-provider-revision',1,'sdar_core','sdar_core.node_llm_provider_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.model_route_revision','sdar.node-model-route-revision',1,'sdar_core','sdar_core.node_model_route_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.smpp_source_revision','sdar.node-smpp-source-revision',1,'sdar_core','sdar_core.node_smpp_source_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.mcp_provider_binding_revision','sdar.node-mcp-provider-binding-revision',1,'sdar_core','sdar_core.node_mcp_provider_binding_revision_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.skill_governance','sdar.node-skill-governance',1,'sdar_core','sdar_core.node_skill_governance_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.plan_template_governance','sdar.node-plan-template-governance',1,'sdar_core','sdar_core.node_plan_template_governance_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.capability_revision','sdar.node-capability-revision',1,'sdar_core','sdar_core.node_capability_version_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.capability_readiness','sdar.node-capability-readiness',1,'sdar_core','sdar_core.capability_readiness_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.a2a_exposure','sdar.node-a2a-exposure',1,'sdar_core','sdar_core.a2a_exposure_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.agent_card_revision','sdar.node-agent-card-revision',1,'sdar_core','sdar_core.agent_card_revision_fact','durable_projection','supporting','conditional',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.management_operation','sdar.node-management-operation',1,'sdar_core','sdar_core.node_management_operation_fact','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.audit_event','sdar.node-audit-event',1,'sdar_core','sdar_core.node_audit_event_fact','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.node_event','sdar.node-event',1,'sdar_core','sdar_core.node_event_fact','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.telemetry_configuration','sdar.node-telemetry-configuration',1,'sdar_core','sdar_core.node_telemetry_export_configuration_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.telemetry_delivery','sdar.node-telemetry-delivery',1,'sdar_core','sdar_core.node_telemetry_export_delivery_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control','node_control.telemetry_ack','sdar.node-telemetry-ack',1,'sdar_core','sdar_core.node_telemetry_export_ack_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence','evidence.episode_manifest','sdar.evidence-episode-manifest',1,'sdar_core','sdar_core.episode_evidence_manifest_fact','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence','evidence.quality_issue','sdar.evidence-quality-issue',1,'sdar_core','sdar_core.evidence_quality_issue','transactional','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence','evidence.projection_issue','sdar.evidence-projection-issue',1,'sdar_core','sdar_core.evidence_projection_issue_fact','durable_projection','required','required',0,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence','evidence.source_checkpoint','sdar.evidence-source-checkpoint',1,'sdar_core','sdar_core.evidence_source_checkpoint_fact','durable_projection','diagnostic','optional',1,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence','evidence.export_status','sdar.evidence-export-status',1,'sdar_core','sdar_core.evidence_export_status_fact','durable_projection','diagnostic','optional',1,'pending_runtime_freeze','','candidate','Pre-aligned target; exact Runtime payload schema pending v1.4.1 Phase 14 freeze.');

INSERT INTO sdar_meta.source_mapping_definition
(tenant_id,project_id,mapping_version,contract_version,record_type,source_system,source_authority,source_table,source_table_status,source_identity_rule,projection_id,target_table,mapping_hash,mapping_document,status)
VALUES
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.episode','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.episode','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.request','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.request_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.a2a_task','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.a2a_task_state','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.goal','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.goal_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.goal_contract','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.execution_basis','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.goal_patch','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.event_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.plan','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.plan_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.plan_step','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.plan_step','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.state_transition','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.state_transition','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.decision','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.decision_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.policy_decision','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.policy_decision','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.execution_gate','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.execution_gate_decision','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.human_confirmation','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.human_confirmation','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.action','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.action_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.receipt','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.action_receipt','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.verification','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.verification_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.outcome','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.episode_outcome','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','runtime.run_seal','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_runtime_to_core','sdar_core.run_seal','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.usage_snapshot','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_usage_snapshot','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.candidate','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_candidate_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.applicability','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_applicability_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.context_resolution','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_context_resolution','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.selection','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_selection_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.mode_selection','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_mode_selection','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.composition','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_composition_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.composition_edge','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_composition_edge','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.capability_slot_resolution','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_capability_slot_resolution','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.procedure_compilation','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_procedure_compilation','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.plan_compliance','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_plan_compliance','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.execution','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_execution_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.execution_event','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.event_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.execution_reference','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_execution_relation','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.failure_propagation','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_failure_propagation','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','skill.evidence_requirement','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_skill_to_core','sdar_core.skill_evidence_requirement','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.tool_call','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.tool_call_record','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.availability','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.task_availability_check','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.remote_binding','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.remote_task_binding','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.observation','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.remote_task_observation','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.control_event','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.remote_task_control_event','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.poll_attempt','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.remote_task_poll_attempt','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.input_link','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.remote_task_input_link','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.cancel','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.remote_task_cancel','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.reconciliation','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.remote_task_reconciliation','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.continuation_snapshot','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.workflow_continuation_snapshot','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','mcp_task.continuation_attempt','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_mcp_task_to_core','sdar_core.workflow_continuation_attempt','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability.definition','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_capability_to_core','sdar_core.node_capability_version_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability.implementation_binding','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_capability_to_core','sdar_core.capability_implementation_binding_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability.readiness','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_capability_to_core','sdar_core.capability_readiness_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability.task_binding','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_capability_to_core','sdar_core.task_capability_binding_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability.execution_attempt','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_capability_to_core','sdar_core.task_capability_attempt_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability.a2a_exposure','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_capability_to_core','sdar_core.a2a_exposure_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','capability.agent_card_revision','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_capability_to_core','sdar_core.agent_card_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.episode','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.goal_experience_episode_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.trace','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.experience_trace_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.trace_event','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.experience_trace_event_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.activity','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.experience_activity_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.process_variant','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.process_variant_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.workflow_pattern','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.workflow_pattern_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.workflow_pattern_dependency','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.workflow_pattern_dependency_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.recovery_pattern','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.recovery_pattern_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.planning_correction','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.planning_correction_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','experience.interaction_episode','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_experience_to_core','sdar_core.interaction_episode_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay.dataset','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_replay_to_core','sdar_core.replay_dataset_version_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay.case','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_replay_to_core','sdar_core.replay_case_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay.run','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_replay_to_core','sdar_core.replay_run_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay.case_result','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_replay_to_core','sdar_core.replay_case_result_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay.metric_result','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_replay_to_core','sdar_core.replay_metric_result_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','replay.counterexample','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_replay_to_core','sdar_core.counterexample_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact.lifecycle','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_artifact_to_core','sdar_core.artifact_lifecycle_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact.validation','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_artifact_to_core','sdar_core.artifact_validation_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact.retrieval','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_artifact_to_core','sdar_core.artifact_retrieval_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact.usage','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_artifact_to_core','sdar_core.artifact_usage_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact.feedback','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_artifact_to_core','sdar_core.artifact_feedback_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','artifact.promotion','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_artifact_to_core','sdar_core.artifact_promotion_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.profile_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_profile_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.health_observation','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_health_observation_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.configuration_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_configuration_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.configuration_apply_ack','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_configuration_apply_ack_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.configuration_lkg_transition','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_configuration_lkg_transition_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.llm_provider_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_llm_provider_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.model_route_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_model_route_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.smpp_source_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_smpp_source_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.mcp_provider_binding_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_mcp_provider_binding_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.skill_governance','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_skill_governance_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.plan_template_governance','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_plan_template_governance_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.capability_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_capability_version_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.capability_readiness','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.capability_readiness_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.a2a_exposure','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.a2a_exposure_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.agent_card_revision','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.agent_card_revision_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.management_operation','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_management_operation_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.audit_event','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_audit_event_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.node_event','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_event_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.telemetry_configuration','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_telemetry_export_configuration_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.telemetry_delivery','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_telemetry_export_delivery_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','node_control.telemetry_ack','node_control','Control PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_node_control_to_core','sdar_core.node_telemetry_export_ack_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence.episode_manifest','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_evidence_to_core','sdar_core.episode_evidence_manifest_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence.quality_issue','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_evidence_to_core','sdar_core.evidence_quality_issue','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence.projection_issue','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_evidence_to_core','sdar_core.evidence_projection_issue_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence.source_checkpoint','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_evidence_to_core','sdar_core.evidence_source_checkpoint_fact','','{}','candidate'),
('global','global','1.4.1-rc.1','sdar.evidence/v1','evidence.export_status','runtime','Runtime PostgreSQL','','pending_v1.4.1_phase14_freeze','sourceSystem+sourceTable+sourceRecordId+sourceRevision/hash+schemaName+schemaVersion','v141_evidence_to_core','sdar_core.evidence_export_status_fact','','{}','candidate');

INSERT INTO sdar_meta.warehouse_release_definition
(tenant_id,project_id,release_version,runtime_baseline,evidence_contract,record_catalog_hash,source_mapping_hash,migration_range,implementation_status,validation_json,status)
VALUES ('global','global','1.4.1-rc.1','SDAR v1.4.0 main@cc0719f4db83dc64dc6e32e6dcad2d558823e796','sdar.evidence/v1','744340b694681e8d91fac62b7b958600149edf3d3177ea455b3ac842f7d989f8','d85bfcec75543170f778c494a050c3233072fa295a613ebe9165c7d55ceeef1d','00..17','static_validated_runtime_contract_pending','{"clickhouseRuntimeValidation":"pending","runtimeEvidenceContract":"pending_phase14"}','candidate');
