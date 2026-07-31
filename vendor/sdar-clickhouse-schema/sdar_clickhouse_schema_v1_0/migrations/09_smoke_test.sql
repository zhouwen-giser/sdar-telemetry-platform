-- SDAR ClickHouse Schema V1.1
-- Executable fresh-install assertions. Any failed invariant aborts the client.

SELECT throwIf(count() != 6, 'SMOKE: expected six SDAR databases')
FROM system.databases
WHERE name IN ('sdar_meta', 'sdar_core', 'sdar_commander', 'sdar_npc', 'sdar_embodied', 'sdar_mart');

SELECT throwIf(countIf(engine != 'View') != 19, 'SMOKE: sdar_meta physical table count mismatch')
FROM system.tables WHERE database = 'sdar_meta';

SELECT throwIf(countIf(engine != 'View') != 44, 'SMOKE: sdar_core physical table count mismatch')
FROM system.tables WHERE database = 'sdar_core';

SELECT throwIf(countIf(engine != 'View') != 37, 'SMOKE: sdar_commander physical table count mismatch')
FROM system.tables WHERE database = 'sdar_commander';

SELECT throwIf(countIf(engine != 'View') != 39, 'SMOKE: sdar_npc physical table count mismatch')
FROM system.tables WHERE database = 'sdar_npc';

SELECT throwIf(countIf(engine != 'View') != 30, 'SMOKE: sdar_embodied physical table count mismatch')
FROM system.tables WHERE database = 'sdar_embodied';

SELECT throwIf(countIf(engine != 'View') != 4, 'SMOKE: sdar_mart physical table count mismatch')
FROM system.tables WHERE database = 'sdar_mart';

-- Required compatibility and quality views.
SELECT throwIf(count() != 10, 'SMOKE: required sdar_core quality views are missing')
FROM system.tables
WHERE database = 'sdar_core'
  AND name IN
  (
      'v_evidence_sequence_gap',
      'v_duplicate_evidence_sequence',
      'v_unsealed_episode',
      'v_terminal_state_mismatch',
      'v_remote_task_without_terminal',
      'v_unprocessed_control_event',
      'v_uncertain_cancellation',
      'v_not_ready_evaluation',
      'v_completed_action_without_passed_verification',
      'v_domain_projection_reference_issue'
  );

SELECT throwIf(count() != 3, 'SMOKE: required commander quality views are missing')
FROM system.tables
WHERE database = 'sdar_commander'
  AND name IN ('v_orphan_action', 'v_completed_without_verification', 'v_bundle_final_state_not_latest');

SELECT throwIf(count() != 3, 'SMOKE: required npc quality views are missing')
FROM system.tables
WHERE database = 'sdar_npc'
  AND name IN ('v_orphan_action', 'v_completed_without_verification', 'v_bundle_final_state_not_latest');

SELECT throwIf(count() != 10, 'SMOKE: required embodied latest/quality views are missing')
FROM system.tables
WHERE database = 'sdar_embodied'
  AND name IN
  (
      'v_episode_latest',
      'v_episode_evidence_bundle_manifest_latest',
      'v_evaluation_readiness_latest',
      'v_readiness_issue',
      'v_missing_readiness',
      'v_invalid_physical_verification_source',
      'v_minimal_evidence_overclaim',
      'v_control_authority_conflict',
      'v_resource_claim_conflict',
      'v_duplicate_control_dispatch'
  );

SELECT throwIf(count() != 16, 'SMOKE: mart compatibility view count mismatch')
FROM system.tables
WHERE database = 'sdar_mart'
  AND name IN
  (
      'general_evaluation_result', 'general_metric_result', 'general_gate_result', 'general_fatal_error',
      'embodied_evaluation_result', 'embodied_metric_result', 'embodied_gate_result', 'embodied_fatal_error',
      'commander_evaluation_result', 'commander_metric_result', 'commander_gate_result', 'commander_fatal_error',
      'npc_evaluation_result', 'npc_metric_result', 'npc_gate_result', 'npc_fatal_error'
  );

SELECT throwIf(count() != 6, 'SMOKE: required mart quality views are missing')
FROM system.tables
WHERE database = 'sdar_mart'
  AND name IN
  (
      'v_evaluation_orphan_child',
      'v_evaluation_provenance_mismatch',
      'v_evaluation_outcome_inconsistent',
      'v_evaluation_duplicate_payload_conflict',
      'v_evaluation_score_reconciliation_issue',
      'v_evaluation_rule_set_registry_mismatch'
  );

-- Seed completeness and policy invariants.
SELECT throwIf(count() != 103, 'SMOKE: event_definition must contain 103 catalog events')
FROM sdar_meta.event_definition FINAL
WHERE catalog_version = '1.1' AND status = 'active';

SELECT throwIf(count() != 103, 'SMOKE: event_policy must contain 103 catalog policies')
FROM sdar_meta.event_policy FINAL
WHERE catalog_version = '1.1' AND status = 'active';

