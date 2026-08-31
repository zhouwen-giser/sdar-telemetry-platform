-- Additive MCP Tasks semantic detail for the existing Provider Closure v2 handoff.
-- RC2 vendor migrations 00..26 and migration 015 remain byte-for-byte unchanged.
ALTER TABLE sdar_mart.provider_closure_manifest_v2
  ADD COLUMN IF NOT EXISTS unresolved_execution_count UInt64 DEFAULT 0 AFTER unresolved_binding_count;
ALTER TABLE sdar_mart.provider_closure_manifest_v2
  ADD COLUMN IF NOT EXISTS conflicting_execution_count UInt64 DEFAULT 0 AFTER unresolved_execution_count;
ALTER TABLE sdar_mart.provider_closure_manifest_v2
  ADD COLUMN IF NOT EXISTS uncertain_dispatch_count UInt64 DEFAULT 0 AFTER conflicting_execution_count;
ALTER TABLE sdar_mart.provider_closure_manifest_v2
  ADD COLUMN IF NOT EXISTS unresolved_reconciliation_count UInt64 DEFAULT 0 AFTER uncertain_dispatch_count;
ALTER TABLE sdar_mart.provider_closure_manifest_v2
  ADD COLUMN IF NOT EXISTS terminal_conflict_count UInt64 DEFAULT 0 AFTER unresolved_reconciliation_count;
ALTER TABLE sdar_mart.provider_closure_manifest_v2
  ADD COLUMN IF NOT EXISTS identity_hash_conflict_count UInt64 DEFAULT 0 AFTER terminal_conflict_count;

ALTER TABLE sdar_mart.provider_closure_fact_v2
  ADD COLUMN IF NOT EXISTS external_execution_id Nullable(String) AFTER external_task_id;
ALTER TABLE sdar_mart.provider_closure_fact_v2
  ADD COLUMN IF NOT EXISTS observed_at Nullable(DateTime64(3,'UTC')) AFTER occurred_at;
ALTER TABLE sdar_mart.provider_closure_fact_v2
  ADD COLUMN IF NOT EXISTS source_record_id String DEFAULT '' AFTER fact_type;
ALTER TABLE sdar_mart.provider_closure_fact_v2
  ADD COLUMN IF NOT EXISTS source_record_hash String DEFAULT '' AFTER source_record_id;

CREATE OR REPLACE VIEW sdar_mart.v_episode_smpp_provider_readiness AS
 SELECT * FROM sdar_mart.provider_closure_manifest_v2 FINAL;
CREATE OR REPLACE VIEW sdar_mart.v_episode_smpp_provider_fact_closure AS
 SELECT d.* FROM sdar_mart.provider_closure_fact_v2 AS d FINAL
 INNER JOIN (
   SELECT tenant_id,project_id,environment,episode_id,closure_snapshot_id
   FROM sdar_mart.provider_closure_manifest_v2 FINAL
 ) AS m USING (tenant_id,project_id,environment,episode_id,closure_snapshot_id);

CREATE TABLE IF NOT EXISTS sdar_mart.provider_closure_task_semantic_v2 (
 tenant_id String, project_id String, environment String, episode_id String,
 closure_snapshot_id String, binding_id String, remote_task_id String,
 provider_source_id String, provider_id String, provider_instance_id Nullable(String),
 execution_status LowCardinality(String), candidate_execution_ids Array(String),
 selected_execution_id Nullable(String), execution_source_fact_ids Array(String),
 execution_source_relation_ids Array(String), identity_conflict Bool,
 dispatch_status LowCardinality(String), reconciliation_status LowCardinality(String),
 uncertainty_fact_ids Array(String), reconciliation_fact_ids Array(String),
 mcp_task_control_state LowCardinality(String), provider_execution_state LowCardinality(String),
 provider_business_outcome LowCardinality(String), terminal_fact_ids Array(String), terminal_conflict Bool,
 mission_status LowCardinality(String), device_mission_ids Array(String),
 mission_source_fact_ids Array(String), mission_source_relation_ids Array(String),
 reason_codes Array(String), content_hash String, projected_at DateTime64(3,'UTC')
) ENGINE=ReplacingMergeTree(projected_at)
ORDER BY (tenant_id,project_id,environment,episode_id,closure_snapshot_id,binding_id);

CREATE VIEW IF NOT EXISTS sdar_mart.v_episode_smpp_provider_task_semantic_closure AS
 SELECT d.* FROM sdar_mart.provider_closure_task_semantic_v2 AS d FINAL
 INNER JOIN (
   SELECT tenant_id,project_id,environment,episode_id,closure_snapshot_id
   FROM sdar_mart.provider_closure_manifest_v2 FINAL
 ) AS m USING (tenant_id,project_id,environment,episode_id,closure_snapshot_id);
