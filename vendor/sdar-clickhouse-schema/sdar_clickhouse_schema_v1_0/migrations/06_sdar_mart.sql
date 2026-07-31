-- SDAR ClickHouse Schema V1.1 (fresh-install)
-- Compatibility: ClickHouse 24.8+; recommended 25.3 LTS+
-- All timestamps are UTC DateTime64(3).
--
-- Evaluation contract:
--   * application/domain/general are independent evaluation scopes;
--   * evaluation_group_id links independently computed application/domain/general
--     results for comparison; it never authorizes score propagation between tiers;
--   * evaluation_id identifies a stable evaluation stream;
--   * result_version identifies an immutable, replayable result in that stream;
--   * all child rows repeat the parent metric/gate/fatal rule-set identities,
--     provenance, evaluation_group_id and result_version;
--   * ReplacingMergeTree makes retries idempotent only when their payload hash is
--     identical. Payload hash is part of ORDER BY, so conflicting immutable
--     payloads and historical result versions are both retained for audit;
--   * row_version is a transport retry ordinal only. A retry of the same logical
--     row must keep the same payload hash; semantic changes require a new
--     result_version and are never repaired by increasing row_version;
--   * partitioning is derived from evaluation_id, therefore a retry or a new
--     result_version can never move the same evaluation stream across partitions.

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_result
(
    tenant_id String,
    project_id String,

    evaluation_id UUID,
    evaluation_group_id UUID,
    result_version UInt32,
    evaluation_scope LowCardinality(String),
    adapter LowCardinality(String),

    episode_key String,
    episode_uuid Nullable(UUID),
    agent_id String,
    agent_type LowCardinality(String),
    agent_version String,
    scenario_id String DEFAULT '',

    framework String,
    framework_version String,
    profile String,
    profile_version String,
    collection_profile LowCardinality(String),
    evidence_level LowCardinality(String),

    metric_set_id String,
    metric_set_version String,
    metric_set_hash FixedString(64),
    gate_set_id String,
    gate_set_version String,
    gate_set_hash FixedString(64),
    fatal_set_id String,
    fatal_set_version String,
    fatal_set_hash FixedString(64),

    evaluator_id String,
    evaluator_type LowCardinality(String),
    evaluator_version String,
    evaluator_config_hash FixedString(64),
    evaluator_json String DEFAULT '{}' CODEC(ZSTD(3)),

    projection_id String,
    projection_version String,

    evidence_snapshot_id String,
    evidence_snapshot_hash FixedString(64),
    evidence_watermark_sequence UInt64,
    evidence_watermark_at DateTime64(3, 'UTC'),
    source_databases Array(String),
    source_record_count UInt64,
    evidence_completeness_json String DEFAULT '{}' CODEC(ZSTD(3)),

    evaluation_status LowCardinality(String),
    applicable_weight Float64,
    raw_weighted_score Float64,
    score Float64,
    level LowCardinality(String),
    passed UInt8,

    dimensions_json String DEFAULT '{}' CODEC(ZSTD(3)),
    operational_metrics_json String DEFAULT '[]' CODEC(ZSTD(3)),
    outcome String DEFAULT '',
    major_findings Array(String) DEFAULT [],
    improvements Array(String) DEFAULT [],

    result_json String CODEC(ZSTD(3)),
    result_payload_hash FixedString(64),
    evaluated_at DateTime64(3, 'UTC'),
    record_id UUID,
    row_version UInt64,
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),

    CONSTRAINT ck_evaluation_result_version CHECK result_version > 0 AND row_version > 0,
    CONSTRAINT ck_evaluation_result_scope CHECK evaluation_scope IN ('application', 'domain', 'general'),
    CONSTRAINT ck_evaluation_result_adapter CHECK
        (evaluation_scope = 'general' AND adapter = 'sdar')
        OR (evaluation_scope = 'application' AND adapter IN ('commander', 'npc'))
        OR (evaluation_scope = 'domain' AND adapter IN ('commander', 'npc')),
    CONSTRAINT ck_evaluation_result_version_axes CHECK
        evaluation_scope != 'domain'
        OR (
            framework = 'SDAR'
            AND framework_version = '2.0'
            AND profile = 'embodied-control'
            AND profile_version = '1.0'
        ),
    CONSTRAINT ck_evaluation_result_episode CHECK
        length(episode_key) > 0 AND (evaluation_scope != 'general' OR episode_uuid IS NOT NULL),
    CONSTRAINT ck_evaluation_result_evidence_level CHECK evidence_level IN ('E0', 'E1', 'E2'),
    CONSTRAINT ck_evaluation_result_status CHECK evaluation_status IN ('evaluated', 'insufficient_evidence', 'failed'),
    CONSTRAINT ck_evaluation_result_score CHECK
        isFinite(score) AND score >= 0 AND score <= 100
        AND isFinite(raw_weighted_score) AND raw_weighted_score >= 0
        AND isFinite(applicable_weight) AND applicable_weight >= 0 AND applicable_weight <= 100
        AND raw_weighted_score <= applicable_weight + 0.000001
        AND (
            (applicable_weight = 0 AND raw_weighted_score = 0 AND score = 0)
            OR (
                applicable_weight > 0
                AND abs(score - (raw_weighted_score / applicable_weight * 100.0)) <= 0.01
            )
        ),
    CONSTRAINT ck_evaluation_result_passed CHECK passed IN (0, 1),
    CONSTRAINT ck_evaluation_result_level CHECK level IN ('S', 'A', 'B', 'C', 'D', 'HG', 'F', 'NE'),
    CONSTRAINT ck_evaluation_result_level_score CHECK
        multiIf(
            level IN ('HG', 'F', 'NE'), 1,
            score >= 95, level = 'S',
            score >= 85, level = 'A',
            score >= 75, level = 'B',
            score >= 60, level = 'C',
            level = 'D'
        ),
    CONSTRAINT ck_evaluation_result_pass_semantics CHECK
        passed = 0
        OR (evaluation_status = 'evaluated' AND score >= 75 AND level IN ('S', 'A', 'B')),
    CONSTRAINT ck_evaluation_result_minimal CHECK
        collection_profile != 'minimal'
        OR (
            evidence_level IN ('E0', 'E1')
            AND (
                evaluation_scope = 'application'
                OR (evaluation_status = 'insufficient_evidence' AND passed = 0 AND level = 'NE')
            )
        ),
    CONSTRAINT ck_evaluation_result_provenance CHECK
        evaluation_group_id != toUUID('00000000-0000-0000-0000-000000000000')
        AND length(metric_set_id) > 0
        AND length(metric_set_version) > 0
        AND length(gate_set_id) > 0
        AND length(gate_set_version) > 0
        AND length(fatal_set_id) > 0
        AND length(fatal_set_version) > 0
        AND length(evaluator_id) > 0
        AND length(evaluator_version) > 0
        AND length(projection_id) > 0
        AND length(projection_version) > 0
        AND length(evidence_snapshot_id) > 0
        AND length(source_databases) > 0
        AND match(toString(metric_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(gate_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(fatal_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evaluator_config_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evidence_snapshot_hash), '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT ck_evaluation_result_json CHECK
        isValidJSON(evaluator_json)
        AND isValidJSON(evidence_completeness_json)
        AND isValidJSON(dimensions_json)
        AND isValidJSON(operational_metrics_json)
        AND isValidJSON(result_json),
    CONSTRAINT ck_evaluation_result_payload_hash CHECK
        match(toString(result_payload_hash), '^[0-9A-Fa-f]{64}$')
)
ENGINE = ReplacingMergeTree(row_version)
PARTITION BY cityHash64(toString(evaluation_id)) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, result_payload_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_metric_result
(
    tenant_id String,
    project_id String,

    evaluation_id UUID,
    evaluation_group_id UUID,
    result_version UInt32,
    evaluation_scope LowCardinality(String),
    adapter LowCardinality(String),
    episode_key String,
    episode_uuid Nullable(UUID),
    agent_id String,
    agent_version String,
    collection_profile LowCardinality(String),

    framework String,
    framework_version String,
    profile String,
    profile_version String,
    metric_set_id String,
    metric_set_version String,
    metric_set_hash FixedString(64),
    gate_set_id String,
    gate_set_version String,
    gate_set_hash FixedString(64),
    fatal_set_id String,
    fatal_set_version String,
    fatal_set_hash FixedString(64),
    evaluator_id String,
    evaluator_type LowCardinality(String),
    evaluator_version String,
    evaluator_config_hash FixedString(64),
    projection_id String,
    projection_version String,
    evidence_snapshot_id String,
    evidence_snapshot_hash FixedString(64),
    evidence_watermark_sequence UInt64,
    evidence_watermark_at DateTime64(3, 'UTC'),

    metric_id String,
    dimension_id String,
    applicable UInt8,
    raw_score UInt8,
    weight Float64,
    weighted_score Float64,
    evidence_level LowCardinality(String),
    evidence_refs Array(Tuple(
        evidence_type String,
        evidence_id String,
        relation String,
        schema_ref String,
        storage_ref String,
        payload_hash String
    )) DEFAULT [],
    finding String DEFAULT '',
    not_applicable_reason String DEFAULT '',
    row_payload_hash FixedString(64),

    evaluated_at DateTime64(3, 'UTC'),
    record_id UUID,
    row_version UInt64,
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),

    CONSTRAINT ck_evaluation_metric_version CHECK result_version > 0 AND row_version > 0,
    CONSTRAINT ck_evaluation_metric_scope CHECK evaluation_scope IN ('application', 'domain', 'general'),
    CONSTRAINT ck_evaluation_metric_adapter CHECK
        (evaluation_scope = 'general' AND adapter = 'sdar')
        OR (evaluation_scope = 'application' AND adapter IN ('commander', 'npc'))
        OR (evaluation_scope = 'domain' AND adapter IN ('commander', 'npc')),
    CONSTRAINT ck_evaluation_metric_version_axes CHECK
        evaluation_scope != 'domain'
        OR (
            framework = 'SDAR'
            AND framework_version = '2.0'
            AND profile = 'embodied-control'
            AND profile_version = '1.0'
        ),
    CONSTRAINT ck_evaluation_metric_episode CHECK
        length(episode_key) > 0 AND (evaluation_scope != 'general' OR episode_uuid IS NOT NULL),
    CONSTRAINT ck_evaluation_metric_identity CHECK length(metric_id) > 0 AND length(dimension_id) > 0,
    CONSTRAINT ck_evaluation_metric_applicable CHECK applicable IN (0, 1),
    CONSTRAINT ck_evaluation_metric_raw_score CHECK raw_score <= 2,
    CONSTRAINT ck_evaluation_metric_weight CHECK
        isFinite(weight) AND weight >= 0 AND weight <= 100
        AND isFinite(weighted_score) AND weighted_score >= 0 AND weighted_score <= weight,
    CONSTRAINT ck_evaluation_metric_formula CHECK
        (applicable = 0 AND raw_score = 0 AND weighted_score = 0 AND length(not_applicable_reason) > 0)
        OR (applicable = 1 AND abs(weighted_score - (weight * raw_score / 2.0)) <= 0.000001),
    CONSTRAINT ck_evaluation_metric_evidence_level CHECK
        evidence_level IN ('E0', 'E1', 'E2')
        AND (evidence_level != 'E0' OR raw_score = 0)
        AND (evidence_level != 'E1' OR raw_score <= 1),
    CONSTRAINT ck_evaluation_metric_evidence_refs CHECK
        arrayAll(
            ref ->
                length(tupleElement(ref, 'evidence_type')) > 0
                AND length(tupleElement(ref, 'evidence_id')) > 0
                AND (
                    length(tupleElement(ref, 'relation')) = 0
                    OR tupleElement(ref, 'relation') IN (
                        'supports', 'contradicts', 'caused_by', 'produced_by',
                        'validated_by', 'derived_from', 'supersedes', 'related'
                    )
                )
                AND (
                    length(tupleElement(ref, 'payload_hash')) = 0
                    OR match(tupleElement(ref, 'payload_hash'), '^[0-9A-Fa-f]{32,128}$')
                ),
            evidence_refs
        )
        AND (raw_score = 0 OR length(evidence_refs) > 0),
    CONSTRAINT ck_evaluation_metric_minimal CHECK
        collection_profile != 'minimal'
        OR (
            evidence_level IN ('E0', 'E1')
            AND NOT (
                metric_id IN ('M3', 'M13', 'M14')
                AND raw_score > 0
            )
        ),
    CONSTRAINT ck_evaluation_metric_provenance CHECK
        evaluation_group_id != toUUID('00000000-0000-0000-0000-000000000000')
        AND length(metric_set_id) > 0
        AND length(metric_set_version) > 0
        AND length(gate_set_id) > 0
        AND length(gate_set_version) > 0
        AND length(fatal_set_id) > 0
        AND length(fatal_set_version) > 0
        AND length(evaluator_id) > 0
        AND length(evaluator_version) > 0
        AND length(projection_id) > 0
        AND length(projection_version) > 0
        AND length(evidence_snapshot_id) > 0
        AND match(toString(metric_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(gate_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(fatal_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evaluator_config_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evidence_snapshot_hash), '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT ck_evaluation_metric_payload_hash CHECK
        match(toString(row_payload_hash), '^[0-9A-Fa-f]{64}$')
)
ENGINE = ReplacingMergeTree(row_version)
PARTITION BY cityHash64(toString(evaluation_id)) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, metric_id, row_payload_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_gate_result
(
    tenant_id String,
    project_id String,

    evaluation_id UUID,
    evaluation_group_id UUID,
    result_version UInt32,
    evaluation_scope LowCardinality(String),
    adapter LowCardinality(String),
    episode_key String,
    episode_uuid Nullable(UUID),
    agent_id String,
    agent_version String,
    collection_profile LowCardinality(String),

    framework String,
    framework_version String,
    profile String,
    profile_version String,
    metric_set_id String,
    metric_set_version String,
    metric_set_hash FixedString(64),
    gate_set_id String,
    gate_set_version String,
    gate_set_hash FixedString(64),
    fatal_set_id String,
    fatal_set_version String,
    fatal_set_hash FixedString(64),
    evaluator_id String,
    evaluator_type LowCardinality(String),
    evaluator_version String,
    evaluator_config_hash FixedString(64),
    projection_id String,
    projection_version String,
    evidence_snapshot_id String,
    evidence_snapshot_hash FixedString(64),
    evidence_watermark_sequence UInt64,
    evidence_watermark_at DateTime64(3, 'UTC'),

    gate_id String,
    applicable UInt8,
    gate_result LowCardinality(String),
    evidence_level LowCardinality(String),
    reason String DEFAULT '',
    evidence_refs Array(Tuple(
        evidence_type String,
        evidence_id String,
        relation String,
        schema_ref String,
        storage_ref String,
        payload_hash String
    )) DEFAULT [],
    row_payload_hash FixedString(64),

    evaluated_at DateTime64(3, 'UTC'),
    record_id UUID,
    row_version UInt64,
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),

    CONSTRAINT ck_evaluation_gate_version CHECK result_version > 0 AND row_version > 0,
    CONSTRAINT ck_evaluation_gate_scope CHECK evaluation_scope IN ('application', 'domain', 'general'),
    CONSTRAINT ck_evaluation_gate_adapter CHECK
        (evaluation_scope = 'general' AND adapter = 'sdar')
        OR (evaluation_scope = 'application' AND adapter IN ('commander', 'npc'))
        OR (evaluation_scope = 'domain' AND adapter IN ('commander', 'npc')),
    CONSTRAINT ck_evaluation_gate_version_axes CHECK
        evaluation_scope != 'domain'
        OR (
            framework = 'SDAR'
            AND framework_version = '2.0'
            AND profile = 'embodied-control'
            AND profile_version = '1.0'
        ),
    CONSTRAINT ck_evaluation_gate_episode CHECK
        length(episode_key) > 0 AND (evaluation_scope != 'general' OR episode_uuid IS NOT NULL),
    CONSTRAINT ck_evaluation_gate_identity CHECK length(gate_id) > 0,
    CONSTRAINT ck_evaluation_gate_applicable CHECK applicable IN (0, 1),
    CONSTRAINT ck_evaluation_gate_result CHECK
        (applicable = 0 AND gate_result = 'not_applicable' AND length(reason) > 0)
        OR (applicable = 1 AND gate_result IN ('pass', 'fail')),
    CONSTRAINT ck_evaluation_gate_evidence CHECK
        evidence_level IN ('E0', 'E1', 'E2')
        AND arrayAll(
            ref ->
                length(tupleElement(ref, 'evidence_type')) > 0
                AND length(tupleElement(ref, 'evidence_id')) > 0
                AND (
                    length(tupleElement(ref, 'relation')) = 0
                    OR tupleElement(ref, 'relation') IN (
                        'supports', 'contradicts', 'caused_by', 'produced_by',
                        'validated_by', 'derived_from', 'supersedes', 'related'
                    )
                )
                AND (
                    length(tupleElement(ref, 'payload_hash')) = 0
                    OR match(tupleElement(ref, 'payload_hash'), '^[0-9A-Fa-f]{32,128}$')
                ),
            evidence_refs
        )
        AND (gate_result != 'pass' OR (evidence_level = 'E2' AND length(evidence_refs) > 0))
        AND (gate_result != 'fail' OR length(reason) > 0),
    CONSTRAINT ck_evaluation_gate_minimal CHECK NOT (
        collection_profile = 'minimal'
        AND gate_id IN ('HG2', 'HG5', 'HG6')
        AND gate_result = 'pass'
    ),
    CONSTRAINT ck_evaluation_gate_provenance CHECK
        evaluation_group_id != toUUID('00000000-0000-0000-0000-000000000000')
        AND length(metric_set_id) > 0
        AND length(metric_set_version) > 0
        AND length(gate_set_id) > 0
        AND length(gate_set_version) > 0
        AND length(fatal_set_id) > 0
        AND length(fatal_set_version) > 0
        AND length(evaluator_id) > 0
        AND length(evaluator_version) > 0
        AND length(projection_id) > 0
        AND length(projection_version) > 0
        AND length(evidence_snapshot_id) > 0
        AND match(toString(metric_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(gate_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(fatal_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evaluator_config_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evidence_snapshot_hash), '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT ck_evaluation_gate_payload_hash CHECK
        match(toString(row_payload_hash), '^[0-9A-Fa-f]{64}$')
)
ENGINE = ReplacingMergeTree(row_version)
PARTITION BY cityHash64(toString(evaluation_id)) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, gate_id, row_payload_hash);

CREATE TABLE IF NOT EXISTS sdar_mart.evaluation_fatal_error
(
    tenant_id String,
    project_id String,

    evaluation_id UUID,
    evaluation_group_id UUID,
    result_version UInt32,
    evaluation_scope LowCardinality(String),
    adapter LowCardinality(String),
    episode_key String,
    episode_uuid Nullable(UUID),
    agent_id String,
    agent_version String,
    collection_profile LowCardinality(String),

    framework String,
    framework_version String,
    profile String,
    profile_version String,
    metric_set_id String,
    metric_set_version String,
    metric_set_hash FixedString(64),
    gate_set_id String,
    gate_set_version String,
    gate_set_hash FixedString(64),
    fatal_set_id String,
    fatal_set_version String,
    fatal_set_hash FixedString(64),
    evaluator_id String,
    evaluator_type LowCardinality(String),
    evaluator_version String,
    evaluator_config_hash FixedString(64),
    projection_id String,
    projection_version String,
    evidence_snapshot_id String,
    evidence_snapshot_hash FixedString(64),
    evidence_watermark_sequence UInt64,
    evidence_watermark_at DateTime64(3, 'UTC'),

    fatal_error_id String,
    fatal_error_code String,
    severity LowCardinality(String),
    description String,
    related_action_id String DEFAULT '',
    evidence_refs Array(Tuple(
        evidence_type String,
        evidence_id String,
        relation String,
        schema_ref String,
        storage_ref String,
        payload_hash String
    )),
    row_payload_hash FixedString(64),

    evaluated_at DateTime64(3, 'UTC'),
    record_id UUID,
    row_version UInt64,
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),

    CONSTRAINT ck_evaluation_fatal_version CHECK result_version > 0 AND row_version > 0,
    CONSTRAINT ck_evaluation_fatal_scope CHECK evaluation_scope IN ('application', 'domain', 'general'),
    CONSTRAINT ck_evaluation_fatal_adapter CHECK
        (evaluation_scope = 'general' AND adapter = 'sdar')
        OR (evaluation_scope = 'application' AND adapter IN ('commander', 'npc'))
        OR (evaluation_scope = 'domain' AND adapter IN ('commander', 'npc')),
    CONSTRAINT ck_evaluation_fatal_version_axes CHECK
        evaluation_scope != 'domain'
        OR (
            framework = 'SDAR'
            AND framework_version = '2.0'
            AND profile = 'embodied-control'
            AND profile_version = '1.0'
        ),
    CONSTRAINT ck_evaluation_fatal_episode CHECK
        length(episode_key) > 0 AND (evaluation_scope != 'general' OR episode_uuid IS NOT NULL),
    CONSTRAINT ck_evaluation_fatal_identity CHECK
        length(fatal_error_id) > 0 AND length(fatal_error_code) > 0 AND length(description) > 0,
    CONSTRAINT ck_evaluation_fatal_severity CHECK severity IN ('error', 'critical'),
    CONSTRAINT ck_evaluation_fatal_evidence CHECK
        length(evidence_refs) > 0
        AND arrayAll(
            ref ->
                length(tupleElement(ref, 'evidence_type')) > 0
                AND length(tupleElement(ref, 'evidence_id')) > 0
                AND (
                    length(tupleElement(ref, 'relation')) = 0
                    OR tupleElement(ref, 'relation') IN (
                        'supports', 'contradicts', 'caused_by', 'produced_by',
                        'validated_by', 'derived_from', 'supersedes', 'related'
                    )
                )
                AND (
                    length(tupleElement(ref, 'payload_hash')) = 0
                    OR match(tupleElement(ref, 'payload_hash'), '^[0-9A-Fa-f]{32,128}$')
                ),
            evidence_refs
        ),
    CONSTRAINT ck_evaluation_fatal_provenance CHECK
        evaluation_group_id != toUUID('00000000-0000-0000-0000-000000000000')
        AND length(metric_set_id) > 0
        AND length(metric_set_version) > 0
        AND length(gate_set_id) > 0
        AND length(gate_set_version) > 0
        AND length(fatal_set_id) > 0
        AND length(fatal_set_version) > 0
        AND length(evaluator_id) > 0
        AND length(evaluator_version) > 0
        AND length(projection_id) > 0
        AND length(projection_version) > 0
        AND length(evidence_snapshot_id) > 0
        AND match(toString(metric_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(gate_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(fatal_set_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evaluator_config_hash), '^[0-9A-Fa-f]{64}$')
        AND match(toString(evidence_snapshot_hash), '^[0-9A-Fa-f]{64}$'),
    CONSTRAINT ck_evaluation_fatal_payload_hash CHECK
        match(toString(row_payload_hash), '^[0-9A-Fa-f]{64}$')
)
ENGINE = ReplacingMergeTree(row_version)
PARTITION BY cityHash64(toString(evaluation_id)) % 64
ORDER BY (tenant_id, project_id, evaluation_id, result_version, fatal_error_id, row_payload_hash);

-- ---------------------------------------------------------------------------
-- Replay and compatibility views. Versioned views retain one deterministic
-- physical retry for every immutable result_version. Latest/current views
-- retain only the greatest result_version in each evaluation stream, preserving
-- the single-row semantics of the legacy general/commander/npc/embodied names.
-- Conflicting hashes remain in the authoritative tables and are never merged.
-- ---------------------------------------------------------------------------

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_result_versioned AS
SELECT *
FROM sdar_mart.evaluation_result
ORDER BY row_version DESC, ingested_at DESC, result_payload_hash DESC, record_id DESC
LIMIT 1 BY tenant_id, project_id, evaluation_id, result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_metric_result_versioned AS
SELECT *
FROM sdar_mart.evaluation_metric_result
ORDER BY row_version DESC, ingested_at DESC, row_payload_hash DESC, record_id DESC
LIMIT 1 BY tenant_id, project_id, evaluation_id, result_version, metric_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_gate_result_versioned AS
SELECT *
FROM sdar_mart.evaluation_gate_result
ORDER BY row_version DESC, ingested_at DESC, row_payload_hash DESC, record_id DESC
LIMIT 1 BY tenant_id, project_id, evaluation_id, result_version, gate_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_fatal_error_versioned AS
SELECT *
FROM sdar_mart.evaluation_fatal_error
ORDER BY row_version DESC, ingested_at DESC, row_payload_hash DESC, record_id DESC
LIMIT 1 BY tenant_id, project_id, evaluation_id, result_version, fatal_error_id;

-- The parent result is the commit marker for a multi-table result version.
-- Historical replay never observes child rows until that marker exists.
CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_metric_result_committed AS
SELECT m.*
FROM sdar_mart.v_evaluation_metric_result_versioned AS m
INNER JOIN sdar_mart.v_evaluation_result_versioned AS r
  ON m.tenant_id = r.tenant_id
 AND m.project_id = r.project_id
 AND m.evaluation_id = r.evaluation_id
 AND m.result_version = r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_gate_result_committed AS
SELECT g.*
FROM sdar_mart.v_evaluation_gate_result_versioned AS g
INNER JOIN sdar_mart.v_evaluation_result_versioned AS r
  ON g.tenant_id = r.tenant_id
 AND g.project_id = r.project_id
 AND g.evaluation_id = r.evaluation_id
 AND g.result_version = r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_fatal_error_committed AS
SELECT f.*
FROM sdar_mart.v_evaluation_fatal_error_versioned AS f
INNER JOIN sdar_mart.v_evaluation_result_versioned AS r
  ON f.tenant_id = r.tenant_id
 AND f.project_id = r.project_id
 AND f.evaluation_id = r.evaluation_id
 AND f.result_version = r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_result_latest AS
SELECT *
FROM sdar_mart.v_evaluation_result_versioned
ORDER BY result_version DESC, row_version DESC, ingested_at DESC, result_payload_hash DESC, record_id DESC
LIMIT 1 BY tenant_id, project_id, evaluation_id;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_metric_result_latest AS
SELECT m.*
FROM sdar_mart.v_evaluation_metric_result_committed AS m
INNER JOIN sdar_mart.v_evaluation_result_latest AS r
  ON m.tenant_id = r.tenant_id
 AND m.project_id = r.project_id
 AND m.evaluation_id = r.evaluation_id
 AND m.result_version = r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_gate_result_latest AS
SELECT g.*
FROM sdar_mart.v_evaluation_gate_result_committed AS g
INNER JOIN sdar_mart.v_evaluation_result_latest AS r
  ON g.tenant_id = r.tenant_id
 AND g.project_id = r.project_id
 AND g.evaluation_id = r.evaluation_id
 AND g.result_version = r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_fatal_error_latest AS
SELECT f.*
FROM sdar_mart.v_evaluation_fatal_error_committed AS f
INNER JOIN sdar_mart.v_evaluation_result_latest AS r
  ON f.tenant_id = r.tenant_id
 AND f.project_id = r.project_id
 AND f.evaluation_id = r.evaluation_id
 AND f.result_version = r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_result_current AS
SELECT * FROM sdar_mart.v_evaluation_result_latest;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_metric_result_current AS
SELECT * FROM sdar_mart.v_evaluation_metric_result_latest;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_gate_result_current AS
SELECT * FROM sdar_mart.v_evaluation_gate_result_latest;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_fatal_error_current AS
SELECT * FROM sdar_mart.v_evaluation_fatal_error_latest;

CREATE VIEW IF NOT EXISTS sdar_mart.general_evaluation_result AS
SELECT
    tenant_id,
    project_id,
    evaluation_id,
    assumeNotNull(episode_uuid) AS episode_id,
    agent_id,
    agent_type,
    agent_version,
    scenario_id,
    framework,
    framework_version,
    profile,
    profile_version,
    score,
    level,
    passed,
    if(empty(JSONExtractRaw(result_json, 'fatalErrors')), '[]', JSONExtractRaw(result_json, 'fatalErrors')) AS fatal_errors_json,
    if(empty(JSONExtractRaw(result_json, 'hardGates')), '{}', JSONExtractRaw(result_json, 'hardGates')) AS hard_gates_json,
    dimensions_json,
    if(empty(JSONExtractRaw(result_json, 'metrics')), '[]', JSONExtractRaw(result_json, 'metrics')) AS metrics_json,
    operational_metrics_json,
    outcome,
    major_findings,
    improvements,
    evaluated_at,
    evaluator_json,
    result_json,
    result_version AS record_version,
    evaluated_at AS occurred_at,
    evidence_watermark_sequence AS sequence,
    evaluation_id AS record_id,
    result_version,
    evaluation_scope,
    adapter,
    metric_set_id,
    metric_set_version,
    evaluator_id,
    evaluator_type,
    evaluator_version,
    projection_id,
    projection_version,
    evidence_snapshot_id,
    evidence_snapshot_hash,
    evidence_watermark_sequence,
    evidence_watermark_at,
    evaluation_status,
    evaluation_group_id,
    metric_set_hash,
    gate_set_id,
    gate_set_version,
    gate_set_hash,
    fatal_set_id,
    fatal_set_version,
    fatal_set_hash
FROM sdar_mart.v_evaluation_result_current
WHERE evaluation_scope = 'general' AND adapter = 'sdar';

CREATE VIEW IF NOT EXISTS sdar_mart.embodied_evaluation_result AS
SELECT
    tenant_id,
    project_id,
    evaluation_id,
    episode_key,
    agent_id,
    agent_type,
    agent_version,
    scenario_id,
    evaluation_scope,
    framework,
    framework_version,
    profile,
    profile_version,
    adapter,
    collection_profile,
    evidence_level,
    evidence_completeness_json,
    applicable_weight,
    score,
    level,
    passed,
    if(empty(JSONExtractRaw(result_json, 'fatalErrors')), '[]', JSONExtractRaw(result_json, 'fatalErrors')) AS fatal_errors_json,
    if(empty(JSONExtractRaw(result_json, 'hardGates')), '{}', JSONExtractRaw(result_json, 'hardGates')) AS hard_gates_json,
    dimensions_json,
    if(empty(JSONExtractRaw(result_json, 'metrics')), '[]', JSONExtractRaw(result_json, 'metrics')) AS metrics_json,
    operational_metrics_json,
    outcome,
    major_findings,
    improvements,
    evaluated_at,
    evaluator_json,
    source_databases,
    result_json,
    result_version AS record_version,
    evaluated_at AS occurred_at,
    evidence_watermark_sequence AS sequence,
    episode_key AS episode_id,
    evaluation_id AS record_id,
    result_version,
    metric_set_id,
    metric_set_version,
    evaluator_id,
    evaluator_type,
    evaluator_version,
    projection_id,
    projection_version,
    evidence_snapshot_id,
    evidence_snapshot_hash,
    evidence_watermark_sequence,
    evidence_watermark_at,
    evaluation_status,
    evaluation_group_id,
    metric_set_hash,
    gate_set_id,
    gate_set_version,
    gate_set_hash,
    fatal_set_id,
    fatal_set_version,
    fatal_set_hash
FROM sdar_mart.v_evaluation_result_current
WHERE evaluation_scope = 'domain';

CREATE VIEW IF NOT EXISTS sdar_mart.commander_evaluation_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_type,
    agent_version, scenario_id, evaluation_scope, framework, framework_version,
    profile, profile_version, adapter, collection_profile, evidence_level,
    evidence_completeness_json, applicable_weight, score, level, passed,
    if(empty(JSONExtractRaw(result_json, 'fatalErrors')), '[]', JSONExtractRaw(result_json, 'fatalErrors')) AS fatal_errors_json,
    if(empty(JSONExtractRaw(result_json, 'hardGates')), '{}', JSONExtractRaw(result_json, 'hardGates')) AS hard_gates_json,
    dimensions_json,
    if(empty(JSONExtractRaw(result_json, 'metrics')), '[]', JSONExtractRaw(result_json, 'metrics')) AS metrics_json,
    operational_metrics_json, outcome, major_findings, improvements, evaluated_at,
    evaluator_json, source_databases, result_json, result_version AS record_version,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    episode_key AS episode_id, evaluation_id AS record_id, result_version,
    metric_set_id, metric_set_version, evaluator_id, evaluator_type,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_status, evaluation_group_id, metric_set_hash,
    gate_set_id, gate_set_version, gate_set_hash,
    fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_result_current
WHERE evaluation_scope = 'application' AND adapter = 'commander';

CREATE VIEW IF NOT EXISTS sdar_mart.npc_evaluation_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_type,
    agent_version, scenario_id, evaluation_scope, framework, framework_version,
    profile, profile_version, adapter, collection_profile, evidence_level,
    evidence_completeness_json, applicable_weight, score, level, passed,
    if(empty(JSONExtractRaw(result_json, 'fatalErrors')), '[]', JSONExtractRaw(result_json, 'fatalErrors')) AS fatal_errors_json,
    if(empty(JSONExtractRaw(result_json, 'hardGates')), '{}', JSONExtractRaw(result_json, 'hardGates')) AS hard_gates_json,
    dimensions_json,
    if(empty(JSONExtractRaw(result_json, 'metrics')), '[]', JSONExtractRaw(result_json, 'metrics')) AS metrics_json,
    operational_metrics_json, outcome, major_findings, improvements, evaluated_at,
    evaluator_json, source_databases, result_json, result_version AS record_version,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    episode_key AS episode_id, evaluation_id AS record_id, result_version,
    metric_set_id, metric_set_version, evaluator_id, evaluator_type,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_status, evaluation_group_id, metric_set_hash,
    gate_set_id, gate_set_version, gate_set_hash,
    fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_result_current
WHERE evaluation_scope = 'application' AND adapter = 'npc';

CREATE VIEW IF NOT EXISTS sdar_mart.general_metric_result AS
SELECT
    tenant_id, project_id, evaluation_id, assumeNotNull(episode_uuid) AS episode_id,
    agent_id, agent_version, evaluated_at, metric_id, dimension_id, applicable,
    raw_score, weight, weighted_score, evidence_level,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    finding, evaluator_type, evaluator_version, evaluated_at AS occurred_at,
    evidence_watermark_sequence AS sequence, record_id, result_version,
    metric_set_id, metric_set_version, evaluator_id, projection_id,
    projection_version, evidence_snapshot_id, evidence_snapshot_hash,
    evidence_watermark_sequence, evidence_watermark_at, evaluation_group_id,
    metric_set_hash, gate_set_id, gate_set_version, gate_set_hash,
    fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_metric_result_current
WHERE evaluation_scope = 'general' AND adapter = 'sdar';

CREATE VIEW IF NOT EXISTS sdar_mart.embodied_metric_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, metric_id, dimension_id, applicable, raw_score, weight,
    weighted_score, evidence_level,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    finding, evaluator_type, evaluator_version, evaluated_at AS occurred_at,
    evidence_watermark_sequence AS sequence, record_id, result_version,
    metric_set_id, metric_set_version, evaluator_id, projection_id,
    projection_version, evidence_snapshot_id, evidence_snapshot_hash,
    evidence_watermark_sequence, evidence_watermark_at, evaluation_group_id,
    metric_set_hash, gate_set_id, gate_set_version, gate_set_hash,
    fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_metric_result_current
WHERE evaluation_scope = 'domain';

CREATE VIEW IF NOT EXISTS sdar_mart.commander_metric_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, metric_id, dimension_id, applicable, raw_score, weight,
    weighted_score, evidence_level,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    finding, evaluator_type, evaluator_version, evaluated_at AS occurred_at,
    evidence_watermark_sequence AS sequence, record_id, result_version,
    metric_set_id, metric_set_version, evaluator_id, projection_id,
    projection_version, evidence_snapshot_id, evidence_snapshot_hash,
    evidence_watermark_sequence, evidence_watermark_at, evaluation_group_id,
    metric_set_hash, gate_set_id, gate_set_version, gate_set_hash,
    fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_metric_result_current
WHERE evaluation_scope = 'application' AND adapter = 'commander';

CREATE VIEW IF NOT EXISTS sdar_mart.npc_metric_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, metric_id, dimension_id, applicable, raw_score, weight,
    weighted_score, evidence_level,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    finding, evaluator_type, evaluator_version, evaluated_at AS occurred_at,
    evidence_watermark_sequence AS sequence, record_id, result_version,
    metric_set_id, metric_set_version, evaluator_id, projection_id,
    projection_version, evidence_snapshot_id, evidence_snapshot_hash,
    evidence_watermark_sequence, evidence_watermark_at, evaluation_group_id,
    metric_set_hash, gate_set_id, gate_set_version, gate_set_hash,
    fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_metric_result_current
WHERE evaluation_scope = 'application' AND adapter = 'npc';

CREATE VIEW IF NOT EXISTS sdar_mart.general_gate_result AS
SELECT
    tenant_id, project_id, evaluation_id, assumeNotNull(episode_uuid) AS episode_id,
    agent_id, agent_version, evaluated_at, gate_id, applicable, gate_result,
    reason, arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_gate_result_current
WHERE evaluation_scope = 'general' AND adapter = 'sdar';

CREATE VIEW IF NOT EXISTS sdar_mart.embodied_gate_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, gate_id, applicable, gate_result, reason,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_gate_result_current
WHERE evaluation_scope = 'domain';

CREATE VIEW IF NOT EXISTS sdar_mart.commander_gate_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, gate_id, applicable, gate_result, reason,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_gate_result_current
WHERE evaluation_scope = 'application' AND adapter = 'commander';

CREATE VIEW IF NOT EXISTS sdar_mart.npc_gate_result AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, gate_id, applicable, gate_result, reason,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_gate_result_current
WHERE evaluation_scope = 'application' AND adapter = 'npc';

CREATE VIEW IF NOT EXISTS sdar_mart.general_fatal_error AS
SELECT
    tenant_id, project_id, evaluation_id, assumeNotNull(episode_uuid) AS episode_id,
    agent_id, agent_version, evaluated_at, fatal_error_id, fatal_error_code,
    severity, description, related_action_id,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_fatal_error_current
WHERE evaluation_scope = 'general' AND adapter = 'sdar';

CREATE VIEW IF NOT EXISTS sdar_mart.embodied_fatal_error AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, fatal_error_id, fatal_error_code, severity, description,
    related_action_id,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_fatal_error_current
WHERE evaluation_scope = 'domain';

CREATE VIEW IF NOT EXISTS sdar_mart.commander_fatal_error AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, fatal_error_id, fatal_error_code, severity, description,
    related_action_id,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_fatal_error_current
WHERE evaluation_scope = 'application' AND adapter = 'commander';

CREATE VIEW IF NOT EXISTS sdar_mart.npc_fatal_error AS
SELECT
    tenant_id, project_id, evaluation_id, episode_key, agent_id, agent_version,
    evaluated_at, fatal_error_id, fatal_error_code, severity, description,
    related_action_id,
    arrayMap(ref -> tupleElement(ref, 'evidence_id'), evidence_refs) AS evidence_refs,
    evaluated_at AS occurred_at, evidence_watermark_sequence AS sequence,
    record_id, result_version, metric_set_id, metric_set_version, evaluator_id,
    evaluator_version, projection_id, projection_version, evidence_snapshot_id,
    evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
    evaluation_group_id, metric_set_hash, gate_set_id, gate_set_version,
    gate_set_hash, fatal_set_id, fatal_set_version, fatal_set_hash
FROM sdar_mart.v_evaluation_fatal_error_current
WHERE evaluation_scope = 'application' AND adapter = 'npc';
