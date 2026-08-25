-- SDAR ClickHouse Schema V1.1 (fresh-install)
-- Compatibility: ClickHouse 24.8+; recommended 25.3 LTS+
-- All timestamps are UTC DateTime64(3).
--
-- These views are diagnostic. ReplacingMergeTree is asynchronous, so every
-- mutable source is reduced to its latest logical version before validation.
-- Missing-reference checks use LEFT ANTI JOIN and therefore do not depend on
-- the server-level join_use_nulls setting.

-- ---------------------------------------------------------------------------
-- SDAR Core: durable sequence, sealing, terminal state and remote tasks
-- ---------------------------------------------------------------------------

CREATE VIEW IF NOT EXISTS sdar_core.v_evidence_sequence_gap AS
WITH
    evidence_by_run AS
    (
        SELECT
            tenant_id,
            project_id,
            episode_id,
            run_id,
            assumeNotNull(min(evidence_sequence)) AS min_evidence_sequence,
            assumeNotNull(max(evidence_sequence)) AS max_evidence_sequence,
            uniqExact(evidence_sequence) AS distinct_evidence_count,
            countIf(evidence_sequence = toUInt64(0)) AS invalid_zero_sequence_count
        FROM sdar_core.evidence_index
        WHERE evidence_sequence IS NOT NULL
          AND delivery_class = 'durable'
        GROUP BY tenant_id, project_id, episode_id, run_id
    ),
    latest_seal AS
    (
        SELECT *
        FROM sdar_core.run_seal
        ORDER BY record_version DESC, ingested_at DESC
        LIMIT 1 BY tenant_id, project_id, episode_id, run_id
    )
SELECT *
FROM
(
    SELECT
        e.tenant_id,
        e.project_id,
        e.episode_id,
        e.run_id,
        e.min_evidence_sequence,
        e.max_evidence_sequence,
        e.distinct_evidence_count,
        e.invalid_zero_sequence_count,
        if(
            ifNull(s.record_version, toUInt32(0)) = toUInt32(0),
            e.distinct_evidence_count,
            s.durable_evidence_count
        ) AS declared_durable_evidence_count,
        if(
            ifNull(s.record_version, toUInt32(0)) > toUInt32(0)
            AND s.durable_evidence_count != e.distinct_evidence_count,
            toUInt8(1),
            toUInt8(0)
        ) AS durable_count_mismatch,
        if(
            ifNull(s.record_version, toUInt32(0)) = toUInt32(0),
            e.max_evidence_sequence,
            s.last_evidence_sequence
        ) AS expected_last_evidence_sequence,
        if(
            e.min_evidence_sequence > toUInt64(1),
            toUInt64(e.min_evidence_sequence - toUInt64(1)),
            toUInt64(0)
        ) AS missing_prefix_count,
        toUInt64(
            (
                toUInt64(e.max_evidence_sequence - e.min_evidence_sequence)
                + toUInt64(1)
            ) - e.distinct_evidence_count
        ) AS missing_internal_count,
        if(
            ifNull(s.record_version, toUInt32(0)) > toUInt32(0)
            AND s.last_evidence_sequence > e.max_evidence_sequence,
            toUInt64(s.last_evidence_sequence - e.max_evidence_sequence),
            toUInt64(0)
        ) AS missing_trailing_count,
        if(
            ifNull(s.record_version, toUInt32(0)) > toUInt32(0)
            AND e.max_evidence_sequence > s.last_evidence_sequence,
            toUInt64(e.max_evidence_sequence - s.last_evidence_sequence),
            toUInt64(0)
        ) AS evidence_after_seal_count,
        toUInt64(
            missing_prefix_count
            + missing_internal_count
            + missing_trailing_count
        ) AS missing_count,
        ifNull(s.record_version, toUInt32(0)) > toUInt32(0) AS run_sealed
    FROM evidence_by_run AS e
    LEFT JOIN latest_seal AS s
      ON e.tenant_id = s.tenant_id
     AND e.project_id = s.project_id
     AND e.episode_id = s.episode_id
     AND e.run_id = s.run_id

    UNION ALL

    SELECT
        s.tenant_id,
        s.project_id,
        s.episode_id,
        s.run_id,
        toUInt64(0) AS min_evidence_sequence,
        toUInt64(0) AS max_evidence_sequence,
        toUInt64(0) AS distinct_evidence_count,
        toUInt64(0) AS invalid_zero_sequence_count,
        s.durable_evidence_count AS declared_durable_evidence_count,
        toUInt8(s.durable_evidence_count != toUInt64(0)) AS durable_count_mismatch,
        s.last_evidence_sequence AS expected_last_evidence_sequence,
        s.last_evidence_sequence AS missing_prefix_count,
        toUInt64(0) AS missing_internal_count,
        toUInt64(0) AS missing_trailing_count,
        toUInt64(0) AS evidence_after_seal_count,
        s.last_evidence_sequence AS missing_count,
        toUInt8(1) AS run_sealed
    FROM latest_seal AS s
    LEFT ANTI JOIN evidence_by_run AS e
      ON e.tenant_id = s.tenant_id
     AND e.project_id = s.project_id
     AND e.episode_id = s.episode_id
     AND e.run_id = s.run_id
)
WHERE missing_count > toUInt64(0)
   OR evidence_after_seal_count > toUInt64(0)
   OR invalid_zero_sequence_count > toUInt64(0)
   OR durable_count_mismatch > toUInt8(0);

CREATE VIEW IF NOT EXISTS sdar_core.v_duplicate_evidence_sequence AS
SELECT
    tenant_id,
    project_id,
    episode_id,
    run_id,
    evidence_sequence,
    uniqExact(record_id) AS distinct_record_count,
    groupUniqArray(record_id) AS record_ids
FROM sdar_core.evidence_index
WHERE evidence_sequence IS NOT NULL
  AND delivery_class = 'durable'
GROUP BY tenant_id, project_id, episode_id, run_id, evidence_sequence
HAVING distinct_record_count > toUInt64(1);

CREATE VIEW IF NOT EXISTS sdar_core.v_unsealed_episode AS
SELECT e.*
FROM
(
    SELECT *
    FROM sdar_core.episode
    ORDER BY record_version DESC, ingested_at DESC
    LIMIT 1 BY tenant_id, project_id, episode_id
) AS e
LEFT ANTI JOIN
(
    SELECT tenant_id, project_id, episode_id, run_id
    FROM sdar_core.run_seal
    GROUP BY tenant_id, project_id, episode_id, run_id
) AS s
  ON e.tenant_id = s.tenant_id
 AND e.project_id = s.project_id
 AND e.episode_id = s.episode_id
 AND e.run_id = s.run_id
WHERE e.episode_status IN ('completed', 'failed', 'cancelled', 'capability_gap');

CREATE VIEW IF NOT EXISTS sdar_core.v_terminal_state_mismatch AS
WITH
    latest_episode AS
    (
        SELECT *
        FROM sdar_core.episode
        ORDER BY record_version DESC, ingested_at DESC
        LIMIT 1 BY tenant_id, project_id, episode_id
    ),
    latest_state AS
    (
        SELECT
            tenant_id,
            project_id,
            episode_id,
            run_id,
            argMax(state_version, tuple(sequence, occurred_at, toString(record_id))) AS latest_state_version,
            argMax(record_id, tuple(sequence, occurred_at, toString(record_id))) AS latest_state_record_id,
            count() AS state_count
        FROM sdar_core.state_snapshot
        GROUP BY tenant_id, project_id, episode_id, run_id
    )