SELECT throwIf(
    countIf(delivery_class = 'durable' AND sampling_allowed != 0) > 0
    OR countIf(delivery_class = 'best_effort' AND required_for_evaluation != 0) > 0,
    'SMOKE: event delivery/sampling policy conflict'
)
FROM sdar_meta.event_policy FINAL
WHERE catalog_version = '1.1' AND status = 'active';

SELECT throwIf(count() != 1, 'SMOKE: canonical UUID namespace seed mismatch')
FROM sdar_meta.id_namespace_definition FINAL
WHERE namespace_name = 'sdar-canonical-v1'
  AND namespace_uuid = toUUID('5832c301-3d9e-5927-8f15-fa6262c8fc4e')
  AND status = 'active';

SELECT throwIf(count() != 2, 'SMOKE: expected two active projection definitions')
FROM sdar_meta.projection_definition FINAL
WHERE projection_id IN ('application_to_embodied', 'embodied_to_core') AND status = 'active';

SELECT throwIf(count() != 2, 'SMOKE: projection mapping hash does not match mapping_document')
FROM sdar_meta.projection_version FINAL
WHERE projection_version = '1.1.0'
  AND status = 'active'
  AND lower(toString(mapping_hash)) = lower(hex(SHA256(mapping_document)));

SELECT throwIf(count() != 4, 'SMOKE: expected four independent draft evaluation profiles')
FROM sdar_meta.evaluation_profile_definition FINAL
WHERE status = 'draft';

SELECT throwIf(count() != 4, 'SMOKE: each profile must have 15 metrics with total weight 100')
FROM
(
    SELECT
        evaluation_tier,
        profile,
        profile_version,
        metric_set_version
    FROM sdar_meta.metric_definition FINAL
    WHERE status = 'draft'
    GROUP BY evaluation_tier, profile, profile_version, metric_set_version
    HAVING count() = 15 AND abs(sum(weight) - 100.0) < 0.000001
);

SELECT throwIf(count() != 4, 'SMOKE: each profile must have seven gates')
FROM
(
    SELECT evaluation_tier, profile, profile_version, gate_set_version
    FROM sdar_meta.gate_definition FINAL
    WHERE status = 'draft'
    GROUP BY evaluation_tier, profile, profile_version, gate_set_version
    HAVING count() = 7
);

SELECT throwIf(count() != 4, 'SMOKE: each profile must have seven fatal rules')
FROM
(
    SELECT evaluation_tier, profile, profile_version, fatal_set_version
    FROM sdar_meta.fatal_definition FINAL
    WHERE status = 'draft'
    GROUP BY evaluation_tier, profile, profile_version, fatal_set_version
    HAVING count() = 7
);

SELECT throwIf(
    count() != 12
    OR countIf(canonicalization_version != 'sdar-rule-set-c14n-v1') != 0
    OR countIf(NOT match(toString(rule_set_hash), '^[0-9a-f]{64}$')) != 0,
    'SMOKE: expected 12 verifiable draft evaluation rule sets'
)
FROM sdar_meta.evaluation_rule_set_definition FINAL
WHERE status = 'draft';

SELECT throwIf(count() != 4, 'SMOKE: every draft profile must link one 15-definition metric set')
FROM
(
    SELECT
        p.tenant_id,
        p.project_id,
        p.framework,
        p.framework_version,
        p.evaluation_tier,
        p.profile,
        p.profile_version,
        p.metric_set_id,
        p.metric_set_version
    FROM (SELECT * FROM sdar_meta.evaluation_profile_definition FINAL WHERE status = 'draft') AS p
    INNER JOIN
    (
        SELECT *
        FROM sdar_meta.evaluation_rule_set_definition FINAL
        WHERE status = 'draft' AND rule_set_kind = 'metric' AND definition_count = 15
    ) AS r
        ON r.tenant_id = p.tenant_id
       AND r.project_id = p.project_id
       AND r.framework = p.framework
       AND r.framework_version = p.framework_version
       AND r.evaluation_tier = p.evaluation_tier
       AND r.profile = p.profile
       AND r.profile_version = p.profile_version
       AND r.rule_set_id = p.metric_set_id
       AND r.rule_set_version = p.metric_set_version
    GROUP BY
        p.tenant_id,
        p.project_id,
        p.framework,
        p.framework_version,
        p.evaluation_tier,
        p.profile,
        p.profile_version,
        p.metric_set_id,
        p.metric_set_version
    HAVING count() = 1
);

