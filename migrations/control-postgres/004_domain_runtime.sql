BEGIN;
CREATE TABLE IF NOT EXISTS telemetry_control.domain_runtime_scope (
  tenant_id text NOT NULL, project_id text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,project_id)
);
CREATE TABLE IF NOT EXISTS telemetry_control.domain_runtime (
  tenant_id text NOT NULL, project_id text NOT NULL, projection_id text NOT NULL,
  lifecycle jsonb NOT NULL CHECK (jsonb_typeof(lifecycle)='object'),
  scan_cursor jsonb, completed_cursor jsonb,
  produced bigint NOT NULL DEFAULT 0, skipped bigint NOT NULL DEFAULT 0,
  failed bigint NOT NULL DEFAULT 0, duplicates bigint NOT NULL DEFAULT 0,
  last_error_code text, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,project_id,projection_id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES telemetry_control.domain_runtime_scope
);
CREATE TABLE IF NOT EXISTS telemetry_control.domain_runtime_record (
  tenant_id text NOT NULL, project_id text NOT NULL, projection_id text NOT NULL,
  identity_hash text NOT NULL, content_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('produced','duplicate','skipped','failed')),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,project_id,projection_id,identity_hash),
  FOREIGN KEY (tenant_id,project_id,projection_id) REFERENCES telemetry_control.domain_runtime
);
COMMIT;
