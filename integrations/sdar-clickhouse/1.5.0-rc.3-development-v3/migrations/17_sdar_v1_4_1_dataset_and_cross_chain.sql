-- SDAR ClickHouse Schema 1.4.1-rc.1 / evaluation dataset assets and cross-chain read models.
-- Dataset definitions belong to sdar_meta; evaluation executions/results belong to sdar_mart.

CREATE TABLE IF NOT EXISTS sdar_meta.dataset_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    dataset_id String,
    dataset_name String,
    dataset_scope LowCardinality(String),
    owner String,
    description String,
    lifecycle_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,dataset_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.dataset_version
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    dataset_id String,
    dataset_version String,
    dataset_hash FixedString(64),
    scenario_family_refs Array(String),
    case_count UInt64,
    split_definition_ref String,
    approval_status LowCardinality(String),
    lifecycle_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,dataset_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.scenario_family_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    scenario_family_id String,
    family_version UInt32,
    domain LowCardinality(String),
    description String,
    parameter_schema_ref String,
    lifecycle_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,scenario_family_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.evaluation_case_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    case_id String,
    case_name String,
    scenario_family_id String,
    risk_level LowCardinality(String),
    source LowCardinality(String),
    lifecycle_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,case_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.evaluation_case_version
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    case_id String,
    case_version UInt32,
    dataset_id String,
    dataset_version String,
    profile_refs Array(String),
    input_artifact_ref String,
    expected_contract_ref String,
    fault_injection_ref String DEFAULT '',
    case_hash FixedString(64),
    review_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,case_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.expected_contract_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    expected_contract_id String,
    contract_version UInt32,
    case_id String,
    must_events Array(String),
    forbidden_events Array(String),
    allowed_terminal_states Array(String),
    partial_order_json String CODEC(ZSTD(3)),
    invariant_json String CODEC(ZSTD(3)),
    contract_hash FixedString(64),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,expected_contract_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.trajectory_constraint_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    constraint_id String,
    constraint_version UInt32,
    expected_contract_id String,
    predecessor String,
    successor String,
    relation LowCardinality(String),
    condition_json String DEFAULT '{}' CODEC(ZSTD(3)),
    blocking UInt8,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,constraint_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.fault_injection_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    fault_id String,
    fault_version UInt32,
    fault_type String,
    trigger_json String CODEC(ZSTD(3)),
    duration_ms UInt64,
    expected_effect_json String CODEC(ZSTD(3)),
    safety_class LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,fault_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.judge_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    judge_id String,
    judge_version String,
    judge_type LowCardinality(String),
    model_ref String DEFAULT '',
    prompt_ref String DEFAULT '',
    output_schema_ref String,
    confidence_policy_json String CODEC(ZSTD(3)),
    calibration_dataset_ref String DEFAULT '',
    lifecycle_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,judge_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.human_label_policy
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    policy_id String,
    policy_version UInt32,
    risk_sampling_json String CODEC(ZSTD(3)),
    reviewer_count UInt16,
    conflict_resolution_policy String,
    lifecycle_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,policy_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_meta.dataset_split_definition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    split_definition_id String,
    split_version UInt32,
    strategy LowCardinality(String),
    scenario_family_isolation UInt8,
    leakage_policy_json String CODEC(ZSTD(3)),
    split_ratios_json String CODEC(ZSTD(3)),
    lifecycle_status LowCardinality(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id,project_id,split_definition_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.dataset_run
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_run_id String,
    dataset_id String,
    dataset_version String,
    agent_id String,
    agent_version String,
    evaluation_profile_refs Array(String),
    run_status LowCardinality(String),
    total_cases UInt64,
    passed_cases UInt64,
    failed_cases UInt64,
    fatal_cases UInt64,
    hard_gate_failed_cases UInt64,
    run_config_hash FixedString(64),
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_run_id) % 64
ORDER BY (tenant_id,project_id,dataset_run_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.dataset_case_execution
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_run_id String,
    case_execution_id String,
    case_id String,
    case_version UInt32,
    episode_id String,
    execution_status LowCardinality(String),
    evidence_manifest_id String DEFAULT '',
    evidence_snapshot_hash String DEFAULT '',
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_run_id) % 64
ORDER BY (tenant_id,project_id,dataset_run_id,case_execution_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.dataset_case_result
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_run_id String,
    case_execution_id String,
    case_id String,
    result_status LowCardinality(String),
    passed UInt8,
    level LowCardinality(String),
    total_score Float64,
    fatal_error_ids Array(String),
    failed_gate_ids Array(String),
    profile_scores_json String CODEC(ZSTD(3)),
    result_hash FixedString(64),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_run_id) % 64
