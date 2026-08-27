BEGIN;
CREATE TABLE IF NOT EXISTS telemetry_control.provider_closure_origin (
 origin_id text PRIMARY KEY, scope_json jsonb NOT NULL, scope_hash text NOT NULL,
 not_before timestamptz NOT NULL DEFAULT clock_timestamp(),
 scan_projected_at timestamptz NOT NULL DEFAULT clock_timestamp(), scan_row_id text NOT NULL DEFAULT ''
);
CREATE OR REPLACE FUNCTION telemetry_control.protect_provider_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.origin_id<>OLD.origin_id OR NEW.scope_json<>OLD.scope_json OR NEW.scope_hash<>OLD.scope_hash OR NEW.not_before<>OLD.not_before THEN
  RAISE EXCEPTION 'PROVIDER_ORIGIN_IMMUTABLE';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS protect_provider_origin ON telemetry_control.provider_closure_origin;
CREATE TRIGGER protect_provider_origin BEFORE UPDATE OR DELETE ON telemetry_control.provider_closure_origin
 FOR EACH ROW EXECUTE FUNCTION telemetry_control.protect_provider_origin();
CREATE TABLE IF NOT EXISTS telemetry_control.provider_closure_episode (
 origin_id text NOT NULL REFERENCES telemetry_control.provider_closure_origin,
 episode_id text NOT NULL, lease_owner text, lease_token bigint NOT NULL DEFAULT 0, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 pending_snapshot jsonb, pending_input_hash text, last_input_hash text, last_snapshot_id text,
 last_status text NOT NULL DEFAULT 'waiting_source', last_error_code text,
 attempts bigint NOT NULL DEFAULT 0, published bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(origin_id,episode_id)
);
CREATE INDEX IF NOT EXISTS provider_closure_claim ON telemetry_control.provider_closure_episode(next_attempt_at,lease_until);
COMMIT;
