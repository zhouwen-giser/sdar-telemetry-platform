-- Additive extension to RC2 (00..26 unchanged). No legacy source/table is rewritten.
-- The consumer pins closure_snapshot_id. Only a final manifest makes details visible.
CREATE TABLE IF NOT EXISTS sdar_mart.provider_closure_manifest_v2 (
 tenant_id String, project_id String, environment String, episode_id String,
 closure_snapshot_id String, binding_count UInt64, binding_derived_relation_count UInt64,
 expected_fact_count UInt64, selected_fact_count UInt64, foreign_fact_count UInt64,
 unresolved_binding_count UInt64, page_count UInt64, truncated Bool, hints_used_for_authority Bool,
 binding_authority_hash String, binding_authority_ref String,
 as_of_projected_at DateTime64(3,'UTC'), effective_watermark DateTime64(3,'UTC'),
 selection_predicate_hash String, reconciliation_hash String, closure_content_hash String,
 status String, reason_codes Array(String), origin_claim_count UInt64, relation_hint_count UInt64,
 matched_claim_count UInt64, missing_claim_count UInt64, unverifiable_claim_count UInt64,
 ambiguous_claim_count UInt64, conflicting_claim_count UInt64,
 goal_success_proven Bool DEFAULT false, physical_success_proven Bool DEFAULT false,
 projected_at DateTime64(3,'UTC'), provenance_json String
) ENGINE=ReplacingMergeTree(projected_at)
ORDER BY (tenant_id,project_id,environment,episode_id,closure_snapshot_id);

CREATE TABLE IF NOT EXISTS sdar_mart.provider_closure_binding_v2 (
 tenant_id String, project_id String, environment String, episode_id String, closure_snapshot_id String,
 binding_id String, a2a_task_id String, remote_task_id String, provider_origin_source_id String,
 external_provider_id String, external_provider_instance_id Nullable(String), binding_revision String,
 updated_at DateTime64(3,'UTC'), projected_at DateTime64(3,'UTC')
) ENGINE=ReplacingMergeTree(projected_at)
ORDER BY (tenant_id,project_id,environment,episode_id,closure_snapshot_id,binding_id);

CREATE TABLE IF NOT EXISTS sdar_mart.provider_closure_fact_v2 (
 tenant_id String, project_id String, environment String, episode_id String, closure_snapshot_id String,
 binding_id String, remote_task_id String, provider_origin_source_id String, external_provider_id String,
 external_provider_instance_id Nullable(String), fact_id String, fact_hash String, fact_type String,
 external_task_id String, occurred_at DateTime64(3,'UTC'), projected_at DateTime64(3,'UTC')
) ENGINE=ReplacingMergeTree(projected_at)
ORDER BY (tenant_id,project_id,environment,episode_id,closure_snapshot_id,fact_id);

CREATE TABLE IF NOT EXISTS sdar_mart.provider_closure_relation_v2 (
 tenant_id String, project_id String, environment String, episode_id String, closure_snapshot_id String,
 binding_id String, relation_id String, authority_source String, content_hash String,
 projected_at DateTime64(3,'UTC')
) ENGINE=ReplacingMergeTree(projected_at)
ORDER BY (tenant_id,project_id,environment,episode_id,closure_snapshot_id,relation_id);

CREATE TABLE IF NOT EXISTS sdar_mart.provider_closure_reconciliation_v2 (
 tenant_id String, project_id String, environment String, episode_id String, closure_snapshot_id String,
 claim_id String, claim_type String, claim_values Array(String), authoritative_refs Array(String),
 status String, blocking Bool, reason_codes Array(String), evidence_fact_ids Array(String),
 relation_hint_ids Array(String), policy_id String, policy_version String, projected_at DateTime64(3,'UTC')
) ENGINE=ReplacingMergeTree(projected_at)
ORDER BY (tenant_id,project_id,environment,episode_id,closure_snapshot_id,claim_id);

CREATE VIEW IF NOT EXISTS sdar_mart.v_episode_smpp_provider_readiness AS
 SELECT * FROM sdar_mart.provider_closure_manifest_v2 FINAL;
CREATE VIEW IF NOT EXISTS sdar_mart.v_episode_smpp_provider_binding_closure AS
 SELECT d.* FROM sdar_mart.provider_closure_binding_v2 AS d FINAL
 INNER JOIN (SELECT tenant_id,project_id,environment,episode_id,closure_snapshot_id FROM sdar_mart.provider_closure_manifest_v2 FINAL) AS m
 USING (tenant_id,project_id,environment,episode_id,closure_snapshot_id);
CREATE VIEW IF NOT EXISTS sdar_mart.v_episode_smpp_provider_fact_closure AS
 SELECT d.* FROM sdar_mart.provider_closure_fact_v2 AS d FINAL
 INNER JOIN (SELECT tenant_id,project_id,environment,episode_id,closure_snapshot_id FROM sdar_mart.provider_closure_manifest_v2 FINAL) AS m
 USING (tenant_id,project_id,environment,episode_id,closure_snapshot_id);
CREATE VIEW IF NOT EXISTS sdar_mart.v_episode_smpp_binding_relation_closure AS
 SELECT d.* FROM sdar_mart.provider_closure_relation_v2 AS d FINAL
 INNER JOIN (SELECT tenant_id,project_id,environment,episode_id,closure_snapshot_id FROM sdar_mart.provider_closure_manifest_v2 FINAL) AS m
 USING (tenant_id,project_id,environment,episode_id,closure_snapshot_id);
CREATE VIEW IF NOT EXISTS sdar_mart.v_episode_smpp_origin_claim_reconciliation AS
 SELECT d.* FROM sdar_mart.provider_closure_reconciliation_v2 AS d FINAL
 INNER JOIN (SELECT tenant_id,project_id,environment,episode_id,closure_snapshot_id FROM sdar_mart.provider_closure_manifest_v2 FINAL) AS m
 USING (tenant_id,project_id,environment,episode_id,closure_snapshot_id);