SELECT
    e.tenant_id,
    e.project_id,
    e.episode_id,
    e.run_id,
    e.episode_status,
    e.final_state_version AS declared_final_state_version,
    ifNull(s.latest_state_version, '') AS latest_state_version,
    ifNull(s.latest_state_record_id, toUUID('00000000-0000-0000-0000-000000000000')) AS latest_state_record_id,
    ifNull(s.state_count, toUInt64(0)) AS state_count
FROM latest_episode AS e
LEFT JOIN latest_state AS s
 ON e.tenant_id = s.tenant_id
 AND e.project_id = s.project_id
 AND e.episode_id = s.episode_id
 AND e.run_id = s.run_id
WHERE e.episode_status IN ('completed', 'failed', 'cancelled', 'capability_gap')
  AND (
      ifNull(s.state_count, toUInt64(0)) = toUInt64(0)
      OR empty(e.final_state_version)
      OR e.final_state_version != ifNull(s.latest_state_version, '')
  );

CREATE VIEW IF NOT EXISTS sdar_core.v_remote_task_without_terminal AS
SELECT
    tenant_id,
    project_id,
    episode_id,
    binding_id,
    remote_task_id,
    protocol_status,
    local_state,
    created_at,
    updated_at,
    binding_version
FROM
(
    SELECT *
    FROM sdar_core.remote_task_binding
    ORDER BY binding_version DESC, updated_at DESC, ingested_at DESC
    LIMIT 1 BY tenant_id, project_id, binding_id
)
WHERE terminal_at IS NULL
  AND local_state != 'closed';

CREATE VIEW IF NOT EXISTS sdar_core.v_unprocessed_control_event AS
SELECT *
FROM
(
    SELECT *
    FROM sdar_core.remote_task_control_event
    ORDER BY record_version DESC, ingested_at DESC
    LIMIT 1 BY tenant_id, project_id, control_event_id
)
WHERE processing_status IN ('pending', 'claimed', 'failed');

CREATE VIEW IF NOT EXISTS sdar_core.v_uncertain_cancellation AS
SELECT *
FROM
(
    SELECT *
    FROM sdar_core.remote_task_binding
    ORDER BY binding_version DESC, updated_at DESC, ingested_at DESC
    LIMIT 1 BY tenant_id, project_id, binding_id
)
WHERE cancellation_uncertain = toUInt8(1);

CREATE VIEW IF NOT EXISTS sdar_core.v_not_ready_evaluation AS
SELECT *
FROM
(
    SELECT *
    FROM
    (
        SELECT *
        FROM sdar_core.evaluation_readiness
        ORDER BY record_version DESC, checked_at DESC, ingested_at DESC
        LIMIT 1 BY tenant_id, project_id, episode_id, readiness_id
    )
    ORDER BY checked_at DESC, record_version DESC, ingested_at DESC
    LIMIT 1 BY tenant_id, project_id, episode_id
)
WHERE readiness_status != 'ready'
   OR sealed = toUInt8(0)
   OR evidence_sequence_complete = toUInt8(0)
   OR state_trajectory_complete = toUInt8(0)
   OR action_receipt_complete = toUInt8(0)
   OR verification_coverage_complete = toUInt8(0)
   OR remote_task_binding_complete = toUInt8(0)
   OR remote_task_terminal_complete = toUInt8(0)
   OR continuation_complete = toUInt8(0)
   OR pending_durable_evidence_count > toUInt32(0)
   OR unresolved_remote_task_count > toUInt32(0)
   OR uncertain_cancellation_count > toUInt32(0);

CREATE VIEW IF NOT EXISTS sdar_core.v_completed_action_without_passed_verification AS
SELECT a.*
FROM sdar_core.action_record AS a
LEFT ANTI JOIN
(
    SELECT
        tenant_id,
        project_id,
        episode_id,
        verification_action_id
    FROM sdar_core.verification_record
    WHERE verification_result = 'passed'
      AND length(verification_action_id) > 0
    GROUP BY tenant_id, project_id, episode_id, verification_action_id
) AS v
  ON a.tenant_id = v.tenant_id
 AND a.project_id = v.project_id
 AND a.episode_id = v.episode_id
 AND a.action_id = v.verification_action_id
WHERE a.action_status = 'completed'
  AND a.effect_semantics = 'side_effecting';

-- A P2 sidecar is only replayable when every external identity, environment
-- mapping, target raw envelope, durable evidence row and P1/P2 projection
-- version it declares resolves to exactly one row. Global projection versions
-- are fallback definitions; a tenant/project-specific row plus a global row is
-- deliberately ambiguous.
CREATE VIEW IF NOT EXISTS sdar_core.v_domain_projection_reference_issue AS
WITH
    contexts AS
    (
        SELECT *
        FROM sdar_core.domain_projection_context FINAL
    ),
    crosswalk_match_counts AS
    (
        SELECT
            c.tenant_id,
            c.project_id,
            c.lineage_id,
            count() AS match_count,
            countIf(x.status = 'active') AS active_match_count
        FROM contexts AS c
        INNER JOIN
        (
            SELECT *
            FROM sdar_meta.id_crosswalk FINAL
        ) AS x
          ON c.tenant_id = x.tenant_id
         AND c.project_id = x.project_id
         AND c.source_projection_id = x.projection_id
         AND c.source_projection_version = x.projection_version
         AND c.source_agent_type = x.source_system
         AND c.source_agent_type = x.source_agent_type
         AND c.source_database = x.source_database
         AND x.namespace_name = 'sdar-canonical-v1'
         AND c.id_namespace_version = x.namespace_version
         AND c.target_identity_source_entity_type = x.source_entity_type
         AND c.target_identity_source_id = x.source_id
         AND c.target_identity_business_discriminator = x.business_discriminator
         AND c.target_identity_target_entity_type = x.target_entity_type
         AND c.target_record_id = x.target_id
        WHERE c.identity_mapping_mode = 'p1_crosswalk'
        GROUP BY c.tenant_id, c.project_id, c.lineage_id
    ),
    environment_match_counts AS
    (
        SELECT
            c.tenant_id,
            c.project_id,
            c.lineage_id,
            count() AS match_count,
            countIf(m.status = 'active') AS active_match_count
        FROM contexts AS c
        INNER JOIN
        (
            SELECT *
            FROM sdar_meta.deployment_environment_mapping FINAL
        ) AS m
          ON c.tenant_id = m.tenant_id
         AND c.project_id = m.project_id
         AND assumeNotNull(c.environment_mapping_id) = m.record_id
         AND c.environment_map_version = m.mapping_version
         AND c.source_agent_type = m.source_system
         AND c.source_deployment_id = m.deployment_id
         AND c.source_environment_raw = m.source_environment
         AND c.canonical_environment = m.target_environment
        WHERE c.environment_mapping_id IS NOT NULL
        GROUP BY c.tenant_id, c.project_id, c.lineage_id
    ),
    raw_envelope_match_counts AS
    (
        SELECT
            c.tenant_id,
            c.project_id,
            c.lineage_id,
            count() AS match_count,
            countIf(r.delivery_class = 'durable') AS durable_match_count
        FROM contexts AS c
        INNER JOIN
        (
            SELECT *
            FROM sdar_core.raw_envelope FINAL
        ) AS r
          ON c.tenant_id = r.tenant_id
         AND c.project_id = r.project_id
         AND c.target_record_id = r.record_id
         AND c.target_payload_hash = r.payload_hash
        GROUP BY c.tenant_id, c.project_id, c.lineage_id
    ),
    durable_evidence_match_counts AS
    (
        SELECT
            c.tenant_id,
            c.project_id,
            c.lineage_id,
            count() AS match_count
        FROM contexts AS c
        INNER JOIN
        (
            SELECT *
            FROM sdar_core.evidence_index FINAL
            WHERE delivery_class = 'durable'
        ) AS e
          ON c.tenant_id = e.tenant_id
         AND c.project_id = e.project_id
         AND c.target_record_id = e.record_id
         AND c.target_payload_hash = e.payload_hash
        GROUP BY c.tenant_id, c.project_id, c.lineage_id
    ),
    projection_registry AS
    (
        SELECT *
        FROM sdar_meta.projection_version FINAL
    ),
    global_projection_registry AS
    (
        SELECT *
        FROM projection_registry
        WHERE tenant_id = 'global' AND project_id = 'global'
    ),
    p1_projection_candidates AS
    (
        SELECT c.tenant_id, c.project_id, c.lineage_id, p.record_id
        FROM contexts AS c
        INNER JOIN projection_registry AS p
          ON c.tenant_id = p.tenant_id
         AND c.project_id = p.project_id
         AND c.source_projection_id = p.projection_id
         AND c.source_projection_version = p.projection_version
         AND c.source_projection_contract_version = p.contract_version
         AND c.source_projection_mapping_hash = p.mapping_hash

        UNION ALL

        SELECT c.tenant_id, c.project_id, c.lineage_id, p.record_id
        FROM contexts AS c
        INNER JOIN global_projection_registry AS p
          ON c.source_projection_id = p.projection_id
         AND c.source_projection_version = p.projection_version
         AND c.source_projection_contract_version = p.contract_version
         AND c.source_projection_mapping_hash = p.mapping_hash
        WHERE c.tenant_id != 'global' OR c.project_id != 'global'
    ),
    p1_projection_match_counts AS
    (
        SELECT tenant_id, project_id, lineage_id, count() AS match_count
        FROM p1_projection_candidates
        GROUP BY tenant_id, project_id, lineage_id
    ),
    p2_projection_candidates AS
    (
        SELECT c.tenant_id, c.project_id, c.lineage_id, p.record_id
        FROM contexts AS c
        INNER JOIN projection_registry AS p
          ON c.tenant_id = p.tenant_id
         AND c.project_id = p.project_id
         AND c.projection_definition_id = p.projection_id
         AND c.projection_definition_version = p.projection_version
         AND c.target_projection_contract_version = p.contract_version
         AND c.target_projection_mapping_hash = p.mapping_hash

        UNION ALL

        SELECT c.tenant_id, c.project_id, c.lineage_id, p.record_id
        FROM contexts AS c
        INNER JOIN global_projection_registry AS p
          ON c.projection_definition_id = p.projection_id
         AND c.projection_definition_version = p.projection_version
         AND c.target_projection_contract_version = p.contract_version
         AND c.target_projection_mapping_hash = p.mapping_hash
        WHERE c.tenant_id != 'global' OR c.project_id != 'global'
    ),
    p2_projection_match_counts AS
    (
        SELECT tenant_id, project_id, lineage_id, count() AS match_count
        FROM p2_projection_candidates
        GROUP BY tenant_id, project_id, lineage_id
    )
