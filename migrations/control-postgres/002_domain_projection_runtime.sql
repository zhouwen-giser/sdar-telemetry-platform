CREATE TABLE IF NOT EXISTS telemetry_control.domain_projection_lease (
  target_id text NOT NULL CHECK (btrim(target_id) <> ''),
  projection_id text NOT NULL CHECK (btrim(projection_id) <> ''),
  projection_version bigint NOT NULL CHECK (projection_version >= 1),
  mapping_hash text NOT NULL CHECK (mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_stream text NOT NULL CHECK (source_stream = 'sdar.domain-source/v1'),
  partition_id text NOT NULL CHECK (btrim(partition_id) <> ''),
  lease_owner text NOT NULL CHECK (btrim(lease_owner) <> ''),
  lease_token uuid NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
  acquired_at timestamptz NOT NULL,
  renewed_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (
    target_id,
    projection_id,
    projection_version,
    mapping_hash,
    source_stream,
    partition_id
  ),
  CHECK (renewed_at >= acquired_at),
  CHECK (lease_until >= renewed_at),
  CHECK (released_at IS NULL OR released_at >= acquired_at)
);

CREATE INDEX IF NOT EXISTS domain_projection_lease_due_idx
  ON telemetry_control.domain_projection_lease (lease_until, projection_id);

CREATE TABLE IF NOT EXISTS telemetry_control.domain_projection_management_action (
  action_id text PRIMARY KEY CHECK (btrim(action_id) <> ''),
  projection_id text NOT NULL CHECK (btrim(projection_id) <> ''),
  projection_version bigint NOT NULL CHECK (projection_version >= 1),
  action_type text NOT NULL CHECK (
    action_type IN (
      'approve_definition',
      'set_mode',
      'suspend',
      'resume',
      'resolve_dead_letter'
    )
  ),
  expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
  requested_by text NOT NULL CHECK (btrim(requested_by) <> ''),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'applied', 'rejected')
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  CHECK (
    (status = 'pending' AND decided_at IS NULL)
    OR (status IN ('applied', 'rejected') AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS domain_projection_management_action_pending_idx
  ON telemetry_control.domain_projection_management_action (status, created_at, action_id);

CREATE TABLE IF NOT EXISTS telemetry_control.domain_projection_replay_request (
  replay_request_id text PRIMARY KEY CHECK (btrim(replay_request_id) <> ''),
  projection_id text NOT NULL CHECK (btrim(projection_id) <> ''),
  projection_version bigint NOT NULL CHECK (projection_version >= 1),
  mapping_hash text NOT NULL CHECK (mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  tenant_id text NOT NULL CHECK (btrim(tenant_id) <> ''),
  project_id text NOT NULL CHECK (btrim(project_id) <> ''),
  episode_id text,
  from_cursor_json jsonb NOT NULL CHECK (jsonb_typeof(from_cursor_json) = 'object'),
  to_cursor_json jsonb NOT NULL CHECK (jsonb_typeof(to_cursor_json) = 'object'),
  requested_by text NOT NULL CHECK (btrim(requested_by) <> ''),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested', 'running', 'succeeded', 'failed', 'canceled')
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  CHECK (episode_id IS NULL OR btrim(episode_id) <> ''),
  CHECK (started_at IS NULL OR started_at >= created_at),
  CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at))
);

CREATE INDEX IF NOT EXISTS domain_projection_replay_request_due_idx
  ON telemetry_control.domain_projection_replay_request (status, created_at, replay_request_id);

CREATE TABLE IF NOT EXISTS telemetry_control.domain_source_producer_registration (
  producer_id text PRIMARY KEY CHECK (btrim(producer_id) <> ''),
  application text NOT NULL CHECK (application IN ('commander', 'npc')),
  tenant_id text NOT NULL CHECK (btrim(tenant_id) <> ''),
  project_id text NOT NULL CHECK (btrim(project_id) <> ''),
  contract_version text NOT NULL CHECK (contract_version = 'sdar.domain-source/v1'),
  credential_ref text NOT NULL CHECK (btrim(credential_ref) <> ''),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_heartbeat_at timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  UNIQUE (application, tenant_id, project_id),
  CHECK (last_heartbeat_at IS NULL OR last_heartbeat_at >= registered_at)
);
