-- SDAR ClickHouse Schema 1.5.0-rc.3
-- Migration 19: canonical evaluation contract aligned with SDAR Benchmark v0.1.
-- Existing sdar_mart.evaluation_* tables remain legacy v1.4.1 storage and are not
-- silently upgraded into Benchmark-compatible results.

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_result_v15
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),

    evaluation_result_id String,
    evaluation_id String,
    evaluation_group_id String DEFAULT '',
    result_version UInt32,

    evaluation_origin LowCardinality(String),
    subject_type LowCardinality(String),
    evaluation_scope LowCardinality(String),
    adapter LowCardinality(String),

    episode_id String DEFAULT '',
    agent_id String DEFAULT '',
    agent_type LowCardinality(String) DEFAULT '',
    agent_version String DEFAULT '',
    scenario_id String DEFAULT '',

    benchmark_run_id String DEFAULT '',
    case_execution_id String DEFAULT '',
    repetition_id String DEFAULT '',
    case_id String DEFAULT '',
    case_version UInt32 DEFAULT 0,
    case_hash String DEFAULT '',
    expected_contract_id String DEFAULT '',
    expected_contract_version UInt32 DEFAULT 0,
    expected_contract_hash String DEFAULT '',
    evaluation_binding_id String DEFAULT '',
    evaluation_binding_version UInt32 DEFAULT 0,
    evaluation_binding_hash String DEFAULT '',
    candidate_snapshot_id String DEFAULT '',
    candidate_snapshot_hash String DEFAULT '',
    evidence_bundle_snapshot_id String DEFAULT '',
    evidence_bundle_snapshot_hash String DEFAULT '',

    framework String,
    framework_version String,
    profile_id String,
    profile_version String,
    profile_hash String,
    metric_rule_set_id String,
    metric_rule_set_version String,
    metric_rule_set_hash String,
    gate_rule_set_id String,
    gate_rule_set_version String,
    gate_rule_set_hash String,
    fatal_rule_set_id String,
    fatal_rule_set_version String,
    fatal_rule_set_hash String,

    readiness_status LowCardinality(String),
    score_status LowCardinality(String),
    applicable_weight Float64 DEFAULT 0,
    raw_weighted_score Nullable(Float64),
    quality_score Nullable(Float64),
    level LowCardinality(String),
    passed UInt8,

    dimensions_json String DEFAULT '[]' CODEC(ZSTD(3)),
    operational_metrics_json String DEFAULT '[]' CODEC(ZSTD(3)),
    major_findings Array(String) DEFAULT [],
    improvements Array(String) DEFAULT [],

    evaluator_id String,
    evaluator_type LowCardinality(String),
    evaluator_version String,
    evaluator_implementation_commit String DEFAULT '',
    evaluator_implementation_hash String,
    evaluator_json String DEFAULT '{}' CODEC(ZSTD(3)),

    result_json String CODEC(ZSTD(3)),
    result_hash String,

    source_system LowCardinality(String) DEFAULT 'benchmark_postgres',
    source_table String DEFAULT 'evaluation_result',
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_id String DEFAULT 'benchmark.evaluation',
    projection_version String DEFAULT '0.1.0',
    projection_revision UInt64 DEFAULT 1,

    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),

    CONSTRAINT ck_eval15_result_version CHECK result_version > 0 AND projection_revision > 0,
    CONSTRAINT ck_eval15_origin CHECK evaluation_origin IN ('operational','benchmark','replay'),
    CONSTRAINT ck_eval15_subject CHECK subject_type IN ('episode','benchmark_case_repetition'),
    CONSTRAINT ck_eval15_scope CHECK evaluation_scope IN ('application','domain','general'),
    CONSTRAINT ck_eval15_readiness CHECK readiness_status IN ('ready','degraded','not_ready'),
    CONSTRAINT ck_eval15_score_status CHECK score_status IN ('formal','diagnostic','unavailable'),
    CONSTRAINT ck_eval15_level CHECK level IN ('S','A','B','C','D','HG','F','NR'),
    CONSTRAINT ck_eval15_passed CHECK passed IN (0,1),
    CONSTRAINT ck_eval15_benchmark_identity CHECK
        evaluation_origin != 'benchmark'
        OR (
            subject_type = 'benchmark_case_repetition'
            AND length(benchmark_run_id) > 0 AND length(case_execution_id) > 0 AND length(repetition_id) > 0
            AND length(case_id) > 0 AND case_version > 0 AND match(case_hash, '^sha256:[0-9a-f]{64}$')
            AND length(expected_contract_id) > 0 AND expected_contract_version > 0 AND match(expected_contract_hash, '^sha256:[0-9a-f]{64}$')
            AND length(evaluation_binding_id) > 0 AND evaluation_binding_version > 0 AND match(evaluation_binding_hash, '^sha256:[0-9a-f]{64}$')
            AND length(candidate_snapshot_id) > 0 AND match(candidate_snapshot_hash, '^sha256:[0-9a-f]{64}$')
            AND length(evidence_bundle_snapshot_id) > 0 AND match(evidence_bundle_snapshot_hash, '^sha256:[0-9a-f]{64}$')
        ),
    CONSTRAINT ck_eval15_score_semantics CHECK
        (
            readiness_status = 'not_ready'
            AND score_status = 'unavailable'
            AND isNull(quality_score)
            AND isNull(raw_weighted_score)
            AND level = 'NR'
            AND passed = 0
        )
        OR (
            readiness_status IN ('ready','degraded')
            AND score_status IN ('formal','diagnostic')
            AND isNotNull(quality_score)
            AND quality_score >= 0 AND quality_score <= 100
            AND isNotNull(raw_weighted_score)
            AND raw_weighted_score >= 0
            AND applicable_weight > 0 AND applicable_weight <= 100
            AND raw_weighted_score <= applicable_weight + 0.000001
            AND abs(quality_score - (raw_weighted_score / applicable_weight * 100.0)) <= 0.01
            AND (
                (score_status = 'formal' AND level IN ('S','A','B','C','D'))
                OR (score_status = 'diagnostic' AND level IN ('F','HG'))
            )
        ),
    CONSTRAINT ck_eval15_pass_semantics CHECK passed = 0 OR (score_status = 'formal' AND quality_score >= 75 AND level IN ('S','A','B')),
    CONSTRAINT ck_eval15_hashes CHECK
        match(profile_hash, '^sha256:[0-9a-f]{64}$') AND
        match(metric_rule_set_hash, '^sha256:[0-9a-f]{64}$') AND
        match(gate_rule_set_hash, '^sha256:[0-9a-f]{64}$') AND
        match(fatal_rule_set_hash, '^sha256:[0-9a-f]{64}$') AND
        match(evaluator_implementation_hash, '^sha256:[0-9a-f]{64}$') AND
        match(result_hash, '^sha256:[0-9a-f]{64}$') AND
        match(source_content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_eval15_json CHECK isValidJSON(dimensions_json) AND isValidJSON(operational_metrics_json) AND isValidJSON(evaluator_json) AND isValidJSON(result_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, result_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_readiness_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    evaluation_id String,
    result_version UInt32,
    readiness_status LowCardinality(String),
    required_evidence_complete UInt8,
    supporting_evidence_complete UInt8,
    reason_codes Array(String),
    missing_evidence_types Array(String),
    conflicting_evidence_refs Array(String),
    source_evidence_readiness LowCardinality(String) DEFAULT 'unknown',
    evidence_bundle_snapshot_id String DEFAULT '',
    evidence_bundle_snapshot_hash String DEFAULT '',
    row_hash String,
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_eval15_readiness_status CHECK readiness_status IN ('ready','degraded','not_ready'),
    CONSTRAINT ck_eval15_source_readiness CHECK source_evidence_readiness IN ('ready','degraded','not_ready','unknown'),
    CONSTRAINT ck_eval15_readiness_bool CHECK required_evidence_complete IN (0,1) AND supporting_evidence_complete IN (0,1),
    CONSTRAINT ck_eval15_readiness_semantics CHECK
        (readiness_status = 'ready' AND required_evidence_complete = 1 AND supporting_evidence_complete = 1)
        OR (readiness_status = 'degraded' AND required_evidence_complete = 1)
        OR (readiness_status = 'not_ready' AND required_evidence_complete = 0),
    CONSTRAINT ck_eval15_readiness_hash CHECK match(row_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, row_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_evidence_grade_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    evaluation_id String,
    result_version UInt32,
    metric_id String,
    evidence_level LowCardinality(String),
    evidence_refs Array(String),
    missing_evidence_types Array(String),
    conflict_refs Array(String),
    row_hash String,
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_eval15_grade CHECK evidence_level IN ('E0','E1','E2'),
    CONSTRAINT ck_eval15_grade_hash CHECK match(row_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, metric_id, row_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_metric_result_v15
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    evaluation_id String,
    result_version UInt32,
    metric_id String,
    dimension_id String,
    applicable UInt8,
    raw_score Nullable(UInt8),
    weight Float64,
    normalized_weight Nullable(Float64),
    weighted_score Nullable(Float64),
    evidence_level Nullable(String),
    evidence_refs Array(String),
    evaluator_type LowCardinality(String),
    reason_codes Array(String),
    summary String DEFAULT '',
    not_applicable_reason String DEFAULT '',
    row_hash String,
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_eval15_metric_applicable CHECK applicable IN (0,1),
    CONSTRAINT ck_eval15_metric_evaluator CHECK evaluator_type IN ('deterministic','aggregate','semantic','composite'),
    CONSTRAINT ck_eval15_metric_na CHECK
        (applicable = 0 AND isNull(raw_score) AND isNull(weighted_score) AND isNull(evidence_level) AND length(not_applicable_reason) > 0)
        OR (
            applicable = 1 AND isNotNull(raw_score) AND raw_score <= 2
            AND isNotNull(weighted_score) AND weighted_score >= 0 AND weighted_score <= weight
            AND isNotNull(evidence_level) AND evidence_level IN ('E0','E1','E2')
            AND ((evidence_level = 'E0' AND raw_score = 0) OR (evidence_level = 'E1' AND raw_score <= 1) OR evidence_level = 'E2')
        ),
    CONSTRAINT ck_eval15_metric_hash CHECK match(row_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, metric_id, row_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_dimension_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    evaluation_id String,
    result_version UInt32,
    dimension_id String,
    dimension_name String,
    applicable UInt8,
    applicable_weight Float64,
    earned_score Float64,
    normalized_score Nullable(Float64),
    minimum_ratio Nullable(Float64),
    passed_dimension_gate Nullable(UInt8),
    row_hash String,
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_eval15_dimension_applicable CHECK applicable IN (0,1),
    CONSTRAINT ck_eval15_dimension_score CHECK
        (applicable = 0 AND applicable_weight = 0 AND isNull(normalized_score))
        OR (applicable = 1 AND applicable_weight > 0 AND normalized_score >= 0 AND normalized_score <= 100),
    CONSTRAINT ck_eval15_dimension_hash CHECK match(row_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, dimension_id, row_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_gate_result_v15
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    evaluation_id String,
    result_version UInt32,
    gate_id String,
    applicable UInt8,
    gate_result LowCardinality(String),
    evidence_refs Array(String),
    reason_codes Array(String),
    rule_version String,
    row_hash String,
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_eval15_gate_applicable CHECK applicable IN (0,1),
    CONSTRAINT ck_eval15_gate_result CHECK
        (applicable = 0 AND gate_result = 'not_applicable')
        OR (applicable = 1 AND gate_result IN ('pass','fail','insufficient_evidence')),
    CONSTRAINT ck_eval15_gate_hash CHECK match(row_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, gate_id, row_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_fatal_result
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    evaluation_id String,
    result_version UInt32,
    fatal_id String,
    applicable UInt8,
    matched UInt8,
    proof_status LowCardinality(String),
    evidence_level Nullable(String),
    evidence_refs Array(String),
    reason_codes Array(String),
    rule_version String,
    row_hash String,
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    evaluated_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_eval15_fatal_applicable CHECK applicable IN (0,1) AND matched IN (0,1),
    CONSTRAINT ck_eval15_fatal_proof CHECK proof_status IN ('proven','suspected','insufficient_evidence','not_applicable'),
    CONSTRAINT ck_eval15_fatal_semantics CHECK
        (applicable = 0 AND matched = 0 AND proof_status = 'not_applicable' AND isNull(evidence_level))
        OR (
            applicable = 1 AND proof_status != 'not_applicable'
            AND (isNull(evidence_level) OR evidence_level IN ('E0','E1','E2'))
            AND (proof_status != 'proven' OR (matched = 1 AND evidence_level = 'E2' AND length(evidence_refs) > 0))
        ),
    CONSTRAINT ck_eval15_fatal_hash CHECK match(row_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, fatal_id, row_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_operational_metric
(
    tenant_id String,
    project_id String,
    record_id UUID DEFAULT generateUUIDv4(),
    evaluation_id String,
    result_version UInt32,
    metric_name String,
    metric_value Float64,
    unit LowCardinality(String),
    dimensions_json String DEFAULT '{}' CODEC(ZSTD(3)),
    row_hash String,
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    measured_at DateTime64(3, 'UTC'),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_eval15_operational_json CHECK isValidJSON(dimensions_json),
    CONSTRAINT ck_eval15_operational_hash CHECK match(row_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
PARTITION BY cityHash64(evaluation_id) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, metric_name, row_hash);

-- Canonical v1.5 current-result views.
CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_result_v15_current AS
SELECT * FROM sdar_mart.evaluation_result_v15
ORDER BY result_version DESC, projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, evaluation_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_metric_result_v15_current AS
SELECT m.* FROM sdar_mart.evaluation_metric_result_v15 AS m
ANY INNER JOIN sdar_mart.v_evaluation_result_v15_current AS r
 ON m.tenant_id=r.tenant_id AND m.project_id=r.project_id AND m.evaluation_id=r.evaluation_id AND m.result_version=r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_gate_result_v15_current AS
SELECT g.* FROM sdar_mart.evaluation_gate_result_v15 AS g
ANY INNER JOIN sdar_mart.v_evaluation_result_v15_current AS r
 ON g.tenant_id=r.tenant_id AND g.project_id=r.project_id AND g.evaluation_id=r.evaluation_id AND g.result_version=r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_fatal_result_v15_current AS
SELECT f.* FROM sdar_mart.evaluation_fatal_result AS f
ANY INNER JOIN sdar_mart.v_evaluation_result_v15_current AS r
 ON f.tenant_id=r.tenant_id AND f.project_id=r.project_id AND f.evaluation_id=r.evaluation_id AND f.result_version=r.result_version;

-- Old results are normalized for historical trend queries only. They do not satisfy the
-- Benchmark v0.1 EvaluationResult contract and must never enter Benchmark release gates.
CREATE VIEW IF NOT EXISTS sdar_mart.v_legacy_evaluation_result_v141_normalized AS
SELECT
    tenant_id,
    project_id,
    toString(evaluation_id) AS evaluation_id,
    'operational' AS evaluation_origin,
    'episode' AS subject_type,
    evaluation_scope,
    adapter,
    episode_key AS episode_id,
    framework,
    framework_version,
    profile AS profile_id,
    profile_version,
    if(evaluation_status='insufficient_evidence','not_ready','ready') AS readiness_status,
    if(level='NE','unavailable',if(level IN ('F','HG'),'diagnostic','formal')) AS score_status,
    if(level='NE',CAST(NULL,'Nullable(Float64)'),toNullable(score)) AS quality_score,
    if(level='NE','NR',level) AS level,
    passed,
    evaluated_at,
    'legacy_v141_non_benchmark' AS contract_compatibility
FROM sdar_mart.v_evaluation_result_current;

CREATE VIEW IF NOT EXISTS sdar_mart.v_source_evidence_readiness_v15 AS
SELECT
    tenant_id,
    project_id,
    episode_id,
    manifest_id,
    manifest_version AS manifest_revision,
    readiness_status AS source_evidence_readiness,
    failed_required_records,
    pending_required_records,
    missing_families,
    concat('sha256:', toString(payload_hash)) AS manifest_payload_hash,
    projected_at AS readiness_projected_at
FROM sdar_core.v_episode_evaluation_readiness_v141;