SELECT throwIf(count() != 4, 'SMOKE: every draft profile must link one 7-definition gate set')
FROM
(
    SELECT
        p.tenant_id,
        p.project_id,
        p.framework,
        p.framework_version,
        p.evaluation_tier,
        p.profile,
        p.profile_version,
        p.gate_set_id,
        p.gate_set_version
    FROM (SELECT * FROM sdar_meta.evaluation_profile_definition FINAL WHERE status = 'draft') AS p
    INNER JOIN
    (
        SELECT *
        FROM sdar_meta.evaluation_rule_set_definition FINAL
        WHERE status = 'draft' AND rule_set_kind = 'gate' AND definition_count = 7
    ) AS r
        ON r.tenant_id = p.tenant_id
       AND r.project_id = p.project_id
       AND r.framework = p.framework
       AND r.framework_version = p.framework_version
       AND r.evaluation_tier = p.evaluation_tier
       AND r.profile = p.profile
       AND r.profile_version = p.profile_version
       AND r.rule_set_id = p.gate_set_id
       AND r.rule_set_version = p.gate_set_version
    GROUP BY
        p.tenant_id,
        p.project_id,
        p.framework,
        p.framework_version,
        p.evaluation_tier,
        p.profile,
        p.profile_version,
        p.gate_set_id,
        p.gate_set_version
    HAVING count() = 1
);

SELECT throwIf(count() != 4, 'SMOKE: every draft profile must link one 7-definition fatal set')
FROM
(
    SELECT
        p.tenant_id,
        p.project_id,
        p.framework,
        p.framework_version,
        p.evaluation_tier,
        p.profile,
        p.profile_version,
        p.fatal_set_id,
        p.fatal_set_version
    FROM (SELECT * FROM sdar_meta.evaluation_profile_definition FINAL WHERE status = 'draft') AS p
    INNER JOIN
    (
        SELECT *
        FROM sdar_meta.evaluation_rule_set_definition FINAL
        WHERE status = 'draft' AND rule_set_kind = 'fatal' AND definition_count = 7
    ) AS r
        ON r.tenant_id = p.tenant_id
       AND r.project_id = p.project_id
       AND r.framework = p.framework
       AND r.framework_version = p.framework_version
       AND r.evaluation_tier = p.evaluation_tier
       AND r.profile = p.profile
       AND r.profile_version = p.profile_version
       AND r.rule_set_id = p.fatal_set_id
       AND r.rule_set_version = p.fatal_set_version
    GROUP BY
        p.tenant_id,
        p.project_id,
        p.framework,
        p.framework_version,
        p.evaluation_tier,
        p.profile,
        p.profile_version,
        p.fatal_set_id,
        p.fatal_set_version
    HAVING count() = 1
);

-- Physical contract checks that are easy to regress during regeneration.
SELECT throwIf(count() != 37, 'SMOKE: every commander table needs payload_sha256')
FROM
(
    SELECT DISTINCT table
    FROM system.columns
    WHERE database = 'sdar_commander'
      AND name = 'payload_sha256'
      AND table IN (SELECT name FROM system.tables WHERE database = 'sdar_commander' AND engine != 'View')
);

SELECT throwIf(count() != 39, 'SMOKE: every npc table needs payload_sha256')
FROM
(
    SELECT DISTINCT table
    FROM system.columns
    WHERE database = 'sdar_npc'
      AND name = 'payload_sha256'
      AND table IN (SELECT name FROM system.tables WHERE database = 'sdar_npc' AND engine != 'View')
);

SELECT throwIf(count() != 30, 'SMOKE: every embodied table needs canonical run/environment/provenance columns')
FROM
(
    SELECT table
    FROM system.columns
    WHERE database = 'sdar_embodied'
      AND name IN
      (
          'run_id', 'segment_id', 'run_sequence', 'payload_sha256',
          'source_deployment_id', 'source_environment_raw',
          'environment_mapping_id', 'environment_map_version'
      )
      AND table IN (SELECT name FROM system.tables WHERE database = 'sdar_embodied' AND engine != 'View')
    GROUP BY table
    HAVING countDistinct(name) = 8
);

SELECT throwIf(count() != 30, 'SMOKE: every embodied table needs run/environment CHECK constraints')
FROM system.tables
WHERE database = 'sdar_embodied'
  AND engine != 'View'
  AND position(create_table_query, 'ck_embodied_run_sequence') > 0
  AND position(create_table_query, 'ck_embodied_environment_mapping') > 0;

SELECT throwIf(count() != 4, 'SMOKE: every mart base table needs three rule-set identities')
FROM
(
    SELECT table
    FROM system.columns
    WHERE database = 'sdar_mart'
      AND name IN
      (
          'evaluation_group_id',
          'metric_set_id', 'metric_set_version', 'metric_set_hash',
          'gate_set_id', 'gate_set_version', 'gate_set_hash',
          'fatal_set_id', 'fatal_set_version', 'fatal_set_hash'
      )
      AND table IN (SELECT name FROM system.tables WHERE database = 'sdar_mart' AND engine != 'View')
    GROUP BY table
    HAVING countDistinct(name) = 10
);

SELECT throwIf(count() > 0, 'SMOKE: mutable ReplacingMergeTree uses an unstable time partition')
FROM system.tables
WHERE database IN ('sdar_meta', 'sdar_core', 'sdar_commander', 'sdar_npc', 'sdar_embodied', 'sdar_mart')
  AND engine LIKE '%ReplacingMergeTree%'
  AND position(partition_key, 'toYYYYMM') > 0;

SELECT 'SDAR ClickHouse Schema 1.1 smoke test passed' AS status;
