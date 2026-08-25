CREATE TABLE IF NOT EXISTS sdar_meta.domain_projection_health_snapshot
(
    tenant_id String,
    project_id String,
    projection_id String,
    projection_version String,
    definition_status LowCardinality(String),
    version_status LowCardinality(String),
    last_run_status String,
    last_run_updated_at DateTime64(3, 'UTC'),
    schema_drift_status String,
    checkpoint_watermark Nullable(DateTime64(3, 'UTC')),
    last_source_sequence UInt64,
    produced_count UInt64,
    skipped_count UInt64,
    failed_count UInt64,
    unresolved_blocking_dlq_count UInt64,
    lineage_issue_count UInt64,
    health_status String,
    reason_codes Array(String)
)
ENGINE = ReplacingMergeTree(last_run_updated_at)
ORDER BY (tenant_id, project_id, projection_id, projection_version);

INSERT INTO sdar_meta.domain_projection_health_snapshot
(tenant_id, project_id, projection_id, projection_version, definition_status, version_status, last_run_status, last_run_updated_at, schema_drift_status, checkpoint_watermark, last_source_sequence, produced_count, skipped_count, failed_count, unresolved_blocking_dlq_count, lineage_issue_count, health_status, reason_codes) VALUES
('global', 'global', 'application_to_embodied.dp-c01', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-c02', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-c03', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-c04', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-c05', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-n01', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-n02', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-n03', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-n04', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']),
('global', 'global', 'application_to_embodied.dp-n05', '1', 'disabled', 'disabled', 'not_run', toDateTime64('1970-01-01 00:00:00.000', 3, 'UTC'), 'not_checked', NULL, 0, 0, 0, 0, 0, 0, 'defined_disabled', ['development_seed', 'projection_disabled']);

CREATE VIEW IF NOT EXISTS sdar_meta.v_domain_projection_health AS
SELECT
    tenant_id,
    project_id,
    projection_id,
    projection_version,
    definition_status,
    version_status,
    last_run_status,
    last_run_updated_at,
    schema_drift_status,
    checkpoint_watermark,
    last_source_sequence,
    produced_count,
    skipped_count,
    failed_count,
    unresolved_blocking_dlq_count,
    lineage_issue_count,
    health_status,
    reason_codes
FROM sdar_meta.domain_projection_health_snapshot FINAL;
