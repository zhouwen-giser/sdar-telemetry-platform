-- SDAR ClickHouse Schema 1.3.0-rc.1 / Runtime v1.3 event-handling additive migration.
-- This migration adds the event handling trace projection without creating a
-- second event authority. sdar_core.event_record remains the source fact.

INSERT INTO sdar_meta.schema_definition
(
    tenant_id, project_id, schema_name, schema_version, schema_family,
    status, json_schema, schema_hash, compatible_from, description
)
VALUES
(
    'global', 'global', 'sdar.external-event-envelope', 1, 'sdar.evidence/v1',
    'active',
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["eventType","source","subjectType","subjectId","occurredAt"],"properties":{"eventType":{"type":"string"},"source":{"type":"string"},"subjectType":{"type":"string"},"subjectId":{"type":"string"},"occurredAt":{"type":"string","format":"date-time"},"attributes":{"type":"object"}}}',
    lower(hex(SHA256('sdar.external-event-envelope/1'))),
    1,
    'External event envelope accepted by the SDAR event-handling boundary.'
);

INSERT INTO sdar_meta.event_definition
(
    tenant_id, project_id, catalog_version, event_type, event_category,
    payload_schema_name, payload_schema_version, description, status
)
VALUES
('global','global','1.3','smpp_registry.sync_started','registry','sdar.external-event-envelope',1,'SMPP registry synchronization started.','active'),
('global','global','1.3','smpp_registry.sync_completed','registry','sdar.external-event-envelope',1,'SMPP registry synchronization completed.','active'),
('global','global','1.3','smpp_registry.sync_failed','registry','sdar.external-event-envelope',1,'SMPP registry synchronization failed.','active'),
('global','global','1.3','smpp_registry.snapshot_activated','registry','sdar.external-event-envelope',1,'SMPP registry snapshot activated.','active'),
('global','global','1.3','mcp_provider.imported','provider','sdar.external-event-envelope',1,'MCP provider imported.','active'),
('global','global','1.3','mcp_provider.catalog_drift','provider','sdar.external-event-envelope',1,'MCP provider catalog drift detected.','active'),
('global','global','1.3','incident.opened','incident','sdar.external-event-envelope',1,'Incident opened for supervision.','active'),
('global','global','1.3','incident.closed','incident','sdar.external-event-envelope',1,'Incident closed after verification.','active');

INSERT INTO sdar_meta.data_quality_rule
(
    tenant_id, project_id, rule_id, rule_version, scope,
    target_database, target_table, severity, blocking,
    sql_predicate, description, remediation, status
)
VALUES
(
    'global','global','DQ-EVENT-01',1,'record',
    'sdar_core','event_record','error',1,
    'domain_event_type = '''' OR event_source = '''' OR subject_type = '''' OR subject_id = ''''',
    'Event-handling facts must identify the event type, source and subject.',
    'Fix the source event envelope and replay the affected source records.',
    'active'
);

CREATE VIEW IF NOT EXISTS sdar_core.v_event_handling_trace AS
SELECT
    tenant_id,
    project_id,
    environment,
    record_id,
    event_id,
    episode_id,
    run_id,
    correlation_id,
    trace_id,
    sequence,
    domain_event_type,
    event_source,
    subject_type,
    subject_id,
    causation_id,
    accepted_into_state,
    state_version_before,
    resulting_state_version,
    fact_summary,
    evidence_refs,
    attributes,
    occurred_at,
    observed_at,
    ingested_at
FROM sdar_core.event_record
WHERE domain_event_type != '';

SELECT throwIf(
    count() != 1,
    'SMOKE v1.3 event handling: v_event_handling_trace missing'
)
FROM system.tables
WHERE database = 'sdar_core'
  AND name = 'v_event_handling_trace'
  AND engine = 'View';