SELECT
    c.tenant_id,
    c.project_id,
    c.lineage_id,
    c.record_version AS context_record_version,
    c.source_agent_type,
    c.source_table,
    c.source_record_id,
    c.target_table,
    c.target_record_id,
    multiIf(
        ifNull(x.match_count, toUInt64(0)) = toUInt64(0),
        'P1_CROSSWALK_NOT_FOUND',
        ifNull(x.match_count, toUInt64(0)) != toUInt64(1),
        'P1_CROSSWALK_NOT_UNIQUE',
        ifNull(x.active_match_count, toUInt64(0)) = toUInt64(0),
        'P1_CROSSWALK_NOT_ACTIVE',
        'P1_CROSSWALK_NOT_UNIQUE'
    ) AS issue_code,
    'id_crosswalk' AS reference_type,
    concat(
        c.target_identity_source_entity_type,
        ':',
        c.target_identity_source_id,
        ':',
        c.target_identity_business_discriminator,
        ':',
        c.target_identity_target_entity_type
    ) AS reference_id,
    toUInt64(1) AS expected_match_count,
    ifNull(x.match_count, toUInt64(0)) AS actual_match_count
FROM contexts AS c
LEFT JOIN crosswalk_match_counts AS x
  ON c.tenant_id = x.tenant_id
 AND c.project_id = x.project_id
 AND c.lineage_id = x.lineage_id
WHERE c.identity_mapping_mode = 'p1_crosswalk'
  AND (
      ifNull(x.match_count, toUInt64(0)) != toUInt64(1)
      OR ifNull(x.active_match_count, toUInt64(0)) != toUInt64(1)
  )

UNION ALL

SELECT
    c.tenant_id,
    c.project_id,
    c.lineage_id,
    c.record_version AS context_record_version,
    c.source_agent_type,
    c.source_table,
    c.source_record_id,
    c.target_table,
    c.target_record_id,
    multiIf(
        c.environment_mapping_id IS NULL,
        'ENVIRONMENT_MAPPING_ID_REQUIRED',
        ifNull(m.match_count, toUInt64(0)) = toUInt64(0),
        'ENVIRONMENT_MAPPING_NOT_FOUND',
        ifNull(m.match_count, toUInt64(0)) != toUInt64(1),
        'ENVIRONMENT_MAPPING_NOT_UNIQUE',
        ifNull(m.active_match_count, toUInt64(0)) = toUInt64(0),
        'ENVIRONMENT_MAPPING_NOT_ACTIVE',
        'ENVIRONMENT_MAPPING_NOT_UNIQUE'
    ) AS issue_code,
    'deployment_environment_mapping' AS reference_type,
    ifNull(toString(c.environment_mapping_id), '') AS reference_id,
    toUInt64(1) AS expected_match_count,
    ifNull(m.match_count, toUInt64(0)) AS actual_match_count
FROM contexts AS c
LEFT JOIN environment_match_counts AS m
  ON c.tenant_id = m.tenant_id
 AND c.project_id = m.project_id
 AND c.lineage_id = m.lineage_id
WHERE
    (
        c.source_environment_raw NOT IN ('dev', 'test', 'staging', 'prod')
        AND c.environment_mapping_id IS NULL
    )
    OR
    (
        c.environment_mapping_id IS NOT NULL
        AND (
            ifNull(m.match_count, toUInt64(0)) != toUInt64(1)
            OR ifNull(m.active_match_count, toUInt64(0)) != toUInt64(1)
        )
    )

UNION ALL

SELECT
    c.tenant_id,
    c.project_id,
    c.lineage_id,
    c.record_version AS context_record_version,
    c.source_agent_type,
    c.source_table,
    c.source_record_id,
    c.target_table,
    c.target_record_id,
    if(
        ifNull(p.match_count, toUInt64(0)) = toUInt64(0),
        'P1_PROJECTION_VERSION_NOT_FOUND',
        'P1_PROJECTION_VERSION_NOT_UNIQUE'
    ) AS issue_code,
    'projection_version:p1' AS reference_type,
    concat(c.source_projection_id, '@', c.source_projection_version) AS reference_id,
    toUInt64(1) AS expected_match_count,
    ifNull(p.match_count, toUInt64(0)) AS actual_match_count
FROM contexts AS c
LEFT JOIN p1_projection_match_counts AS p
  ON c.tenant_id = p.tenant_id
 AND c.project_id = p.project_id
 AND c.lineage_id = p.lineage_id
WHERE ifNull(p.match_count, toUInt64(0)) != toUInt64(1)

