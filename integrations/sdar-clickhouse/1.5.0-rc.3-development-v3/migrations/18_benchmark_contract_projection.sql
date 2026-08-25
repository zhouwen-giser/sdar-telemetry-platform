-- SDAR ClickHouse Schema 1.5.0-rc.3
-- Migration 18: Benchmark contract projection foundation.
-- This migration is additive. Existing 1.4.1 Dataset definitions remain legacy-compatible,
-- while all new Benchmark definitions use the benchmark_* namespace.
-- Benchmark Git assets are definition authority; Benchmark PostgreSQL is runtime/result authority.
-- ClickHouse stores analytical projections only.

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_contract_release
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    release_id String,
    benchmark_version String,
    schema_version String,
    benchmark_case_schema_hash String,
    expected_contract_schema_hash String,
    case_evaluation_binding_schema_hash String,
    candidate_snapshot_schema_hash String,
    evidence_bundle_snapshot_schema_hash String,
    evaluation_result_schema_hash String,
    operator_catalog_hash String,
    relation_catalog_hash String,
    invariant_catalog_hash String,
    evaluation_profile_hash String,
    evidence_contract_version String,
    evidence_contract_hash String,
    evidence_registry_hash String,
    status LowCardinality(String),
    review_status LowCardinality(String),
    source_artifact_uri String DEFAULT '',
    source_content_hash String,
    projection_id String DEFAULT 'benchmark.meta',
    projection_version String DEFAULT '0.1.0',
    projection_revision UInt64 DEFAULT 1,
    frozen_at Nullable(DateTime64(3, 'UTC')),
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_contract_release_hashes CHECK
        match(benchmark_case_schema_hash, '^sha256:[0-9a-f]{64}$') AND
        match(expected_contract_schema_hash, '^sha256:[0-9a-f]{64}$') AND
        match(case_evaluation_binding_schema_hash, '^sha256:[0-9a-f]{64}$') AND
        match(candidate_snapshot_schema_hash, '^sha256:[0-9a-f]{64}$') AND
        match(evidence_bundle_snapshot_schema_hash, '^sha256:[0-9a-f]{64}$') AND
        match(evaluation_result_schema_hash, '^sha256:[0-9a-f]{64}$') AND
        match(operator_catalog_hash, '^sha256:[0-9a-f]{64}$') AND
        match(relation_catalog_hash, '^sha256:[0-9a-f]{64}$') AND
        match(invariant_catalog_hash, '^sha256:[0-9a-f]{64}$') AND
        match(source_content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_contract_release_status CHECK status IN ('freeze_candidate','frozen','deprecated'),
    CONSTRAINT ck_benchmark_contract_review_status CHECK review_status IN ('ready_for_r2','pass','conditional_pass','reject')
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, release_id);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_dataset_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    dataset_id String,
    name String,
    description String DEFAULT '',
    owner String DEFAULT '',
    status LowCardinality(String),
    source_system LowCardinality(String) DEFAULT 'benchmark_git',
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_id String DEFAULT 'benchmark.meta',
    projection_version String DEFAULT '0.1.0',
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_dataset_definition_hash CHECK match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, dataset_id);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_dataset_version
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    dataset_id String,
    dataset_version String,
    dataset_hash String,
    benchmark_contract_release_id String,
    case_count UInt32,
    split_counts Map(String, UInt32),
    manifest_artifact_uri String DEFAULT '',
    manifest_content_hash String,
    status LowCardinality(String),
    source_system LowCardinality(String) DEFAULT 'benchmark_git',
    source_record_id String,
    source_revision String,
    source_content_hash String,
    projection_id String DEFAULT 'benchmark.meta',
    projection_version String DEFAULT '0.1.0',
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_dataset_version_hash CHECK
        match(dataset_hash, '^sha256:[0-9a-f]{64}$') AND
        match(manifest_content_hash, '^sha256:[0-9a-f]{64}$') AND
        match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, dataset_id, dataset_version);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_scenario_family_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    scenario_family_id String,
    track LowCardinality(String),
    name String,
    description String DEFAULT '',
    risk_class LowCardinality(String) DEFAULT 'medium',
    tags Array(String) DEFAULT [],
    status LowCardinality(String),
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_scenario_track CHECK track IN ('core','skill','mcp-task','node-control','cross-chain'),
    CONSTRAINT ck_benchmark_scenario_hash CHECK match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, scenario_family_id);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_case_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    case_id String,
    title String,
    track LowCardinality(String),
    scenario_family String,
    risk_level LowCardinality(String),
    requirement_level LowCardinality(String),
    owner String DEFAULT '',
    tags Array(String) DEFAULT [],
    status LowCardinality(String),
    source_content_hash String,
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_case_track CHECK track IN ('core','skill','mcp-task','node-control','cross-chain'),
    CONSTRAINT ck_benchmark_case_risk CHECK risk_level IN ('low','medium','high','critical'),
    CONSTRAINT ck_benchmark_case_requirement CHECK requirement_level IN ('required','optional'),
    CONSTRAINT ck_benchmark_case_definition_hash CHECK match(source_content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, case_id);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_case_version
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    case_id String,
    case_version UInt32,
    content_hash String,
    expected_contract_id String,
    expected_contract_version UInt32,
    expected_contract_hash String,
    execution_mode LowCardinality(String),
    timeout_ms UInt64,
    repeat_count UInt16,
    isolation LowCardinality(String),
    case_json String CODEC(ZSTD(3)),
    status LowCardinality(String),
    source_system LowCardinality(String) DEFAULT 'benchmark_git',
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_case_version CHECK case_version > 0 AND repeat_count > 0,
    CONSTRAINT ck_benchmark_case_version_hash CHECK
        match(content_hash, '^sha256:[0-9a-f]{64}$') AND match(expected_contract_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_case_json CHECK isValidJSON(case_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, case_id, case_version);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_expected_contract_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    contract_id String,
    contract_version UInt32,
    content_hash String,
    required_evidence_families Array(String),
    required_record_types Array(String),
    forbidden_record_types Array(String),
    operator_refs Array(String),
    relation_refs Array(String),
    invariant_refs Array(String),
    contract_json String CODEC(ZSTD(3)),
    status LowCardinality(String),
    source_system LowCardinality(String) DEFAULT 'benchmark_git',
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_expected_contract_version CHECK contract_version > 0,
    CONSTRAINT ck_benchmark_expected_contract_hash CHECK match(content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_expected_contract_json CHECK isValidJSON(contract_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, contract_id, contract_version);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_case_evaluation_binding_definition
(
    tenant_id String DEFAULT 'global',
    project_id String DEFAULT 'global',
    record_id UUID DEFAULT generateUUIDv4(),
    binding_id String,
    binding_version UInt32,
    content_hash String,
    case_id String,
    case_version UInt32,
    case_hash String,
    expected_contract_id String,
    expected_contract_version UInt32,
    expected_contract_hash String,
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
    applicable_metrics Array(String),
    required_hard_gates Array(String),
    fatal_error_checks Array(String),
    critical_metrics Array(String),
    minimum_score Float64,
    minimum_dimension_ratio Float64,
    binding_json String CODEC(ZSTD(3)),
    status LowCardinality(String),
    source_system LowCardinality(String) DEFAULT 'benchmark_git',
    source_record_id String,
    source_revision String,
    projection_revision UInt64 DEFAULT 1,
    projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_binding_version CHECK binding_version > 0,
    CONSTRAINT ck_benchmark_binding_thresholds CHECK minimum_score >= 0 AND minimum_score <= 100 AND minimum_dimension_ratio >= 0 AND minimum_dimension_ratio <= 1,
    CONSTRAINT ck_benchmark_binding_hashes CHECK
        match(content_hash, '^sha256:[0-9a-f]{64}$') AND match(case_hash, '^sha256:[0-9a-f]{64}$') AND
        match(expected_contract_hash, '^sha256:[0-9a-f]{64}$') AND match(profile_hash, '^sha256:[0-9a-f]{64}$') AND
        match(metric_rule_set_hash, '^sha256:[0-9a-f]{64}$') AND match(gate_rule_set_hash, '^sha256:[0-9a-f]{64}$') AND
        match(fatal_rule_set_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_binding_json CHECK isValidJSON(binding_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, binding_id, binding_version);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_operator_definition
(
    tenant_id String DEFAULT 'global', project_id String DEFAULT 'global', record_id UUID DEFAULT generateUUIDv4(),
    catalog_id String, catalog_version UInt32, catalog_hash String,
    operator_id String, operator_version UInt32, content_hash String, kind LowCardinality(String),
    semantics String, input_schema_json String DEFAULT '{}' CODEC(ZSTD(3)), status LowCardinality(String),
    projection_revision UInt64 DEFAULT 1, projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_operator_hash CHECK match(catalog_hash, '^sha256:[0-9a-f]{64}$') AND match(content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_operator_json CHECK isValidJSON(input_schema_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, catalog_id, catalog_version, operator_id, operator_version);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_relation_definition
(
    tenant_id String DEFAULT 'global', project_id String DEFAULT 'global', record_id UUID DEFAULT generateUUIDv4(),
    catalog_id String, catalog_version UInt32, catalog_hash String,
    relation_id String, relation_version UInt32, content_hash String, kind LowCardinality(String),
    semantics String, input_schema_json String DEFAULT '{}' CODEC(ZSTD(3)), status LowCardinality(String),
    projection_revision UInt64 DEFAULT 1, projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_relation_hash CHECK match(catalog_hash, '^sha256:[0-9a-f]{64}$') AND match(content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_relation_json CHECK isValidJSON(input_schema_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, catalog_id, catalog_version, relation_id, relation_version);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_invariant_definition
(
    tenant_id String DEFAULT 'global', project_id String DEFAULT 'global', record_id UUID DEFAULT generateUUIDv4(),
    catalog_id String, catalog_version UInt32, catalog_hash String,
    invariant_id String, invariant_version UInt32, content_hash String, kind LowCardinality(String),
    semantics String, input_schema_json String DEFAULT '{}' CODEC(ZSTD(3)), status LowCardinality(String),
    projection_revision UInt64 DEFAULT 1, projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_invariant_hash CHECK match(catalog_hash, '^sha256:[0-9a-f]{64}$') AND match(content_hash, '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT ck_benchmark_invariant_json CHECK isValidJSON(input_schema_json)
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, catalog_id, catalog_version, invariant_id, invariant_version);

CREATE TABLE IF NOT EXISTS sdar_meta.benchmark_golden_fixture_definition
(
    tenant_id String DEFAULT 'global', project_id String DEFAULT 'global', record_id UUID DEFAULT generateUUIDv4(),
    fixture_id String, fixture_version UInt32, fixture_type LowCardinality(String), contract_type LowCardinality(String),
    benchmark_contract_release_id String, artifact_uri String, content_hash String,
    expected_validation_result LowCardinality(String), expected_reason_codes Array(String) DEFAULT [], status LowCardinality(String),
    projection_revision UInt64 DEFAULT 1, projected_at DateTime64(3, 'UTC') DEFAULT now64(3),
    CONSTRAINT ck_benchmark_fixture_type CHECK fixture_type IN ('valid','invalid'),
    CONSTRAINT ck_benchmark_fixture_result CHECK expected_validation_result IN ('pass','reject'),
    CONSTRAINT ck_benchmark_fixture_hash CHECK match(content_hash, '^sha256:[0-9a-f]{64}$')
)
ENGINE = ReplacingMergeTree(projection_revision)
ORDER BY (tenant_id, project_id, fixture_id, fixture_version);

CREATE VIEW IF NOT EXISTS sdar_meta.v_benchmark_case_latest AS
SELECT * FROM sdar_meta.benchmark_case_version
ORDER BY case_version DESC, projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, case_id;

CREATE VIEW IF NOT EXISTS sdar_meta.v_benchmark_binding_latest AS
SELECT * FROM sdar_meta.benchmark_case_evaluation_binding_definition
ORDER BY binding_version DESC, projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, binding_id;

CREATE VIEW IF NOT EXISTS sdar_meta.v_benchmark_contract_release_current AS
SELECT * FROM sdar_meta.benchmark_contract_release
ORDER BY projection_revision DESC, projected_at DESC
LIMIT 1 BY tenant_id, project_id, release_id;

INSERT INTO sdar_meta.benchmark_contract_release (release_id,benchmark_version,schema_version,benchmark_case_schema_hash,expected_contract_schema_hash,case_evaluation_binding_schema_hash,candidate_snapshot_schema_hash,evidence_bundle_snapshot_schema_hash,evaluation_result_schema_hash,operator_catalog_hash,relation_catalog_hash,invariant_catalog_hash,evaluation_profile_hash,evidence_contract_version,evidence_contract_hash,evidence_registry_hash,status,review_status,source_artifact_uri,source_content_hash,projection_revision) VALUES
('sdar-benchmark-contracts/0.1.0-rc.1','0.1.0','0.1.0','sha256:866dd3a0ab202a8742c29820b0c01d0c095d6998f60ff3b40865660e199835a3','sha256:8d880d66dc84a73834856738afcd43465cf8016c3083a30666631d437e90479c','sha256:7f886ba18b982d8e95e961e92aa5fe9e8bde6dfec1b4377a60b1310c3ac4d37f','sha256:4c159c6ea6a95a00f99d39f875437d1d370e27674db7fca1983db106ba61436e','sha256:4cfcddef573daab3e3e031df1ab96b3fd807b2f9106be893029c97c87fa2822b','sha256:920a0132f2feab233ebc4c0571eede2cdd3b094ee94875c69b32fd3ca238e643','sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','sha256:ea9836078d6c0aeabd829b5eeec3d164bd96fe5386c750be52fa8004f8ea4301','sdar.evidence/v1','sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f','sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71','freeze_candidate','ready_for_r2','integrations/sdar-benchmark/v0.1','sha256:812876719f3b5c4721a8883566ab29cdf191e7b2f0c1ad9b2ef44ed0456b98cb',1);

INSERT INTO sdar_meta.benchmark_operator_definition (tenant_id,project_id,record_id,catalog_id,catalog_version,catalog_hash,operator_id,operator_version,content_hash,kind,semantics,input_schema_json,status,projection_revision,projected_at) VALUES
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.eq',1,'sha256:29618b30ac91239e586ec4d7ad644096ab6524c5fc189b3af183fbe03bb3156b','predicate','Actual value equals expected value.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.neq',1,'sha256:0bc7c1fa76f02b0e2eb39c7cb4bf1029b637291312b1aa85f5516e116008072f','predicate','Actual value differs from expected value.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.gt',1,'sha256:e0076a3a2a4d91af22c53c82985e31895e60b7b35673072bfdc9844de33c3c93','predicate','Actual numeric value is greater than expected.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.gte',1,'sha256:55776297d53dd820b08af8d75ca7209d411178ffd14f42a00acfaa2472d91a3a','predicate','Actual numeric value is greater than or equal to expected.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.lt',1,'sha256:b264ced22d36dc090dfce190ae3a09393f561704aafc906da63a166eaf0134a8','predicate','Actual numeric value is less than expected.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.lte',1,'sha256:b3bc14bb952287bb00e3d917120a6266fc71b9ad6096dc8ea7d890a7d43c0b6b','predicate','Actual numeric value is less than or equal to expected.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.contains',1,'sha256:b72c68635340c86235ad5590559e824903e90f6cfca0acc8be23d1e0512c6943','predicate','String or array contains expected value.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.not_contains',1,'sha256:c17070b846b2fbf2379d2aa42e778d5039640e4bc09a60e53e4cb58cdf4dbaff','predicate','String or array does not contain expected value.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.exists',1,'sha256:415a6d8c3e0759855c438bee81fb36e2bebd79602078821cb67ae78a3716b95d','predicate','Selected JSON Pointer exists.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.not_exists',1,'sha256:c020b529c4ad6f7a61235b5b427e3783426bc3b44a6b801672ced7f0acd4b407','predicate','Selected JSON Pointer does not exist.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.count_eq',1,'sha256:7c9fe2b06df712bd5d5ad4a48edfb03bdb887956cf18b49f7c814e4ccdf2404e','aggregate','Selected record count equals expected integer.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.count_gte',1,'sha256:d01d6dd4496fefef8315159a68a01bd4251f414ed1356bcca3c84be098615f9b','aggregate','Selected record count is at least expected integer.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.count_lte',1,'sha256:9689e3a2655ae29f06daafe7e2a1a5d75edae9ed2c7ace57da35e8c98b95c5c7','aggregate','Selected record count is at most expected integer.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.all',1,'sha256:303c3564261fd55dfdfe797716b49221ad5e4d28f2f969528337f18bd40e7892','aggregate','All selected values satisfy the nested condition.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.any',1,'sha256:49815139e0773863e8c31eaabc676759194b7ced90b1539cbe9ff6b30f0a7993','aggregate','At least one selected value satisfies the nested condition.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-operator-catalog',1,'sha256:c2e63dfbb506b9a25f1d418d412151352931459369d8637874bda385337c222f','operator.none',1,'sha256:3706109a84b3ec35ed23006a548ec4101a5b655a04fc36a4f25fd4c1cdf46c3e','aggregate','No selected values satisfy the nested condition.','{}','freeze_candidate',1,now64(3));

INSERT INTO sdar_meta.benchmark_relation_definition (tenant_id,project_id,record_id,catalog_id,catalog_version,catalog_hash,relation_id,relation_version,content_hash,kind,semantics,input_schema_json,status,projection_revision,projected_at) VALUES
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','relation.references',1,'sha256:88fc1b4a23daf4439a66d4f8d9d8b7fa762c844d9e3ef7bd670345a52a6294c2','semantic','Source record explicitly references target record.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','relation.caused_by',1,'sha256:3d3efe5b0df638d4e5487ad6e4df31587398689ca056f696e258e339f110bce1','semantic','Source record causation chain contains target record.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','relation.belongs_to',1,'sha256:72a24de1c37104c185d9d958665aa049459b1d6f32f333ba383dbe89cddae0a9','semantic','Source record belongs to the target aggregate.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','relation.produced_by',1,'sha256:1de811267c2cc4bbe7864b4086e3996fa94c219822f91cbf0953ea266d70c796','semantic','Source fact was produced by the target decision, plan, skill, or action.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','relation.verified_by',1,'sha256:6141eb3556f156c177bd1ff6865720cafd50d37c568cfadde7c809bf89a1c322','semantic','Source outcome or action is verified by target verification evidence.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','temporal.before',1,'sha256:84eb0f733c71583fcd5e07d4b960585edc72d1a47b9b6c92009fd158b7411fba','temporal','Every matched predecessor occurs before the matched successor.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','temporal.not_after',1,'sha256:d1b90098d08be47a52229a14893f573abd0b8c38300120fe80d577b1db524ef0','temporal','Predecessor occurs no later than successor.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-relation-catalog',1,'sha256:bca19f9947ea68a125251f2a0b0410c5ce7d231e3b80ee31c2b0a0caa574b7c6','temporal.directly_before',1,'sha256:9dbf1924794b80b2afcccf68a07cf3975050c917b80a0b42ebe5e19e525ff412','temporal','Predecessor is the immediately previous matched event in canonical order.','{}','freeze_candidate',1,now64(3));

INSERT INTO sdar_meta.benchmark_invariant_definition (tenant_id,project_id,record_id,catalog_id,catalog_version,catalog_hash,invariant_id,invariant_version,content_hash,kind,semantics,input_schema_json,status,projection_revision,projected_at) VALUES
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','STATE_VERSION_MONOTONIC',1,'sha256:0d2dc0545c235c888bd9e575c955500c68b9fc8af3a496403822c75073917060','integrity','State versions never decrease within an episode.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','EVIDENCE_SEQUENCE_CONTIGUOUS',1,'sha256:cf231ae18af05c153051b8369949adbfea54614a8fb3e7033343578564eb6083','integrity','Required evidence sequence is contiguous for a sealed episode.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','NO_DUPLICATE_SIDE_EFFECT',1,'sha256:0b23f18a532fa1b08c676207a8cff2499bdb631916cbd8f0e0118fc1782f3dec','safety','No side-effecting action with the same idempotency identity is executed more than once.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','CONFIRMATION_BEFORE_ACTION',1,'sha256:2f9a2ee51f4f186dfa9322e5d7614ebef31dcafc80d22c91a25be5679f4c2d6d','ordering','Required human confirmation is valid before action dispatch.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','RECEIPT_BEFORE_VERIFICATION',1,'sha256:edd228579c732b9e70005824f9ca737e4694bbb46ca30ecdc0fc026d88753294','ordering','Verification relying on an action receipt occurs after the receipt.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','PLAN_COMPLIANCE_BEFORE_ACTION',1,'sha256:bef70ce95742903a4c6a96152ab1a7c1231b4088e272770cb373060a06dc3028','ordering','Plan compliance passes before any governed action is dispatched.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','REMOTE_BINDING_BEFORE_EXTERNAL_WAIT',1,'sha256:41c499cd3510e59ee4a0f24e0a200bbb7c632fd5d52319382f938065312316bf','ordering','RemoteTaskBinding is persisted before workflow external wait.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','CONTROL_EVENT_BEFORE_CONTINUATION',1,'sha256:467808f89e1fa27406c2137a5c8b46618c7a4a5192db0d516731224cc63f42cd','ordering','Remote task control event is persisted before continuation attempt.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','REMOTE_TASK_COMPLETED_REQUIRES_VERIFICATION',1,'sha256:8ece1f4bbabf5da96c6c50b3307c355b08b72c9aa525bea827f12371af30b0ed','consistency','Remote task completion alone cannot establish goal achievement.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','CANCEL_REQUEST_NOT_TERMINAL',1,'sha256:692a97eac91012bdaf9b293862b0633217848f4a205f02f952ff7dd863f95715','consistency','Cancel request does not equal provider-confirmed cancellation.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','OUTCOME_CONSISTENT_WITH_VERIFICATION',1,'sha256:74c0b0d91795736097ebcac5778bbecbb5cf1658dad8451e2df6c769a03923e9','consistency','Outcome status is consistent with critical verification results.','{}','freeze_candidate',1,now64(3)),
('global','global',generateUUIDv4(),'sdar-benchmark-invariant-catalog',1,'sha256:d21257ef04e9403981f84575c01d53ad2700b3ca147cd42b5cfe0188711c5505','NO_STALE_PLAN_EXECUTION',1,'sha256:f20d5aea49dfbc03af3abfc500e1513fa86e4fd200d7907271de600c34d200f6','safety','Action does not execute against a superseded or stale plan version.','{}','freeze_candidate',1,now64(3));