ORDER BY (tenant_id,project_id,dataset_run_id,case_execution_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.judge_result
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_run_id String,
    case_execution_id String,
    judge_id String,
    judge_version String,
    metric_id String,
    score UInt8,
    confidence Float32,
    evidence_refs Array(String),
    reason_summary String,
    uncertainty_json String DEFAULT '[]' CODEC(ZSTD(3)),
    result_hash FixedString(64),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_run_id) % 64
ORDER BY (tenant_id,project_id,dataset_run_id,case_execution_id,judge_id,metric_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.human_review_result
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_run_id String,
    case_execution_id String,
    review_id String,
    reviewer_id String,
    review_status LowCardinality(String),
    final_disposition LowCardinality(String),
    label_json String CODEC(ZSTD(3)),
    conflict_resolution_ref String DEFAULT '',
    reviewed_at DateTime64(3, 'UTC'),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_run_id) % 64
ORDER BY (tenant_id,project_id,dataset_run_id,case_execution_id,review_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.calibration_result
(
    tenant_id String,
    project_id String,
    record_id UUID,
    calibration_id String,
    judge_id String,
    judge_version String,
    dataset_id String,
    dataset_version String,
    sample_count UInt64,
    agreement_rate Float64,
    weighted_kappa Float64,
    confidence_error Float64,
    calibration_status LowCardinality(String),
    report_artifact_ref String,
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(calibration_id) % 64
ORDER BY (tenant_id,project_id,calibration_id,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.agent_version_dataset_summary
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_id String,
    dataset_version String,
    agent_id String,
    agent_version String,
    case_count UInt64,
    pass_rate Float64,
    average_score Float64,
    p10_score Float64,
    fatal_error_count UInt64,
    hard_gate_failure_count UInt64,
    summary_status LowCardinality(String),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_id) % 64
ORDER BY (tenant_id,project_id,dataset_id,dataset_version,agent_id,agent_version,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.skill_version_dataset_summary
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_id String,
    dataset_version String,
    skill_id String,
    skill_version UInt64,
    execution_count UInt64,
    pass_rate Float64,
    average_score Float64,
    degraded_rate Float64,
    failure_rate Float64,
    summary_status LowCardinality(String),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_id) % 64
ORDER BY (tenant_id,project_id,dataset_id,dataset_version,skill_id,skill_version,record_id);

CREATE TABLE IF NOT EXISTS sdar_mart.provider_dataset_summary
(
    tenant_id String,
    project_id String,
    record_id UUID,
    dataset_id String,
    dataset_version String,
    provider_id String,
    operation_name String,
    execution_count UInt64,
    pass_rate Float64,
    average_latency_ms Float64,
    availability_failure_rate Float64,
    cancellation_uncertain_rate Float64,
    summary_status LowCardinality(String),
    evaluated_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY cityHash64(dataset_id) % 64
ORDER BY (tenant_id,project_id,dataset_id,dataset_version,provider_id,operation_name,record_id);

CREATE VIEW IF NOT EXISTS sdar_core.v_skill_execution_current AS
SELECT * FROM sdar_core.skill_execution_record
ORDER BY record_version DESC, ingested_at DESC
LIMIT 1 BY tenant_id,project_id,skill_execution_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_skill_execution_tree AS
SELECT p.tenant_id,p.project_id,p.episode_id,p.skill_execution_id AS parent_execution_id,
       c.skill_execution_id AS child_execution_id,c.skill_id,c.skill_version,
       c.execution_status,c.failure_policy,c.degraded,c.missing_effects
FROM sdar_core.v_skill_execution_current AS p
LEFT JOIN sdar_core.v_skill_execution_current AS c
 ON p.tenant_id=c.tenant_id AND p.project_id=c.project_id
 AND p.skill_execution_id=c.parent_skill_execution_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_goal_skill_plan_action_chain AS
SELECT g.tenant_id,g.project_id,g.episode_id,g.goal_id,g.goal_version,
       s.skill_execution_id,s.skill_id,s.skill_version,s.execution_status,
       p.plan_id,p.plan_version,a.action_id,a.action_name,a.action_status,
       r.receipt_id,r.business_status,v.verification_id,v.verification_result
FROM sdar_core.goal_record AS g
LEFT JOIN sdar_core.v_skill_execution_current AS s ON g.tenant_id=s.tenant_id AND g.project_id=s.project_id AND g.episode_id=s.episode_id
LEFT JOIN sdar_core.plan_record AS p ON s.tenant_id=p.tenant_id AND s.project_id=p.project_id AND s.plan_id=p.plan_id
LEFT JOIN sdar_core.action_record AS a ON p.tenant_id=a.tenant_id AND p.project_id=a.project_id AND p.plan_id=a.plan_id
LEFT JOIN sdar_core.action_receipt AS r ON a.tenant_id=r.tenant_id AND a.project_id=r.project_id AND a.action_id=r.action_id
LEFT JOIN sdar_core.verification_record AS v ON r.tenant_id=v.tenant_id AND r.project_id=v.project_id AND r.receipt_id=v.receipt_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_task_capability_execution_chain_v2 AS
SELECT c.*,s.skill_execution_id,s.skill_id,s.skill_version,s.execution_status,
       rb.binding_id AS remote_binding_id,rb.remote_task_id,
       v.verification_id,v.verification_result
FROM sdar_core.v_task_capability_execution_chain AS c
LEFT JOIN sdar_core.v_skill_execution_current AS s ON c.tenant_id=s.tenant_id AND c.project_id=s.project_id AND c.task_id=s.a2a_task_id
LEFT JOIN sdar_core.remote_task_binding AS rb ON s.tenant_id=rb.tenant_id AND s.project_id=rb.project_id AND s.skill_execution_id=rb.skill_execution_id
LEFT JOIN sdar_core.verification_record AS v ON rb.tenant_id=v.tenant_id AND rb.project_id=v.project_id AND rb.binding_id=v.verification_binding_id;

CREATE VIEW IF NOT EXISTS sdar_core.v_remote_task_evidence_chain AS
SELECT b.tenant_id,b.project_id,b.episode_id,b.binding_id,b.remote_task_id,b.protocol_status,b.local_state,
       countDistinct(o.observation_id) AS observation_count,
       countDistinct(c.control_event_id) AS control_event_count,
       countDistinct(a.continuation_attempt_id) AS continuation_attempt_count,
       maxIf(a.attempt_status,a.ended_at IS NOT NULL) AS continuation_terminal_status
FROM sdar_core.remote_task_binding AS b
LEFT JOIN sdar_core.remote_task_observation AS o ON b.tenant_id=o.tenant_id AND b.project_id=o.project_id AND b.binding_id=o.binding_id
LEFT JOIN sdar_core.remote_task_control_event AS c ON b.tenant_id=c.tenant_id AND b.project_id=c.project_id AND b.binding_id=c.binding_id
LEFT JOIN sdar_core.workflow_continuation_attempt AS a ON c.tenant_id=a.tenant_id AND c.project_id=a.project_id AND c.control_event_id=a.attempt_control_event_id
GROUP BY b.tenant_id,b.project_id,b.episode_id,b.binding_id,b.remote_task_id,b.protocol_status,b.local_state;

CREATE VIEW IF NOT EXISTS sdar_core.v_episode_evaluation_readiness_v141 AS
SELECT m.*,r.readiness_status AS legacy_readiness_status,
       if(m.manifest_status='complete' AND m.failed_required_records=0 AND m.pending_required_records=0,'ready',
          if(m.manifest_status='degraded' AND m.failed_required_records=0,'degraded','not_ready')) AS readiness_status
FROM sdar_core.v_episode_evidence_manifest_current AS m
LEFT JOIN sdar_core.evaluation_readiness AS r ON m.tenant_id=r.tenant_id AND m.project_id=r.project_id AND toUUIDOrZero(m.episode_id)=r.episode_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_dataset_case_latest AS
SELECT * FROM sdar_meta.evaluation_case_version
ORDER BY case_version DESC,updated_at DESC
LIMIT 1 BY tenant_id,project_id,case_id,dataset_id,dataset_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_dataset_release_gate AS
SELECT c.dataset_run_id,r.dataset_id,r.dataset_version,
       count() AS case_count,countIf(c.passed=1) AS passed_cases,
       countIf(c.level='F') AS fatal_cases,countIf(c.level='HG') AS hard_gate_failed_cases,
       avg(c.total_score) AS average_score,
       if(fatal_cases=0 AND hard_gate_failed_cases=0 AND passed_cases/case_count>=0.85,'pass','fail') AS release_gate
FROM sdar_mart.dataset_case_result AS c
ANY INNER JOIN sdar_mart.dataset_run AS r
  ON c.tenant_id=r.tenant_id
 AND c.project_id=r.project_id
 AND c.dataset_run_id=r.dataset_run_id
GROUP BY c.dataset_run_id,r.dataset_id,r.dataset_version;

CREATE VIEW IF NOT EXISTS sdar_core.v_source_projection_coverage_detail AS
SELECT c.source_system,c.source_table,c.record_type,
       count() AS projected_rows,uniqExact(c.source_record_id) AS source_records,
       countIf(c.evaluation_role='required') AS required_rows,
       countIf(i.issue_status='open') AS open_issue_rows,
       max(c.recorded_at) AS last_recorded_at
FROM sdar_core.canonical_evidence_record AS c
LEFT JOIN sdar_core.evidence_projection_issue_fact AS i
 ON c.tenant_id=i.tenant_id AND c.project_id=i.project_id
 AND c.evidence_record_id=i.affected_evidence_record_id
GROUP BY c.source_system,c.source_table,c.record_type;