UNION ALL

SELECT
    c.tenant_id,
    c.project_id,
    c.lineage_id,
    c.record_version AS context_record_version,
    c.source_agent_type,
    c.source_table,
    c.source_record_id,
    c.target_table,
    c.target_record_id,
    if(
        ifNull(p.match_count, toUInt64(0)) = toUInt64(0),
        'P2_PROJECTION_VERSION_NOT_FOUND',
        'P2_PROJECTION_VERSION_NOT_UNIQUE'
    ) AS issue_code,
    'projection_version:p2' AS reference_type,
    concat(c.projection_definition_id, '@', c.projection_definition_version) AS reference_id,
    toUInt64(1) AS expected_match_count,
    ifNull(p.match_count, toUInt64(0)) AS actual_match_count
FROM contexts AS c
LEFT JOIN p2_projection_match_counts AS p
  ON c.tenant_id = p.tenant_id
 AND c.project_id = p.project_id
 AND c.lineage_id = p.lineage_id
WHERE ifNull(p.match_count, toUInt64(0)) != toUInt64(1)

UNION ALL

SELECT
    c.tenant_id,
    c.project_id,
    c.lineage_id,
    c.record_version AS context_record_version,
    c.source_agent_type,
    c.source_table,
    c.source_record_id,
    c.target_table,
    c.target_record_id,
    if(
        ifNull(r.match_count, toUInt64(0)) = toUInt64(0),
        'CORE_RAW_ENVELOPE_NOT_FOUND',
        'CORE_RAW_ENVELOPE_NOT_UNIQUE'
    ) AS issue_code,
    'sdar_core.raw_envelope' AS reference_type,
    concat(toString(c.target_record_id), '@', toString(c.target_payload_hash)) AS reference_id,
    toUInt64(1) AS expected_match_count,
    ifNull(r.match_count, toUInt64(0)) AS actual_match_count
FROM contexts AS c
LEFT JOIN raw_envelope_match_counts AS r
  ON c.tenant_id = r.tenant_id
 AND c.project_id = r.project_id
 AND c.lineage_id = r.lineage_id
WHERE ifNull(r.match_count, toUInt64(0)) != toUInt64(1)

UNION ALL

SELECT
    c.tenant_id,
    c.project_id,
    c.lineage_id,
    c.record_version AS context_record_version,
    c.source_agent_type,
    c.source_table,
    c.source_record_id,
    c.target_table,
    c.target_record_id,
    if(
        ifNull(e.match_count, toUInt64(0)) = toUInt64(0),
        'CORE_DURABLE_EVIDENCE_NOT_FOUND',
        'CORE_DURABLE_EVIDENCE_NOT_UNIQUE'
    ) AS issue_code,
    'sdar_core.evidence_index' AS reference_type,
    concat(toString(c.target_record_id), '@', toString(c.target_payload_hash)) AS reference_id,
    toUInt64(1) AS expected_match_count,
    ifNull(e.match_count, toUInt64(0)) AS actual_match_count
FROM contexts AS c
INNER JOIN raw_envelope_match_counts AS r
  ON c.tenant_id = r.tenant_id
 AND c.project_id = r.project_id
 AND c.lineage_id = r.lineage_id
LEFT JOIN durable_evidence_match_counts AS e
  ON c.tenant_id = e.tenant_id
 AND c.project_id = e.project_id
 AND c.lineage_id = e.lineage_id
WHERE r.match_count = toUInt64(1)
  AND r.durable_match_count = toUInt64(1)
  AND ifNull(e.match_count, toUInt64(0)) != toUInt64(1);

-- ---------------------------------------------------------------------------
-- Commander and NPC: reference integrity and physical verification
-- ---------------------------------------------------------------------------

CREATE VIEW IF NOT EXISTS sdar_commander.v_orphan_action AS
SELECT 'basis' AS missing_reference_type, a.*
FROM sdar_commander.action_record AS a
LEFT ANTI JOIN sdar_commander.execution_basis AS b
  ON a.tenant_id = b.tenant_id
 AND a.project_id = b.project_id
 AND a.episode_id = b.episode_id
 AND a.basis_id = b.basis_id
 AND a.basis_version = b.basis_version

UNION ALL

SELECT 'decision' AS missing_reference_type, a.*
FROM sdar_commander.action_record AS a
LEFT ANTI JOIN sdar_commander.decision_record AS d
  ON a.tenant_id = d.tenant_id
 AND a.project_id = d.project_id
 AND a.episode_id = d.episode_id
 AND a.decision_id = d.decision_id

UNION ALL

SELECT 'before_state' AS missing_reference_type, a.*
FROM sdar_commander.action_record AS a
LEFT ANTI JOIN sdar_commander.state_snapshot AS s
  ON a.tenant_id = s.tenant_id
 AND a.project_id = s.project_id
 AND a.episode_id = s.episode_id
 AND a.before_state_id = s.state_id;

CREATE VIEW IF NOT EXISTS sdar_npc.v_orphan_action AS
SELECT 'basis' AS missing_reference_type, a.*
FROM sdar_npc.action_record AS a
LEFT ANTI JOIN sdar_npc.execution_basis AS b
  ON a.tenant_id = b.tenant_id
 AND a.project_id = b.project_id
 AND a.episode_id = b.episode_id
 AND a.basis_id = b.basis_id
 AND a.basis_version = b.basis_version

UNION ALL

SELECT 'decision' AS missing_reference_type, a.*
FROM sdar_npc.action_record AS a
LEFT ANTI JOIN sdar_npc.decision_record AS d
  ON a.tenant_id = d.tenant_id
 AND a.project_id = d.project_id
 AND a.episode_id = d.episode_id
 AND a.decision_id = d.decision_id

UNION ALL

SELECT 'before_state' AS missing_reference_type, a.*
FROM sdar_npc.action_record AS a
LEFT ANTI JOIN sdar_npc.state_snapshot AS s
  ON a.tenant_id = s.tenant_id
 AND a.project_id = s.project_id
 AND a.episode_id = s.episode_id
 AND a.before_state_id = s.state_id;

CREATE VIEW IF NOT EXISTS sdar_commander.v_completed_without_verification AS
SELECT
    a.tenant_id,
    a.project_id,
    a.episode_id,
    a.action_id,
    a.execution_status
FROM sdar_commander.action_record AS a
LEFT ANTI JOIN
(
    SELECT tenant_id, project_id, episode_id, verification_action_id
    FROM sdar_commander.verification_record
    WHERE verification_status = 'pass'
      AND length(verification_action_id) > 0
    GROUP BY tenant_id, project_id, episode_id, verification_action_id
) AS v
  ON a.tenant_id = v.tenant_id
 AND a.project_id = v.project_id
 AND a.episode_id = v.episode_id
 AND a.action_id = v.verification_action_id
WHERE a.execution_status = 'succeeded'
  AND a.side_effect = toUInt8(1);

CREATE VIEW IF NOT EXISTS sdar_npc.v_completed_without_verification AS
SELECT
    a.tenant_id,
    a.project_id,
    a.episode_id,
    a.action_id,
    a.execution_status
FROM sdar_npc.action_record AS a
LEFT ANTI JOIN
(
    SELECT tenant_id, project_id, episode_id, verification_action_id
    FROM sdar_npc.verification_record
    WHERE verification_status = 'pass'
      AND length(verification_action_id) > 0
    GROUP BY tenant_id, project_id, episode_id, verification_action_id
) AS v
  ON a.tenant_id = v.tenant_id
 AND a.project_id = v.project_id
 AND a.episode_id = v.episode_id
 AND a.action_id = v.verification_action_id
