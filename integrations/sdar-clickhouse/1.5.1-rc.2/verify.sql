-- Read-only SDAR ClickHouse 1.5.1-rc.2 post-install verification.
SELECT version() AS clickhouse_version;
SELECT throwIf(count()!=6,'expected six SDAR databases') FROM system.databases
WHERE name IN ('sdar_meta','sdar_core','sdar_commander','sdar_npc','sdar_embodied','sdar_mart');
SELECT throwIf(count()!=4,'expected four Domain readiness/health views') FROM system.tables
WHERE (database='sdar_meta' AND name IN ('v_domain_projection_health','v_domain_projection_set_readiness','v_episode_projection_readiness'))
   OR (database='sdar_mart' AND name='v_episode_domain_readiness');
SELECT throwIf(countIf(position(name,'.')>0)>0,'qualified output columns remain') FROM system.columns
WHERE database='sdar_meta' AND table='v_domain_projection_health';
SELECT * FROM sdar_meta.v_domain_projection_health LIMIT 0;
SELECT * FROM sdar_meta.v_domain_projection_set_readiness LIMIT 0;
SELECT * FROM sdar_meta.v_episode_projection_readiness LIMIT 0;
SELECT * FROM sdar_mart.v_episode_domain_readiness LIMIT 0;
SELECT * FROM sdar_embodied.v_episode_domain_fact_index LIMIT 0;
SELECT release_version,migration_range,status,package_generation
FROM sdar_meta.v_schema_contract_release_current;
