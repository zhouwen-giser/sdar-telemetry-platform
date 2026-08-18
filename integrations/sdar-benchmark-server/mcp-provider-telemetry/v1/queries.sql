-- Fixed read-only examples for sdar.telemetry-smpp-providerops-handoff/v1.
-- Values are named parameters. Database, table and View identifiers are immutable.
SELECT * FROM sdar_core.external_provider_fact FINAL
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
  AND smpp_source_id = {smppSourceId:String}
ORDER BY occurred_at, fact_id LIMIT 1000;

SELECT * FROM sdar_core.external_entity_relation_fact FINAL
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
  AND smpp_source_id = {smppSourceId:String}
ORDER BY valid_from, relation_id LIMIT 1000;

SELECT episode_id, a2a_task_id, remote_task_id, protocol_status,
       current_provider_substate, current_observation_revision, updated_at
FROM sdar_core.remote_task_binding FINAL
WHERE toString(episode_id) = {episodeId:String}
ORDER BY updated_at, binding_id LIMIT 1000;

SELECT * FROM sdar_core.v_smpp_provider_task_timeline
WHERE external_task_id = {externalTaskId:String}
ORDER BY occurred_at, projected_at LIMIT 1000;

SELECT * FROM sdar_core.v_smpp_resource_current_state
WHERE resource_id = {resourceId:String} LIMIT 1000;

SELECT * FROM sdar_core.v_smpp_resource_current_health
WHERE resource_id = {resourceId:String} LIMIT 1000;

SELECT * FROM sdar_core.v_smpp_execution_latest_progress
WHERE external_execution_id = {externalExecutionId:String} LIMIT 1000;

SELECT * FROM sdar_core.v_sdar_smpp_task_reconciliation
WHERE tenant_id = {tenantId:String} AND project_id = {projectId:String}
ORDER BY binding_id LIMIT 1000;

SELECT * FROM sdar_core.v_sdar_smpp_execution_topology
WHERE smpp_source_id = {smppSourceId:String}
ORDER BY valid_from, relation_id LIMIT 1000;