WHERE a.execution_status = 'succeeded'
  AND a.side_effect = toUInt8(1);

CREATE VIEW IF NOT EXISTS sdar_commander.v_bundle_final_state_not_latest AS
WITH
    latest_bundle_version AS
    (
        SELECT *
        FROM sdar_commander.episode_evidence_bundle_manifest
        ORDER BY record_version DESC, built_at DESC, ingested_at DESC
        LIMIT 1 BY tenant_id, project_id, episode_id, bundle_id
    ),
    latest_bundle AS
    (
        SELECT *
        FROM latest_bundle_version
        ORDER BY built_at DESC, record_version DESC, ingested_at DESC
        LIMIT 1 BY tenant_id, project_id, episode_id
    ),
    latest_state AS
    (
        SELECT
            tenant_id,
            project_id,
            episode_id,
            argMax(state_id, tuple(state_version, occurred_at, sequence, record_id)) AS latest_state_id,
            max(state_version) AS latest_state_version,
            count() AS state_count
        FROM sdar_commander.state_snapshot
        GROUP BY tenant_id, project_id, episode_id
    )
SELECT
    b.tenant_id,
    b.project_id,
    b.episode_id,
    b.bundle_id,
    b.final_state_id,
    ifNull(s.latest_state_id, '') AS latest_state_id,
    ifNull(s.latest_state_version, toUInt64(0)) AS latest_state_version,
    ifNull(s.state_count, toUInt64(0)) AS state_count
FROM latest_bundle AS b
LEFT JOIN latest_state AS s
  ON b.tenant_id = s.tenant_id
 AND b.project_id = s.project_id
 AND b.episode_id = s.episode_id
WHERE ifNull(s.state_count, toUInt64(0)) = toUInt64(0)
   OR b.final_state_id != ifNull(s.latest_state_id, '');

CREATE VIEW IF NOT EXISTS sdar_npc.v_bundle_final_state_not_latest AS
WITH
    latest_bundle_version AS
    (
        SELECT *
        FROM sdar_npc.episode_evidence_bundle_manifest
        ORDER BY record_version DESC, built_at DESC, ingested_at DESC
        LIMIT 1 BY tenant_id, project_id, episode_id, bundle_id
    ),
    latest_bundle AS
    (
        SELECT *
        FROM latest_bundle_version
        ORDER BY built_at DESC, record_version DESC, ingested_at DESC
        LIMIT 1 BY tenant_id, project_id, episode_id
    ),
    latest_state AS
    (
        SELECT
            tenant_id,
            project_id,
            episode_id,
            argMax(state_id, tuple(state_version, occurred_at, sequence, record_id)) AS latest_state_id,
            max(state_version) AS latest_state_version,
            count() AS state_count
        FROM sdar_npc.state_snapshot
        GROUP BY tenant_id, project_id, episode_id
    )
SELECT
    b.tenant_id,
    b.project_id,
    b.episode_id,
    b.bundle_id,
    b.final_state_id,
    ifNull(s.latest_state_id, '') AS latest_state_id,
    ifNull(s.latest_state_version, toUInt64(0)) AS latest_state_version,
    ifNull(s.state_count, toUInt64(0)) AS state_count
FROM latest_bundle AS b
LEFT JOIN latest_state AS s
  ON b.tenant_id = s.tenant_id
 AND b.project_id = s.project_id
 AND b.episode_id = s.episode_id
WHERE ifNull(s.state_count, toUInt64(0)) = toUInt64(0)
   OR b.final_state_id != ifNull(s.latest_state_id, '');

-- ---------------------------------------------------------------------------
-- Embodied domain readiness, minimal-profile overclaim and control conflicts
-- ---------------------------------------------------------------------------

CREATE VIEW IF NOT EXISTS sdar_embodied.v_readiness_issue AS
SELECT *
FROM sdar_embodied.v_evaluation_readiness_latest
WHERE readiness_status != 'ready'
   OR sequence_complete = toUInt8(0)
   OR state_trajectory_complete = toUInt8(0)
   OR action_receipt_complete = toUInt8(0)
   OR verification_complete = toUInt8(0)
   OR length(missing_evidence_types) > 0
   OR length(quality_issue_ids) > 0;

CREATE VIEW IF NOT EXISTS sdar_embodied.v_missing_readiness AS
SELECT e.*
FROM sdar_embodied.v_episode_latest AS e
LEFT ANTI JOIN
(
    SELECT tenant_id, project_id, episode_key
    FROM sdar_embodied.v_evaluation_readiness_latest
    GROUP BY tenant_id, project_id, episode_key
) AS r
  ON e.tenant_id = r.tenant_id
 AND e.project_id = r.project_id
 AND e.episode_key = r.episode_key
WHERE e.episode_status IN ('completed', 'partial', 'failed', 'aborted', 'cancelled');

CREATE VIEW IF NOT EXISTS sdar_embodied.v_invalid_physical_verification_source AS
SELECT *
FROM sdar_embodied.physical_verification FINAL
WHERE source_evidence_level = 'E0'
   OR source_collection_profile = 'minimal'
   OR length(source_state_id) = 0
   OR length(evidence_refs) = 0;

CREATE VIEW IF NOT EXISTS sdar_embodied.v_minimal_evidence_overclaim AS
SELECT
    tenant_id,
    project_id,
    episode_key,
    'physical_verification' AS source_table,
    record_id,
    'minimal profile produced a physical verification pass' AS issue
FROM sdar_embodied.physical_verification
FINAL
WHERE source_collection_profile = 'minimal'
  AND verification_result = 'pass'

UNION ALL

SELECT
    tenant_id,
    project_id,
    episode_key,
    'state_freshness_check' AS source_table,
    record_id,
    'minimal profile produced a state freshness pass' AS issue
FROM sdar_embodied.state_freshness_check
FINAL
WHERE source_collection_profile = 'minimal'
  AND check_result = 'pass'

UNION ALL

SELECT
    tenant_id,
    project_id,
    episode_key,
    'evaluation_readiness' AS source_table,
    record_id,
    'minimal profile was marked ready or complete' AS issue
FROM sdar_embodied.v_evaluation_readiness_latest
WHERE collection_profile_name = 'minimal'
  AND (
      readiness_status = 'ready'
      OR state_trajectory_complete = toUInt8(1)
      OR verification_complete = toUInt8(1)
  );

CREATE VIEW IF NOT EXISTS sdar_embodied.v_control_authority_conflict AS
SELECT
    tenant_id,
    project_id,
    episode_key,
    device_id,
    resource_scope,
    count() AS conflict_count,
    min(occurred_at) AS first_conflict_at,
    max(occurred_at) AS last_conflict_at,
    groupArray(authority_event_id) AS authority_event_ids,
    groupArray(action_id) AS action_ids
FROM sdar_embodied.control_authority_event FINAL
WHERE conflict_detected = toUInt8(1)
GROUP BY tenant_id, project_id, episode_key, device_id, resource_scope;

CREATE VIEW IF NOT EXISTS sdar_embodied.v_resource_claim_conflict AS
SELECT
    tenant_id,
    project_id,
    episode_key,
    device_id,
    resource_type,
    resource_id,
    count() AS conflict_count,
    min(occurred_at) AS first_conflict_at,
    max(occurred_at) AS last_conflict_at,
    arrayDistinct(arrayFlatten(groupArray(conflicting_action_ids))) AS conflicting_action_ids
FROM sdar_embodied.resource_claim_event FINAL
WHERE conflict_detected = toUInt8(1)
GROUP BY tenant_id, project_id, episode_key, device_id, resource_type, resource_id;

