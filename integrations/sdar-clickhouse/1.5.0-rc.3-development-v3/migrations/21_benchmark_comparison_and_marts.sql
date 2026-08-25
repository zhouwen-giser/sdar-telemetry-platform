-- SDAR ClickHouse Schema 1.5.0-rc.3
-- Migration 21: Benchmark baselines, comparisons, summaries and release-gate views.

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_baseline
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    baseline_id String,
    baseline_version UInt32,
    benchmark_run_id String,
    benchmark_version String,
    dataset_id String,
    dataset_version String,
    candidate_snapshot_id String,
    candidate_snapshot_hash String,
    contract_release_id String,
    baseline_hash String,
    promoted_by String,
    promotion_reason String DEFAULT '',
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    promoted_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_baseline_hashes CHECK match(candidate_snapshot_hash, '^sha256:[0-9a-f]{64}$') AND match(baseline_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, baseline_id, baseline_version);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_comparison
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    comparison_id String,
    baseline_run_id String,
    candidate_run_id String,
    dataset_id String,
    dataset_version String,
    contract_release_id String,
    comparable_case_count UInt32,
    improved_cases UInt32,
    unchanged_cases UInt32,
    regressed_cases UInt32,
    new_fatal_cases UInt32,
    new_gate_failure_cases UInt32,
    recovered_cases UInt32,
    non_comparable_cases UInt32,
    pass_rate_delta Float64,
    mean_score_delta Nullable(Float64),
    p10_score_delta Nullable(Float64),
    comparison_status LowCardinality(String),
    comparison_hash String,
    result_json String CODEC(ZSTD(3)),
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    compared_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_comparison_status CHECK comparison_status IN ('completed','partial','invalid'),
    CONSTRAINT ck_benchmark_comparison_hashes CHECK match(comparison_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_comparison_json CHECK isValidJSON(result_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(comparison_id) % 64
ORDER BY (tenant_id, project_id, comparison_id, comparison_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_comparison_case_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    comparison_id String,
    case_id String,
    case_version UInt32,
    baseline_case_execution_id String DEFAULT '',
    candidate_case_execution_id String DEFAULT '',
    baseline_case_verdict LowCardinality(String) DEFAULT '',
    candidate_case_verdict LowCardinality(String) DEFAULT '',
    baseline_score Nullable(Float64),
    candidate_score Nullable(Float64),
    score_delta Nullable(Float64),
    comparison_verdict LowCardinality(String),
    reason_codes Array(String),
    result_hash String,
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    compared_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_case_comparison_verdict CHECK comparison_verdict IN ('IMPROVED','UNCHANGED','REGRESSED','NEW_FATAL','NEW_GATE_FAILURE','RECOVERED','NEW_CASE','REMOVED_CASE','NON_COMPARABLE'),
    CONSTRAINT ck_benchmark_case_comparison_hashes CHECK match(result_hash, '^sha256:[0-9a-f]{64}$') AND match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(comparison_id) % 64
ORDER BY (tenant_id, project_id, comparison_id, case_id, case_version, result_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_candidate_summary
(
    tenant_id String, project_id String, record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String, candidate_snapshot_id String, candidate_snapshot_hash String,
    case_count UInt32, evaluated_case_count UInt32, pass_rate Float64,
    ready_rate Float64, not_ready_rate Float64, fatal_rate Float64, hard_gate_failure_rate Float64,
    mean_score Nullable(Float64), p10_score Nullable(Float64), p50_score Nullable(Float64), p90_score Nullable(Float64),
    high_risk_pass_rate Nullable(Float64), critical_risk_pass_rate Nullable(Float64), recovery_pass_rate Nullable(Float64),
    summary_hash String, projection_revision UInt64 DEFAULT 1, evaluated_at DateTime64(3, 'UTC'), projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_candidate_summary_hash CHECK match(candidate_snapshot_hash, '^sha256:[0-9a-f]{64}$') AND match(summary_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, candidate_snapshot_id, summary_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_track_summary
(
    tenant_id String, project_id String, record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String, track LowCardinality(String), case_count UInt32, pass_rate Float64,
    ready_rate Float64, fatal_count UInt32, hard_gate_failure_count UInt32,
    mean_score Nullable(Float64), p10_score Nullable(Float64), p50_score Nullable(Float64), p90_score Nullable(Float64),
    summary_hash String, projection_revision UInt64 DEFAULT 1, evaluated_at DateTime64(3, 'UTC'), projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_track_summary_track CHECK track IN ('core','skill','mcp-task','node-control','cross-chain'),
    CONSTRAINT ck_benchmark_track_summary_hash CHECK match(summary_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, track, summary_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_scenario_family_summary
(
    tenant_id String, project_id String, record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String, scenario_family String, track LowCardinality(String), risk_level LowCardinality(String),
    case_count UInt32, pass_rate Float64, fatal_count UInt32, hard_gate_failure_count UInt32,
    mean_score Nullable(Float64), p10_score Nullable(Float64),
    summary_hash String, projection_revision UInt64 DEFAULT 1, evaluated_at DateTime64(3, 'UTC'), projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_scenario_summary_hash CHECK match(summary_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, scenario_family, summary_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_risk_summary
(
    tenant_id String, project_id String, record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String, risk_level LowCardinality(String), case_count UInt32,
    pass_rate Float64, fatal_count UInt32, hard_gate_failure_count UInt32, not_ready_count UInt32,
    mean_score Nullable(Float64), summary_hash String, projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'), projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_risk_summary_level CHECK risk_level IN ('low','medium','high','critical'),
    CONSTRAINT ck_benchmark_risk_summary_hash CHECK match(summary_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, risk_level, summary_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_skill_version_summary
(
    tenant_id String, project_id String, record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String, skill_id String, skill_version UInt64,
    execution_count UInt64, pass_rate Float64, degraded_rate Float64, failure_rate Float64,
    mean_score Nullable(Float64), summary_hash String, projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'), projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_skill_summary_hash CHECK match(summary_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, skill_id, skill_version, summary_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_provider_summary
(
    tenant_id String, project_id String, record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String, provider_id String, operation_name String DEFAULT '',
    execution_count UInt64, pass_rate Float64, average_latency_ms Nullable(Float64),
    availability_failure_rate Nullable(Float64), cancellation_uncertain_rate Nullable(Float64), provider_error_rate Nullable(Float64),
    summary_hash String, projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'), projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_provider_summary_hash CHECK match(summary_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, provider_id, operation_name, summary_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.benchmark_operational_summary
(
    tenant_id String, project_id String, record_id UUID DEFAULT generateUUIDv4(),
    benchmark_run_id String, metric_name String, unit LowCardinality(String), sample_count UInt64,
    mean_value Float64, p50_value Float64, p95_value Float64, p99_value Float64, minimum_value Float64, maximum_value Float64,
    summary_hash String, projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'), projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_operational_summary_hash CHECK match(summary_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(benchmark_run_id) % 64
ORDER BY (tenant_id, project_id, benchmark_run_id, metric_name, summary_hash);

-- Formal release gate. Only Benchmark-origin v1.5 canonical results participate.
-- Legacy 1.4.1 evaluation rows are intentionally excluded.
CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_release_gate_v15 AS
SELECT
    r.benchmark_run_id,
    any(r.dataset_id) AS dataset_id,
    any(r.dataset_version) AS dataset_version,
    any(r.candidate_snapshot_id) AS candidate_snapshot_id,
    max(r.total_cases) AS total_cases,
    max(r.valid_evaluation_cases) AS valid_evaluation_cases,
    max(r.ready_cases) AS ready_cases,
    max(r.degraded_cases) AS degraded_cases,
    max(r.not_ready_cases) AS not_ready_cases,
    max(r.proven_fatal_cases) AS proven_fatal_cases,
    max(r.hard_gate_failed_cases) AS hard_gate_failed_cases,
    max(r.passed_cases) AS passed_cases,
    if(max(r.valid_evaluation_cases)=0, 0.0, max(r.passed_cases)/max(r.valid_evaluation_cases)) AS overall_pass_rate,
    avgIf(assumeNotNull(e.quality_score), e.score_status IN ('formal','diagnostic') AND isNotNull(e.quality_score)) AS mean_score,
    quantileExactIf(0.10)(assumeNotNull(e.quality_score), e.score_status IN ('formal','diagnostic') AND isNotNull(e.quality_score)) AS p10_score,
    countIf(e.level='F') AS fatal_result_count,
    countIf(e.level='HG') AS hard_gate_result_count,
    if(
        max(r.proven_fatal_cases)=0
        AND max(r.hard_gate_failed_cases)=0
        AND max(r.not_ready_cases)=0
        AND max(r.candidate_error_cases)=0
        AND max(r.benchmark_error_cases)=0
        AND max(r.evidence_error_cases)=0
        AND max(r.valid_evaluation_cases)>0
        AND max(r.passed_cases)/max(r.valid_evaluation_cases)>=0.85,
        'pass',
        'fail'
    ) AS release_gate
FROM sdar_mart.v_benchmark_run_current AS r
LEFT JOIN sdar_mart.v_evaluation_result_v15_current AS e
  ON r.tenant_id=e.tenant_id AND r.project_id=e.project_id AND r.benchmark_run_id=e.benchmark_run_id
WHERE e.evaluation_origin='benchmark' OR length(e.evaluation_id)=0
GROUP BY r.benchmark_run_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_case_pair_comparison_v15 AS
SELECT
    comparison_id,
    case_id,
    case_version,
    comparison_verdict,
    baseline_score,
    candidate_score,
    score_delta,
    reason_codes,
    compared_at
FROM sdar_mart.benchmark_comparison_case_result
ORDER BY projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, comparison_id, case_id, case_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_benchmark_source_vs_evaluation_readiness AS
SELECT
    rep.benchmark_run_id,
    rep.case_execution_id,
    rep.repetition_id,
    rep.episode_id,
    src.source_evidence_readiness,
    er.readiness_status AS benchmark_evaluation_readiness,
    er.reason_codes,
    er.missing_evidence_types,
    er.conflicting_evidence_refs
FROM sdar_mart.v_benchmark_case_repetition_current AS rep
LEFT JOIN sdar_mart.v_source_evidence_readiness_v15 AS src
  ON rep.tenant_id=src.tenant_id AND rep.project_id=src.project_id AND rep.episode_id=src.episode_id
LEFT JOIN sdar_mart.evaluation_readiness_result AS er
  ON rep.tenant_id=er.tenant_id AND rep.project_id=er.project_id AND rep.evaluation_id=er.evaluation_id;

-- Legacy Dataset objects stay queryable but are explicitly marked non-Benchmark-contract.
CREATE VIEW IF NOT EXISTS sdar_mart.v_legacy_dataset_release_gate_v141 AS
SELECT *, 'legacy_v141_non_benchmark' AS contract_compatibility
FROM sdar_mart.v_dataset_release_gate;

-- Projection governance registration. Existing projection runtime tables are reused;
-- no benchmark-specific checkpoint or DLQ tables are created.
INSERT INTO sdar_meta.projection_definition
(tenant_id,project_id,record_id,projection_id,projection_stage,projection_name,source_databases,target_database,contract_version,owner,description,status,created_at,updated_at)
VALUES
('global','global',generateUUIDv4(),'benchmark.meta','definition','Benchmark contract/meta projection',['benchmark_postgres','benchmark_git'],'sdar_meta','benchmark.meta/v1','sdar-benchmark','Projects versioned Benchmark contracts, cases, bindings and catalogs.','active',now64(3),now64(3)),
('global','global',generateUUIDv4(),'benchmark.execution','analysis','Benchmark execution projection',['benchmark_postgres'],'sdar_mart','benchmark.execution/v1','sdar-benchmark','Projects candidate snapshots, runs, cases, repetitions and evidence bundles.','active',now64(3),now64(3)),
('global','global',generateUUIDv4(),'benchmark.evaluation','analysis','Benchmark evaluation projection',['benchmark_postgres'],'sdar_mart','benchmark.evaluation/v1','sdar-benchmark','Projects canonical v1.5 evaluation results.','active',now64(3),now64(3)),
('global','global',generateUUIDv4(),'benchmark.comparison','mart','Benchmark comparison projection',['benchmark_postgres'],'sdar_mart','benchmark.comparison/v1','sdar-benchmark','Projects baselines, paired comparisons and benchmark summaries.','active',now64(3),now64(3));
