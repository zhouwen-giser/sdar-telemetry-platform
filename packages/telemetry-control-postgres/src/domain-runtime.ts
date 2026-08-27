import type { Pool } from "pg";
import { hashCanonicalDomainProjectionJson } from "../../telemetry-contracts/src/index.js";
import {
  transitionDomainProjectionLifecycle,
  type DomainProjectionLifecycle,
  type DomainProjectionActivationGuard,
  type DomainProjectionLifecycleAction,
} from "../../telemetry-projection-registry/src/lifecycle.js";
import type {
  DomainProjectionLease,
  DomainSourceProducerRegistration,
} from "./index.js";

export type DomainRuntimeScope = Readonly<{
  tenantId: string;
  projectId: string;
}>;
export type IngestionCursor = Readonly<{
  ingestedAt: string;
  recordId: string;
  sourceRevision: string;
}>;
export type DomainRuntimeRow = Readonly<{
  lifecycle: DomainProjectionLifecycle;
  activatedAt: string;
  scanCursor: IngestionCursor | null;
  completedCursor: IngestionCursor | null;
  produced: number;
  skipped: number;
  failed: number;
  duplicates: number;
  lastErrorCode: string | null;
  updatedAt: string;
}>;
type Row = {
  lifecycle: DomainProjectionLifecycle;
  activated_at: string;
  scan_cursor: IngestionCursor | null;
  completed_cursor: IngestionCursor | null;
  produced: string;
  skipped: string;
  failed: string;
  duplicates: string;
  last_error_code: string | null;
  updated_at: Date;
};
interface PoolClient {
  query<T = unknown>(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  release(): void;
}

/** PostgreSQL owns lifecycle, ingestion floor, exact completed identities and delivery progress. */
export class DomainRuntimeRepository {
  constructor(private readonly pool: Pool) {}
  async initialize(
    scope: DomainRuntimeScope,
    initial: DomainProjectionLifecycle,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO telemetry_control.domain_runtime_scope(tenant_id,project_id)
      VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [scope.tenantId, scope.projectId],
    );
    await this.pool.query(
      `INSERT INTO telemetry_control.domain_runtime(tenant_id,project_id,projection_id,lifecycle)
      VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
      [
        scope.tenantId,
        scope.projectId,
        initial.projectionId,
        JSON.stringify(initial),
      ],
    );
  }
  async list(scope: DomainRuntimeScope): Promise<readonly DomainRuntimeRow[]> {
    const result = await this.pool.query<Row>(
      `SELECT runtime.*,to_char(scope.activated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activated_at FROM telemetry_control.domain_runtime runtime
      JOIN telemetry_control.domain_runtime_scope scope USING(tenant_id,project_id)
      WHERE tenant_id=$1 AND project_id=$2 ORDER BY projection_id`,
      [scope.tenantId, scope.projectId],
    );
    return result.rows.map((row) => ({
      lifecycle: row.lifecycle,
      activatedAt: row.activated_at,
      scanCursor: row.scan_cursor,
      completedCursor: row.completed_cursor,
      produced: Number(row.produced),
      skipped: Number(row.skipped),
      failed: Number(row.failed),
      duplicates: Number(row.duplicates),
      lastErrorCode: row.last_error_code,
      updatedAt: row.updated_at.toISOString(),
    }));
  }
  async producers(
    scope: DomainRuntimeScope,
  ): Promise<readonly DomainSourceProducerRegistration[]> {
    const result = await this.pool.query<{
      producer_id: string;
      application: "commander" | "npc";
      credential_ref: string;
      metadata_json: Record<string, unknown>;
      registered_at: Date;
    }>(
      `SELECT * FROM telemetry_control.domain_source_producer_registration
      WHERE tenant_id=$1 AND project_id=$2 AND status='active' AND contract_version='sdar.domain-source/v1' ORDER BY application`,
      [scope.tenantId, scope.projectId],
    );
    return result.rows.map((row) => ({
      producerId: row.producer_id,
      application: row.application,
      ...scope,
      credentialRef: row.credential_ref,
      metadata: row.metadata_json,
      contractVersion: "sdar.domain-source/v1",
      status: "active",
      registeredAt: row.registered_at.toISOString(),
      lastHeartbeatAt: null,
    }));
  }
  async pendingActions(scope: DomainRuntimeScope): Promise<readonly string[]> {
    const result = await this.pool.query<{ action_id: string }>(
      `SELECT action_id FROM telemetry_control.domain_projection_management_action
      WHERE status='pending' AND payload_json->>'tenantId'=$1 AND payload_json->>'projectId'=$2 ORDER BY created_at,action_id LIMIT 100`,
      [scope.tenantId, scope.projectId],
    );
    return result.rows.map((row) => row.action_id);
  }
  async actions(
    scope: DomainRuntimeScope,
  ): Promise<readonly { actionId: string; status: string }[]> {
    const result = await this.pool.query<{ action_id: string; status: string }>(
      `SELECT action_id,status FROM telemetry_control.domain_projection_management_action
      WHERE payload_json->>'tenantId'=$1 AND payload_json->>'projectId'=$2 ORDER BY created_at DESC,action_id LIMIT 100`,
      [scope.tenantId, scope.projectId],
    );
    return result.rows.map((row) => ({
      actionId: row.action_id,
      status: row.status,
    }));
  }
  async completedCount(scope: DomainRuntimeScope, id: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM telemetry_control.domain_runtime_record WHERE tenant_id=$1 AND project_id=$2 AND projection_id=$3`,
      [scope.tenantId, scope.projectId, id],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
  async applyAction(
    scope: DomainRuntimeScope,
    actionId: string,
    guardFor: (
      state: DomainProjectionLifecycle,
    ) => Promise<DomainProjectionActivationGuard>,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const actions = await client.query<{
        projection_id: string;
        projection_version: number;
        expected_revision: string;
        action_type: string;
        payload_json: Record<string, unknown>;
      }>(
        `SELECT * FROM telemetry_control.domain_projection_management_action WHERE action_id=$1 AND status='pending'
         AND payload_json->>'tenantId'=$2 AND payload_json->>'projectId'=$3 FOR UPDATE`,
        [actionId, scope.tenantId, scope.projectId],
      );
      const action = actions.rows[0];
      if (action === undefined) return;
      let state: DomainProjectionLifecycle | undefined;
      let rejection: string | null = null;
      try {
        state = await this.lockState(client, scope, action.projection_id);
        if (Number(action.projection_version) !== state.projectionVersion)
          throw failure("PROJECTION_VERSION_MISMATCH");
        if (
          action.payload_json["expectedDefinitionHash"] !==
            state.definitionHash ||
          action.payload_json["expectedMappingHash"] !== state.mappingHash
        )
          throw failure("PROJECTION_ACTIVATION_HASH_MISMATCH");
        const mapped =
          action.action_type === "set_mode"
            ? `set_${String(action.payload_json["mode"])}`
            : action.action_type;
        const allowed: readonly string[] = [
          "approve_definition",
          "set_shadow",
          "set_dry_run",
          "set_active",
          "suspend",
          "resume",
        ];
        if (!allowed.includes(mapped))
          throw failure("PROJECTION_ACTION_UNSUPPORTED");
        const next = transitionDomainProjectionLifecycle(
          state,
          {
            actionId,
            expectedRevision: Number(action.expected_revision),
            action: mapped as DomainProjectionLifecycleAction["action"],
          },
          await guardFor(state),
        );
        await client.query(
          `UPDATE telemetry_control.domain_runtime SET lifecycle=$4::jsonb,last_error_code=NULL,updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND project_id=$2 AND projection_id=$3`,
          [
            scope.tenantId,
            scope.projectId,
            state.projectionId,
            JSON.stringify(next),
          ],
        );
      } catch (error) {
        rejection = stableCode(error);
      }
      await client.query(
        `UPDATE telemetry_control.domain_projection_management_action SET status=$2,decided_at=clock_timestamp()
        WHERE action_id=$1`,
        [actionId, rejection === null ? "applied" : "rejected"],
      );
      await client.query(
        `INSERT INTO telemetry_control.audit_log(actor,action,payload_json) VALUES($1,$2,$3::jsonb)`,
        [
          "domain-projection-worker",
          "projection.action",
          JSON.stringify({
            actionId,
            projectionId: action.projection_id,
            errorCode: rejection,
          }),
        ],
      );
      if (rejection !== null && state !== undefined)
        await this.setErrorWithin(client, scope, state.projectionId, rejection);
    });
  }
  async error(
    scope: DomainRuntimeScope,
    id: string,
    code: string,
  ): Promise<void> {
    await this.setErrorWithin(this.pool, scope, id, code);
  }
  async resetScan(
    scope: DomainRuntimeScope,
    id: string,
    lease: DomainProjectionLease,
  ): Promise<void> {
    await this.transaction(async (client) => {
      await this.lockState(client, scope, id);
      await this.assertLease(client, lease);
      await client.query(
        `UPDATE telemetry_control.domain_runtime SET scan_cursor=NULL WHERE tenant_id=$1 AND project_id=$2 AND projection_id=$3`,
        [scope.tenantId, scope.projectId, id],
      );
    });
  }
  async complete(
    scope: DomainRuntimeScope,
    id: string,
    lease: DomainProjectionLease,
    record: {
      identityHash: string;
      contentHash: string;
      cursor: IngestionCursor;
    },
    write: () => Promise<{ outcome: string; checkpointEligible: boolean }>,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const state = await this.lockState(client, scope, id);
      if (state.state !== "ACTIVE") throw failure("PROJECTION_NOT_ACTIVE");
      await this.assertLease(client, lease);
      const prior = await client.query<{ content_hash: string }>(
        `SELECT content_hash FROM telemetry_control.domain_runtime_record
        WHERE tenant_id=$1 AND project_id=$2 AND projection_id=$3 AND identity_hash=$4`,
        [scope.tenantId, scope.projectId, id, record.identityHash],
      );
      if (
        prior.rows[0] !== undefined &&
        prior.rows[0].content_hash !== record.contentHash
      )
        throw failure("SOURCE_CONTENT_CONFLICT");
      const result =
        prior.rows[0] === undefined
          ? await write()
          : { outcome: "duplicate", checkpointEligible: true };
      if (!result.checkpointEligible)
        throw failure("PROJECTION_TERMINAL_BLOCKED");
      if (
        !["produced", "duplicate", "skipped", "failed"].includes(result.outcome)
      )
        throw failure("PROJECTION_TERMINAL_INVALID");
      // Holding the lease row prevents takeover during writes; expiry is checked again before commit.
      await this.assertLease(client, lease);
      await client.query(
        `INSERT INTO telemetry_control.domain_runtime_record(tenant_id,project_id,projection_id,identity_hash,content_hash,outcome)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [
          scope.tenantId,
          scope.projectId,
          id,
          record.identityHash,
          record.contentHash,
          result.outcome,
        ],
      );
      await client.query(
        `UPDATE telemetry_control.domain_runtime SET scan_cursor=$4::jsonb,
        completed_cursor=CASE WHEN completed_cursor IS NULL OR
          ((completed_cursor->>'ingestedAt')::timestamptz,completed_cursor->>'recordId',(completed_cursor->>'sourceRevision')::numeric)
          < (($4::jsonb->>'ingestedAt')::timestamptz,$4::jsonb->>'recordId',($4::jsonb->>'sourceRevision')::numeric)
          THEN $4::jsonb ELSE completed_cursor END,
        produced=produced+CASE WHEN $5='produced' THEN 1 ELSE 0 END,skipped=skipped+CASE WHEN $5='skipped' THEN 1 ELSE 0 END,
        failed=failed+CASE WHEN $5='failed' THEN 1 ELSE 0 END,duplicates=duplicates+CASE WHEN $5='duplicate' THEN 1 ELSE 0 END,
        last_error_code=NULL,updated_at=clock_timestamp() WHERE tenant_id=$1 AND project_id=$2 AND projection_id=$3`,
        [
          scope.tenantId,
          scope.projectId,
          id,
          JSON.stringify(record.cursor),
          result.outcome,
        ],
      );
    });
  }
  private async lockState(
    client: PoolClient,
    scope: DomainRuntimeScope,
    id: string,
  ): Promise<DomainProjectionLifecycle> {
    const result = await client.query<{ lifecycle: DomainProjectionLifecycle }>(
      `SELECT lifecycle FROM telemetry_control.domain_runtime
      WHERE tenant_id=$1 AND project_id=$2 AND projection_id=$3 FOR UPDATE`,
      [scope.tenantId, scope.projectId, id],
    );
    if (result.rows[0] === undefined)
      throw failure("PROJECTION_NOT_REGISTERED");
    return result.rows[0].lifecycle;
  }
  private async assertLease(
    client: PoolClient,
    lease: DomainProjectionLease,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM telemetry_control.domain_projection_lease WHERE target_id=$1 AND projection_id=$2
      AND projection_version=$3 AND mapping_hash=$4 AND source_stream=$5 AND partition_id=$6 AND lease_owner=$7 AND lease_token=$8
      AND fencing_token=$9 AND released_at IS NULL AND lease_until>clock_timestamp() FOR UPDATE`,
      [
        lease.targetId,
        lease.projectionId,
        lease.projectionVersion,
        lease.mappingHash,
        lease.sourceStream,
        lease.partitionId,
        lease.leaseOwner,
        lease.leaseToken,
        lease.fencingToken,
      ],
    );
    if (result.rowCount !== 1) throw failure("PROJECTION_LEASE_LOST");
  }
  private async setErrorWithin(
    client: Pick<Pool, "query">,
    scope: DomainRuntimeScope,
    id: string,
    code: string,
  ): Promise<void> {
    await client.query(
      `UPDATE telemetry_control.domain_runtime SET last_error_code=$4,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND project_id=$2 AND projection_id=$3`,
      [scope.tenantId, scope.projectId, id, code],
    );
  }
  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
export function stableCode(error: unknown): string {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code)
    ? code
    : "DOMAIN_RUNTIME_FAILED";
}
export function failure(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
export function domainActionHash(value: Record<string, unknown>): string {
  return hashCanonicalDomainProjectionJson(value);
}