CREATE VIEW IF NOT EXISTS sdar_embodied.v_duplicate_control_dispatch AS
SELECT
    tenant_id,
    project_id,
    episode_key,
    device_id,
    idempotency_key,
    uniqExact(record_id) AS distinct_dispatch_record_count,
    uniqExact(action_id) AS action_count,
    groupUniqArray(action_id) AS action_ids,
    min(occurred_at) AS first_dispatch_at,
    max(occurred_at) AS last_dispatch_at
FROM sdar_embodied.control_action FINAL
WHERE length(idempotency_key) > 0
  AND side_effect = toUInt8(1)
  AND execution_status IN ('accepted', 'running', 'succeeded')
GROUP BY tenant_id, project_id, episode_key, device_id, idempotency_key
HAVING action_count > toUInt64(1);

-- ---------------------------------------------------------------------------
-- Evaluation mart: orphan children and provenance mismatches
-- ---------------------------------------------------------------------------

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_orphan_child AS
SELECT
    'metric' AS child_type,
    m.tenant_id,
    m.project_id,
    m.evaluation_id,
    m.result_version,
    m.metric_id AS child_id,
    m.record_id
FROM sdar_mart.v_evaluation_metric_result_versioned AS m
LEFT ANTI JOIN sdar_mart.v_evaluation_result_versioned AS r
  ON m.tenant_id = r.tenant_id
 AND m.project_id = r.project_id
 AND m.evaluation_id = r.evaluation_id
 AND m.result_version = r.result_version

UNION ALL

SELECT
    'gate' AS child_type,
    g.tenant_id,
    g.project_id,
    g.evaluation_id,
    g.result_version,
    g.gate_id AS child_id,
    g.record_id
FROM sdar_mart.v_evaluation_gate_result_versioned AS g
LEFT ANTI JOIN sdar_mart.v_evaluation_result_versioned AS r
  ON g.tenant_id = r.tenant_id
 AND g.project_id = r.project_id
 AND g.evaluation_id = r.evaluation_id
 AND g.result_version = r.result_version

UNION ALL

SELECT
    'fatal' AS child_type,
    f.tenant_id,
    f.project_id,
    f.evaluation_id,
    f.result_version,
    f.fatal_error_id AS child_id,
    f.record_id
FROM sdar_mart.v_evaluation_fatal_error_versioned AS f
LEFT ANTI JOIN sdar_mart.v_evaluation_result_versioned AS r
  ON f.tenant_id = r.tenant_id
 AND f.project_id = r.project_id
 AND f.evaluation_id = r.evaluation_id
 AND f.result_version = r.result_version;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_duplicate_payload_conflict AS
SELECT
    'result' AS child_type,
    tenant_id,
    project_id,
    evaluation_id,
    result_version,
    '' AS child_id,
    uniqExact(result_payload_hash) AS distinct_payload_hash_count,
    groupUniqArray(result_payload_hash) AS payload_hashes,
    groupUniqArray(record_id) AS record_ids,
    max(row_version) AS max_row_version
FROM sdar_mart.evaluation_result
GROUP BY tenant_id, project_id, evaluation_id, result_version
HAVING distinct_payload_hash_count > toUInt64(1)

UNION ALL

SELECT
    'metric' AS child_type,
    tenant_id,
    project_id,
    evaluation_id,
    result_version,
    metric_id AS child_id,
    uniqExact(row_payload_hash) AS distinct_payload_hash_count,
    groupUniqArray(row_payload_hash) AS payload_hashes,
    groupUniqArray(record_id) AS record_ids,
    max(row_version) AS max_row_version
FROM sdar_mart.evaluation_metric_result
GROUP BY tenant_id, project_id, evaluation_id, result_version, metric_id
HAVING distinct_payload_hash_count > toUInt64(1)

UNION ALL

SELECT
    'gate' AS child_type,
    tenant_id,
    project_id,
    evaluation_id,
    result_version,
    gate_id AS child_id,
    uniqExact(row_payload_hash) AS distinct_payload_hash_count,
    groupUniqArray(row_payload_hash) AS payload_hashes,
    groupUniqArray(record_id) AS record_ids,
    max(row_version) AS max_row_version
FROM sdar_mart.evaluation_gate_result
GROUP BY tenant_id, project_id, evaluation_id, result_version, gate_id
HAVING distinct_payload_hash_count > toUInt64(1)

UNION ALL

SELECT
    'fatal' AS child_type,
    tenant_id,
    project_id,
    evaluation_id,
    result_version,
    fatal_error_id AS child_id,
    uniqExact(row_payload_hash) AS distinct_payload_hash_count,
    groupUniqArray(row_payload_hash) AS payload_hashes,
    groupUniqArray(record_id) AS record_ids,
    max(row_version) AS max_row_version
