-- Fixed consumer queries for sdar.telemetry-domain-handoff/v1.
-- Values are ClickHouse named parameters. Identifiers are immutable and must never be caller supplied.
SELECT release_version, migration_range, release_descriptor_hash, schema_contract_hash,
       source_contract_count, episode_seal_contract_count, projection_identity_count,
       projection_set_count, active_domain_projection_count, status
FROM sdar_meta.v_schema_contract_release_current
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
LIMIT 1;

SELECT * FROM sdar_meta.v_domain_source_contract_definition_current
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
ORDER BY application, source_contract_id LIMIT 100;

SELECT * FROM sdar_meta.v_domain_projection_health
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
ORDER BY projection_id, projection_version LIMIT 100;

SELECT * FROM sdar_meta.v_domain_projection_set_readiness
WHERE projection_set_id = {projectionSetId:String}
  AND projection_set_version = {projectionSetVersion:String}
LIMIT 1;

SELECT * FROM sdar_meta.v_episode_projection_readiness
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
  AND episode_id = {episodeId:String} AND projection_set_id = {projectionSetId:String}
  AND projection_set_version = {projectionSetVersion:String}
ORDER BY projection_id, projection_version LIMIT 100;

SELECT * FROM sdar_mart.v_episode_domain_readiness
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
  AND episode_id = {episodeId:String} AND projection_set_id = {projectionSetId:String}
  AND projection_set_version = {projectionSetVersion:String}
LIMIT 1;

SELECT * FROM sdar_embodied.v_episode_domain_fact_index
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
  AND (episode_key = {episodeId:String} OR canonical_episode_id = {episodeId:String})
ORDER BY occurred_at, projection_id, target_table, target_record_id LIMIT 1000;
