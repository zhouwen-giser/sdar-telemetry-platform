CREATE TABLE IF NOT EXISTS telemetry_control.domain_projection_reconciliation_request (
  reconciliation_request_id text PRIMARY KEY CHECK (btrim(reconciliation_request_id) <> ''),
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

CREATE INDEX IF NOT EXISTS domain_projection_reconciliation_request_due_idx
  ON telemetry_control.domain_projection_reconciliation_request (
    status, created_at, reconciliation_request_id
  );