FROM sdar_mart.evaluation_fatal_error
GROUP BY tenant_id, project_id, evaluation_id, result_version, fatal_error_id
HAVING distinct_payload_hash_count > toUInt64(1);

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_provenance_mismatch AS
WITH children AS
(
    SELECT
        'metric' AS child_type,
        tenant_id, project_id, evaluation_id, result_version, metric_id AS child_id,
        evaluation_group_id,
        evaluation_scope, adapter, episode_key, episode_uuid,
        agent_id, agent_version, collection_profile,
        framework, framework_version, profile, profile_version,
        metric_set_id, metric_set_version, metric_set_hash,
        gate_set_id, gate_set_version, gate_set_hash,
        fatal_set_id, fatal_set_version, fatal_set_hash,
        evaluator_id, evaluator_type, evaluator_version, evaluator_config_hash,
        projection_id, projection_version, evidence_snapshot_id,
        evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
        record_id
    FROM sdar_mart.v_evaluation_metric_result_versioned

    UNION ALL

    SELECT
        'gate' AS child_type,
        tenant_id, project_id, evaluation_id, result_version, gate_id AS child_id,
        evaluation_group_id,
        evaluation_scope, adapter, episode_key, episode_uuid,
        agent_id, agent_version, collection_profile,
        framework, framework_version, profile, profile_version,
        metric_set_id, metric_set_version, metric_set_hash,
        gate_set_id, gate_set_version, gate_set_hash,
        fatal_set_id, fatal_set_version, fatal_set_hash,
        evaluator_id, evaluator_type, evaluator_version, evaluator_config_hash,
        projection_id, projection_version, evidence_snapshot_id,
        evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
        record_id
    FROM sdar_mart.v_evaluation_gate_result_versioned

    UNION ALL

    SELECT
        'fatal' AS child_type,
        tenant_id, project_id, evaluation_id, result_version, fatal_error_id AS child_id,
        evaluation_group_id,
        evaluation_scope, adapter, episode_key, episode_uuid,
        agent_id, agent_version, collection_profile,
        framework, framework_version, profile, profile_version,
        metric_set_id, metric_set_version, metric_set_hash,
        gate_set_id, gate_set_version, gate_set_hash,
        fatal_set_id, fatal_set_version, fatal_set_hash,
        evaluator_id, evaluator_type, evaluator_version, evaluator_config_hash,
        projection_id, projection_version, evidence_snapshot_id,
        evidence_snapshot_hash, evidence_watermark_sequence, evidence_watermark_at,
        record_id
    FROM sdar_mart.v_evaluation_fatal_error_versioned
)
SELECT
    c.child_type,
    c.tenant_id,
    c.project_id,
    c.evaluation_id,
    c.result_version,
    c.evaluation_group_id,
    c.child_id,
    c.record_id,
    arrayFilter(x -> length(x) > 0, [
        if(c.evaluation_group_id != r.evaluation_group_id, 'evaluation_group_id', ''),
        if(c.evaluation_scope != r.evaluation_scope, 'evaluation_scope', ''),
        if(c.adapter != r.adapter, 'adapter', ''),
        if(c.episode_key != r.episode_key, 'episode_key', ''),
        if(
            ifNull(toString(c.episode_uuid), '') != ifNull(toString(r.episode_uuid), ''),
            'episode_uuid',
            ''
        ),
        if(c.agent_id != r.agent_id, 'agent_id', ''),
        if(c.agent_version != r.agent_version, 'agent_version', ''),
        if(c.collection_profile != r.collection_profile, 'collection_profile', ''),
        if(c.framework != r.framework, 'framework', ''),
        if(c.framework_version != r.framework_version, 'framework_version', ''),
        if(c.profile != r.profile, 'profile', ''),
        if(c.profile_version != r.profile_version, 'profile_version', ''),
        if(c.metric_set_id != r.metric_set_id, 'metric_set_id', ''),
        if(c.metric_set_version != r.metric_set_version, 'metric_set_version', ''),
        if(c.metric_set_hash != r.metric_set_hash, 'metric_set_hash', ''),
        if(c.gate_set_id != r.gate_set_id, 'gate_set_id', ''),
        if(c.gate_set_version != r.gate_set_version, 'gate_set_version', ''),
        if(c.gate_set_hash != r.gate_set_hash, 'gate_set_hash', ''),
        if(c.fatal_set_id != r.fatal_set_id, 'fatal_set_id', ''),
        if(c.fatal_set_version != r.fatal_set_version, 'fatal_set_version', ''),
        if(c.fatal_set_hash != r.fatal_set_hash, 'fatal_set_hash', ''),
        if(c.evaluator_id != r.evaluator_id, 'evaluator_id', ''),
        if(c.evaluator_type != r.evaluator_type, 'evaluator_type', ''),
        if(c.evaluator_version != r.evaluator_version, 'evaluator_version', ''),
        if(c.evaluator_config_hash != r.evaluator_config_hash, 'evaluator_config_hash', ''),
        if(c.projection_id != r.projection_id, 'projection_id', ''),
        if(c.projection_version != r.projection_version, 'projection_version', ''),
        if(c.evidence_snapshot_id != r.evidence_snapshot_id, 'evidence_snapshot_id', ''),
        if(c.evidence_snapshot_hash != r.evidence_snapshot_hash, 'evidence_snapshot_hash', ''),
        if(c.evidence_watermark_sequence != r.evidence_watermark_sequence, 'evidence_watermark_sequence', ''),
        if(c.evidence_watermark_at != r.evidence_watermark_at, 'evidence_watermark_at', '')
    ]) AS mismatched_fields
FROM children AS c
INNER JOIN sdar_mart.v_evaluation_result_versioned AS r
  ON c.tenant_id = r.tenant_id
 AND c.project_id = r.project_id
 AND c.evaluation_id = r.evaluation_id
 AND c.result_version = r.result_version
WHERE length(mismatched_fields) > 0;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_outcome_inconsistent AS
WITH
    failed_gates AS
    (
        SELECT tenant_id, project_id, evaluation_id, result_version, count() AS failed_gate_count
        FROM sdar_mart.v_evaluation_gate_result_versioned
        WHERE applicable = toUInt8(1) AND gate_result = 'fail'
        GROUP BY tenant_id, project_id, evaluation_id, result_version
    ),
    fatals AS
    (
        SELECT tenant_id, project_id, evaluation_id, result_version, count() AS fatal_count
        FROM sdar_mart.v_evaluation_fatal_error_versioned
        GROUP BY tenant_id, project_id, evaluation_id, result_version
    )
SELECT
    *
FROM
(
    SELECT
        r.tenant_id,
        r.project_id,
        r.evaluation_id,
        r.result_version,
        r.evaluation_group_id,
        r.evaluation_scope,
        r.adapter,
        r.evaluation_status,
        r.score,
        r.passed,
        r.level,
        ifNull(g.failed_gate_count, toUInt64(0)) AS failed_gate_count,
        ifNull(f.fatal_count, toUInt64(0)) AS fatal_count,
        arrayFilter(x -> length(x) > 0, [
            if(
                r.passed = toUInt8(1)
                AND (
                    ifNull(g.failed_gate_count, toUInt64(0)) > toUInt64(0)
                    OR ifNull(f.fatal_count, toUInt64(0)) > toUInt64(0)
                ),
                'passed_with_failed_gate_or_fatal',
                ''
            ),
            if(
                ifNull(f.fatal_count, toUInt64(0)) > toUInt64(0) AND r.level != 'F',
                'fatal_requires_F',
                ''
            ),
            if(
                ifNull(f.fatal_count, toUInt64(0)) = toUInt64(0) AND r.level = 'F',
                'F_without_fatal',
                ''
            ),
            if(
                ifNull(f.fatal_count, toUInt64(0)) = toUInt64(0)
                AND ifNull(g.failed_gate_count, toUInt64(0)) > toUInt64(0)
                AND r.level != 'HG',
                'failed_gate_requires_HG',
                ''
            ),
            if(
                ifNull(f.fatal_count, toUInt64(0)) = toUInt64(0)
                AND ifNull(g.failed_gate_count, toUInt64(0)) = toUInt64(0)
                AND r.level = 'HG',
                'HG_without_failed_gate',
                ''
            ),
            if(
                r.evaluation_status = 'insufficient_evidence'
                AND (r.passed != toUInt8(0) OR r.level != 'NE'),
                'insufficient_evidence_requires_NE',
                ''
            )
        ]) AS inconsistency_reasons
    FROM sdar_mart.v_evaluation_result_versioned AS r
    LEFT JOIN failed_gates AS g
      ON r.tenant_id = g.tenant_id
     AND r.project_id = g.project_id
     AND r.evaluation_id = g.evaluation_id
     AND r.result_version = g.result_version
    LEFT JOIN fatals AS f
      ON r.tenant_id = f.tenant_id
     AND r.project_id = f.project_id
     AND r.evaluation_id = f.evaluation_id
     AND r.result_version = f.result_version
)
WHERE length(inconsistency_reasons) > 0;

CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_score_reconciliation_issue AS
WITH metric_totals AS
(
    SELECT
        tenant_id,
        project_id,
        evaluation_id,
        result_version,
        countIf(applicable = toUInt8(1)) AS applicable_metric_count,
        sumIf(weight, applicable = toUInt8(1)) AS metric_applicable_weight,
        sum(weighted_score) AS metric_raw_weighted_score
    FROM sdar_mart.v_evaluation_metric_result_versioned
    GROUP BY tenant_id, project_id, evaluation_id, result_version
)
SELECT *
FROM
(
    SELECT
        r.tenant_id,
        r.project_id,
        r.evaluation_id,
        r.result_version,
        r.evaluation_group_id,
        r.evaluation_scope,
        r.adapter,
        r.applicable_weight AS result_applicable_weight,
        r.raw_weighted_score AS result_raw_weighted_score,
        r.score AS result_score,
        ifNull(m.applicable_metric_count, toUInt64(0)) AS applicable_metric_count,
        ifNull(m.metric_applicable_weight, 0.0) AS metric_applicable_weight,
        ifNull(m.metric_raw_weighted_score, 0.0) AS metric_raw_weighted_score,
        arrayFilter(x -> length(x) > 0, [
            if(
                ifNull(m.applicable_metric_count, toUInt64(0)) = toUInt64(0),
                'no_applicable_metric_rows',
                ''
            ),
            if(
                abs(r.applicable_weight - ifNull(m.metric_applicable_weight, 0.0)) > 0.000001,
                'applicable_weight_mismatch',
                ''
            ),
            if(
                abs(r.raw_weighted_score - ifNull(m.metric_raw_weighted_score, 0.0)) > 0.000001,
                'raw_weighted_score_mismatch',
                ''
            )
        ]) AS reconciliation_issues
    FROM sdar_mart.v_evaluation_result_versioned AS r
    LEFT JOIN metric_totals AS m
      ON r.tenant_id = m.tenant_id
     AND r.project_id = m.project_id
     AND r.evaluation_id = m.evaluation_id
     AND r.result_version = m.result_version
    WHERE r.evaluation_status = 'evaluated'
)
WHERE length(reconciliation_issues) > 0;

