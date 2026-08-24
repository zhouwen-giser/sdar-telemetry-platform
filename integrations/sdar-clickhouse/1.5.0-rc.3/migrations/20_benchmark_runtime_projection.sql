-- SDAR ClickHouse Schema 1.5.0-rc.3
-- Migration 20: Benchmark runtime projection model.
-- Benchmark PostgreSQL is authoritative; all rows here are immutable analytical projections.

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_candidate_snapshot
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    candidate_id String,
    snapshot_id String,
    content_hash String,
    runtime_version String,
    runtime_commit String,
    runtime_image_digest String DEFAULT '',
    evidence_contract_version String,
    evidence_contract_hash String,
    evidence_registry_hash String,
    skill_count UInt32,
    skills_json String CODEC(ZSTD(3)),
    provider_count UInt32,
    providers_json String CODEC(ZSTD(3)),
    model_count UInt32,
    models_json String CODEC(ZSTD(3)),
    node_configuration_hash String,
    environment_image_digests Array(String),
    architecture String DEFAULT '',
    runtime_platform String DEFAULT '',
    snapshot_json String CODEC(ZSTD(3)),
    source_system LowCardinality(String) DEFAULT 'benchmark_postgres',
    source_table String DEFAULT 'candidate_snapshot',
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_id String DEFAULT 'benchmark.execution',
    projection_version String DEFAULT '0.1.0',
    projection_revision UInt64 DEFAULT 1,
    created_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_candidate_hashes CHECK
        match(content_hash, '^sha256:[0-9a-f]{64}$') AND
        match(evidence_contract_hash, '^sha256:[0-9a-f]{64}$') AND
        match(evidence_registry_hash, '^sha256:[0-9a-f]{64}$') AND
        match(node_configuration_hash, '^sha256:[0-9a-f]{64}$') AND
        match(source_content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_candidate_json CHECK isValidJSON(skills_json) AND isValidJSON(providers_json) AND isValidJSON(models_json) AND isValidJSON(snapshot_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(snapshot_id) % 64
ORDER BY (tenant_id, project_id, snapshot_id, content_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_run
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String,
    benchmark_version String,
    contract_release_id String,
    dataset_id String,
    dataset_version String,
    dataset_hash String,
    candidate_snapshot_id String,
    candidate_snapshot_hash String,
    environment_snapshot_hash String,
    run_status LowCardinality(String),
    total_cases UInt32,
    required_cases UInt32,
    optional_cases UInt32,
    ready_cases UInt32,
    degraded_cases UInt32,
    not_ready_cases UInt32,
    passed_cases UInt32,
    failed_cases UInt32,
    fatal_cases UInt32,
    proven_fatal_cases UInt32,
    hard_gate_failed_cases UInt32,
    valid_evaluation_cases UInt32,
    invalid_cases UInt32,
    candidate_error_cases UInt32,
    benchmark_error_cases UInt32,
    evidence_error_cases UInt32,
    run_config_hash String,
    provenance_json String CODEC(ZSTD(3)),
    source_system LowCardinality(String) DEFAULT 'benchmark_postgres',
    source_table String DEFAULT 'benchmark_run',
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_id String DEFAULT 'benchmark.execution',
    projection_version String DEFAULT '0.1.0',
    projection_revision UInt64 DEFAULT 1,
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_run_status CHECK run_status IN ('created','validating','provisioning','ready','dispatching','running','awaiting_terminal','awaiting_evidence','snapshotting','evaluating','aggregating','completed','partial','blocked','failed','cancelled','invalid'),
    CONSTRAINT ck_benchmark_run_hashes CHECK match(dataset_hash, '^sha256:[0-9a-f]{64}$') AND match(candidate_snapshot_hash, '^sha256:[0-9a-f]{64}$') AND match(environment_snapshot_hash, '^sha256:[0-9a-f]{64}$') AND match(run_config_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_run_json CHECK isValidJSON(provenance_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, projection_revision);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_case_execution
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String,
    case_execution_id String,
    case_id String,
    case_version UInt32,
    case_hash String,
    expected_contract_id String,
    expected_contract_version UInt32,
    expected_contract_hash String,
    evaluation_binding_id String,
    evaluation_binding_version UInt32,
    evaluation_binding_hash String,
    track LowCardinality(String),
    scenario_family String,
    risk_level LowCardinality(String),
    requirement_level LowCardinality(String),
    planned_repeat_count UInt16,
    execution_status LowCardinality(String),
    error_class LowCardinality(String) DEFAULT '',
    error_code String DEFAULT '',
    result_status LowCardinality(String) DEFAULT 'pending',
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_case_execution_track CHECK track IN ('core','skill','mcp-task','node-control','cross-chain'),
    CONSTRAINT ck_benchmark_case_execution_risk CHECK risk_level IN ('low','medium','high','critical'),
    CONSTRAINT ck_benchmark_case_execution_requirement CHECK requirement_level IN ('required','optional'),
    CONSTRAINT ck_benchmark_case_execution_hashes CHECK match(case_hash, '^sha256:[0-9a-f]{64}$') AND match(expected_contract_hash, '^sha256:[0-9a-f]{64}$') AND match(evaluation_binding_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, case_execution_id, projection_revision);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_case_repetition
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String,
    case_execution_id String,
    repetition_id String,
    repeat_index UInt16,
    candidate_snapshot_id String,
    candidate_snapshot_hash String,
    candidate_task_id String DEFAULT '',
    candidate_context_id String DEFAULT '',
    correlation_id String DEFAULT '',
    episode_id String DEFAULT '',
    execution_status LowCardinality(String),
    terminal_status LowCardinality(String) DEFAULT '',
    error_class LowCardinality(String) DEFAULT '',
    error_code String DEFAULT '',
    evidence_bundle_snapshot_id String DEFAULT '',
    evidence_bundle_snapshot_hash String DEFAULT '',
    evaluation_id String DEFAULT '',
    started_at DateTime64(3, 'UTC'),
    terminal_observed_at Nullable(DateTime64(3, 'UTC')),
    completed_at Nullable(DateTime64(3, 'UTC')),
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_repetition_index CHECK repeat_index > 0,
    CONSTRAINT ck_benchmark_repetition_candidate CHECK match(candidate_snapshot_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_repetition_bundle CHECK length(evidence_bundle_snapshot_hash)=0 OR match(evidence_bundle_snapshot_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_repetition_source_hash CHECK match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, case_execution_id, repetition_id, projection_revision);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_evidence_bundle_snapshot
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    snapshot_id String,
    episode_id String,
    source LowCardinality(String),
    evidence_contract_version String,
    evidence_contract_hash String,
    evidence_registry_hash String,
    manifest_id String,
    manifest_revision UInt32,
    manifest_status LowCardinality(String),
    manifest_hash String,
    record_count UInt64,
    first_sequence UInt64,
    last_sequence UInt64,
    required_families Array(String),
    completed_families Array(String),
    missing_families Array(String),
    record_index_hash String,
    bundle_hash String,
    artifact_uri String,
    artifact_content_hash String,
    artifact_media_type String,
    artifact_size_bytes UInt64,
    snapshot_json String CODEC(ZSTD(3)),
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    captured_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_bundle_source CHECK source IN ('sdar-postgres','evidence-export','fixture','clickhouse'),
    CONSTRAINT ck_benchmark_bundle_manifest CHECK manifest_revision > 0 AND last_sequence >= first_sequence,
    CONSTRAINT ck_benchmark_bundle_hashes CHECK
        match(evidence_contract_hash, '^sha256:[0-9a-f]{64}$') AND match(evidence_registry_hash, '^sha256:[0-9a-f]{64}$') AND
        match(manifest_hash, '^sha256:[0-9a-f]{64}$') AND match(record_index_hash, '^sha256:[0-9a-f]{64}$') AND
        match(bundle_hash, '^sha256:[0-9a-f]{64}$') AND match(artifact_content_hash, '^sha256:[0-9a-f]{64}$') AND
        match(source_content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_bundle_json CHECK isValidJSON(snapshot_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(snapshot_id) % 64
ORDER BY (tenant_id, project_id, snapshot_id, bundle_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_evidence_bundle_record
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    snapshot_id String,
    bundle_hash String,
    evidence_sequence UInt64,
    evidence_record_id String,
    record_type String,
    schema_name String,
    schema_version UInt32,
    payload_hash String,
    canonical_record_hash String,
    source_system String DEFAULT '',
    occurred_at Nullable(DateTime64(3, 'UTC')),
    row_hash String,
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_bundle_record_hashes CHECK match(bundle_hash, '^sha256:[0-9a-f]{64}$') AND match(payload_hash, '^sha256:[0-9a-f]{64}$') AND match(canonical_record_hash, '^sha256:[0-9a-f]{64}$') AND match(row_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(snapshot_id) % 64
ORDER BY (tenant_id, project_id, snapshot_id, evidence_sequence, evidence_record_id, row_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_case_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String,
    case_execution_id String,
    case_id String,
    case_version UInt32,
    repetition_count UInt16,
    evaluated_repetitions UInt16,
    passed_repetitions UInt16,
    failed_repetitions UInt16,
    not_ready_repetitions UInt16,
    fatal_repetitions UInt16,
    hard_gate_failure_repetitions UInt16,
    pass_stability Float64,
    quality_score_mean Nullable(Float64),
    quality_score_stddev Nullable(Float64),
    quality_score_p10 Nullable(Float64),
    terminal_state_stability Nullable(Float64),
    plan_structural_variance Nullable(Float64),
    case_verdict LowCardinality(String),
    result_hash String,
    result_json String CODEC(ZSTD(3)),
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_case_result_verdict CHECK case_verdict IN ('pass','fail','invalid','not_ready'),
    CONSTRAINT ck_benchmark_case_result_stability CHECK pass_stability >= 0 AND pass_stability <= 1,
    CONSTRAINT ck_benchmark_case_result_hashes CHECK match(result_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_case_result_json CHECK isValidJSON(result_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, case_execution_id, result_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_judge_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String,
    case_execution_id String,
    repetition_id String,
    evaluation_id String,
    judge_id String,
    judge_version String,
    judge_config_hash String,
    metric_id String,
    raw_score UInt8,
    confidence Float64,
    evidence_refs Array(String),
    reason_summary String,
    uncertainties Array(String),
    release_authority UInt8 DEFAULT 0,
    result_hash String,
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_judge_score CHECK raw_score <= 2 AND confidence >= 0 AND confidence <= 1,
    CONSTRAINT ck_benchmark_judge_authority CHECK release_authority = 0,
    CONSTRAINT ck_benchmark_judge_hash CHECK match(judge_config_hash, '^sha256:[0-9a-f]{64}$') AND match(result_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, repetition_id, judge_id, metric_id, result_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_human_review_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String,
    case_execution_id String,
    repetition_id String,
    evaluation_id String,
    review_id String,
    reviewer_id String,
    review_role LowCardinality(String),
    review_status LowCardinality(String),
    disposition LowCardinality(String),
    labels_json String CODEC(ZSTD(3)),
    conflict_resolution_ref String DEFAULT '',
    attachment_refs Array(String) DEFAULT [],
    result_hash String,
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    reviewed_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_human_review_json CHECK isValidJSON(labels_json),
    CONSTRAINT ck_benchmark_human_review_hash CHECK match(result_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, repetition_id, review_id, result_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_calibration_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    calibration_id String,
    benchmark_version String,
    dataset_id String,
    dataset_version String,
    judge_id String,
    judge_version String,
    human_policy_id String,
    sample_count UInt64,
    exact_agreement Float64,
    within_one_agreement Float64,
    weighted_kappa Float64,
    confidence_error Float64,
    metric_bias_json String DEFAULT '{}' CODEC(ZSTD(3)),
    calibration_status LowCardinality(String),
    report_artifact_uri String,
    report_content_hash String,
    result_hash String,
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_calibration_rates CHECK exact_agreement >= 0 AND exact_agreement <= 1 AND within_one_agreement >= 0 AND within_one_agreement <= 1,
    CONSTRAINT ck_benchmark_calibration_json CHECK isValidJSON(metric_bias_json),
    CONSTRAINT ck_benchmark_calibration_hash CHECK match(report_content_hash, '^sha256:[0-9a-f]{64}$') AND match(result_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(calibration_id) % 64
ORDER BY (tenant_id, project_id, calibration_id, result_hash);

CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_run_current AS
SELECT * FROM sdar_mart.benchmark_run
ORDER BY projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, benchmark_run_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_case_execution_current AS
SELECT * FROM sdar_mart.benchmark_case_execution
ORDER BY projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, benchmark_run_id, case_execution_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_case_repetition_current AS
SELECT * FROM sdar_mart.benchmark_case_repetition
ORDER BY projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, benchmark_run_id, case_execution_id, repetition_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_case_result_current AS
SELECT * FROM sdar_mart.benchmark_case_result
ORDER BY projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, benchmark_run_id, case_execution_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_evidence_bundle_current AS
SELECT * FROM sdar_mart.benchmark_evidence_bundle_snapshot
ORDER BY projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, snapshot_id;