-- Every immutable evaluation result must bind three independently versioned
-- rule sets to exactly one active Meta registry row with the declared hash.
CREATE VIEW IF NOT EXISTS sdar_mart.v_evaluation_rule_set_registry_mismatch AS
WITH
    result_rule_sets AS
    (
        SELECT
            tenant_id,
            project_id,
            evaluation_id,
            result_version,
            evaluation_group_id,
            evaluation_scope,
            adapter,
            framework,
            framework_version,
            profile,
            profile_version,
            'metric' AS rule_set_kind,
            metric_set_id AS rule_set_id,
            metric_set_version AS rule_set_version,
            metric_set_hash AS declared_rule_set_hash
        FROM sdar_mart.v_evaluation_result_versioned

        UNION ALL

        SELECT
            tenant_id,
            project_id,
            evaluation_id,
            result_version,
            evaluation_group_id,
            evaluation_scope,
            adapter,
            framework,
            framework_version,
            profile,
            profile_version,
            'gate' AS rule_set_kind,
            gate_set_id AS rule_set_id,
            gate_set_version AS rule_set_version,
            gate_set_hash AS declared_rule_set_hash
        FROM sdar_mart.v_evaluation_result_versioned

        UNION ALL

        SELECT
            tenant_id,
            project_id,
            evaluation_id,
            result_version,
            evaluation_group_id,
            evaluation_scope,
            adapter,
            framework,
            framework_version,
            profile,
            profile_version,
            'fatal' AS rule_set_kind,
            fatal_set_id AS rule_set_id,
            fatal_set_version AS rule_set_version,
            fatal_set_hash AS declared_rule_set_hash
        FROM sdar_mart.v_evaluation_result_versioned
    ),
    registry AS
    (
        SELECT *
        FROM sdar_meta.evaluation_rule_set_definition FINAL
    ),
    global_registry AS
    (
        SELECT *
        FROM registry
        WHERE tenant_id = 'global' AND project_id = 'global'
    ),
    registry_candidates AS
    (
        SELECT
            r.tenant_id,
            r.project_id,
            r.evaluation_id,
            r.result_version,
            r.rule_set_kind,
            r.rule_set_id,
            r.rule_set_version,
            r.declared_rule_set_hash,
            d.rule_set_hash AS registry_rule_set_hash,
            d.status AS registry_status
        FROM result_rule_sets AS r
        INNER JOIN registry AS d
          ON r.tenant_id = d.tenant_id
         AND r.project_id = d.project_id
         AND r.framework = d.framework
         AND r.framework_version = d.framework_version
         AND r.evaluation_scope = d.evaluation_tier
         AND r.profile = d.profile
         AND r.profile_version = d.profile_version
         AND r.rule_set_kind = d.rule_set_kind
         AND r.rule_set_id = d.rule_set_id
         AND r.rule_set_version = d.rule_set_version

        UNION ALL

        SELECT
            r.tenant_id,
            r.project_id,
            r.evaluation_id,
            r.result_version,
            r.rule_set_kind,
            r.rule_set_id,
            r.rule_set_version,
            r.declared_rule_set_hash,
            d.rule_set_hash AS registry_rule_set_hash,
            d.status AS registry_status
        FROM result_rule_sets AS r
        INNER JOIN global_registry AS d
          ON r.framework = d.framework
         AND r.framework_version = d.framework_version
         AND r.evaluation_scope = d.evaluation_tier
         AND r.profile = d.profile
         AND r.profile_version = d.profile_version
         AND r.rule_set_kind = d.rule_set_kind
         AND r.rule_set_id = d.rule_set_id
         AND r.rule_set_version = d.rule_set_version
        WHERE r.tenant_id != 'global' OR r.project_id != 'global'
    ),
    registry_match_counts AS
    (
        SELECT
            tenant_id,
            project_id,
            evaluation_id,
            result_version,
            rule_set_kind,
            rule_set_id,
            rule_set_version,
            declared_rule_set_hash,
            count() AS identity_match_count,
            countIf(registry_rule_set_hash = declared_rule_set_hash) AS hash_match_count,
            countIf(
                registry_rule_set_hash = declared_rule_set_hash
                AND registry_status = 'active'
            ) AS active_hash_match_count
        FROM registry_candidates
        GROUP BY
            tenant_id,
            project_id,
            evaluation_id,
            result_version,
            rule_set_kind,
            rule_set_id,
            rule_set_version,
            declared_rule_set_hash
    )
SELECT
    r.tenant_id,
    r.project_id,
    r.evaluation_id,
    r.result_version,
    r.evaluation_group_id,
    r.evaluation_scope,
    r.adapter,
    r.framework,
    r.framework_version,
    r.profile,
    r.profile_version,
    r.rule_set_kind,
    r.rule_set_id,
    r.rule_set_version,
    r.declared_rule_set_hash,
    multiIf(
        ifNull(c.identity_match_count, toUInt64(0)) = toUInt64(0),
        'RULE_SET_NOT_FOUND',
        ifNull(c.identity_match_count, toUInt64(0)) != toUInt64(1),
        'RULE_SET_IDENTITY_NOT_UNIQUE',
        ifNull(c.hash_match_count, toUInt64(0)) = toUInt64(0),
        'RULE_SET_HASH_MISMATCH',
        ifNull(c.hash_match_count, toUInt64(0)) != toUInt64(1),
        'RULE_SET_HASH_NOT_UNIQUE',
        ifNull(c.active_hash_match_count, toUInt64(0)) = toUInt64(0),
        'RULE_SET_NOT_ACTIVE',
        'RULE_SET_ACTIVE_NOT_UNIQUE'
    ) AS issue_code,
    toUInt64(1) AS expected_match_count,
    ifNull(c.identity_match_count, toUInt64(0)) AS identity_match_count,
    ifNull(c.hash_match_count, toUInt64(0)) AS hash_match_count,
    ifNull(c.active_hash_match_count, toUInt64(0)) AS active_hash_match_count
FROM result_rule_sets AS r
LEFT JOIN registry_match_counts AS c
  ON r.tenant_id = c.tenant_id
 AND r.project_id = c.project_id
 AND r.evaluation_id = c.evaluation_id
 AND r.result_version = c.result_version
 AND r.rule_set_kind = c.rule_set_kind
 AND r.rule_set_id = c.rule_set_id
 AND r.rule_set_version = c.rule_set_version
 AND r.declared_rule_set_hash = c.declared_rule_set_hash
WHERE ifNull(c.identity_match_count, toUInt64(0)) != toUInt64(1)
   OR ifNull(c.hash_match_count, toUInt64(0)) != toUInt64(1)
   OR ifNull(c.active_hash_match_count, toUInt64(0)) != toUInt64(1);
