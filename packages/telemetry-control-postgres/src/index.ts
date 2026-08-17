import { randomUUID } from "node:crypto";

import { Pool } from "pg";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_LEASE_DURATION_MS = 5 * 60_000;

export type DomainProjectionLeaseKey = Readonly<{
  targetId: string;
  projectionId: string;
  projectionVersion: number;
  mappingHash: string;
  sourceStream: string;
  partitionId: string;
}>;

export type DomainProjectionLease = DomainProjectionLeaseKey &
  Readonly<{
    leaseOwner: string;
    leaseToken: string;
    fencingToken: number;
    acquiredAt: string;
    renewedAt: string;
    leaseUntil: string;
  }>;

export type ClaimDomainProjectionLease = DomainProjectionLeaseKey &
  Readonly<{
    leaseOwner: string;
    durationMs: number;
  }>;

export type DomainProjectionManagementActionType =
  | "approve_definition"
  | "set_mode"
  | "suspend"
  | "resume"
  | "resolve_dead_letter";

export type DomainProjectionManagementAction = Readonly<{
  actionId: string;
  projectionId: string;
  projectionVersion: number;
  actionType: DomainProjectionManagementActionType;
  expectedRevision: number;
  requestedBy: string;
  requestHash: string;
  payload: Readonly<Record<string, unknown>>;
  status: "pending" | "applied" | "rejected";
  createdAt: string;
  decidedAt: string | null;
}>;

export type DomainProjectionReplayRequest = Readonly<{
  replayRequestId: string;
  projectionId: string;
  projectionVersion: number;
  mappingHash: string;
  tenantId: string;
  projectId: string;
  episodeId: string | null;
  fromCursor: Readonly<Record<string, unknown>>;
  toCursor: Readonly<Record<string, unknown>>;
  requestedBy: string;
  requestHash: string;
  status: "requested" | "running" | "succeeded" | "failed" | "canceled";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}>;

export type DomainProjectionReconciliationRequest = Readonly<{
  reconciliationRequestId: string;
  projectionId: string;
  projectionVersion: number;
  mappingHash: string;
  tenantId: string;
  projectId: string;
  episodeId: string | null;
  fromCursor: Readonly<Record<string, unknown>>;
  toCursor: Readonly<Record<string, unknown>>;
  requestedBy: string;
  requestHash: string;
  status: "requested" | "running" | "succeeded" | "failed" | "canceled";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}>;

export type DomainSourceProducerRegistration = Readonly<{
  producerId: string;
  application: "commander" | "npc";
  tenantId: string;
  projectId: string;
  contractVersion: "sdar.domain-source/v1";
  credentialRef: string;
  status: "active" | "disabled";
  registeredAt: string;
  lastHeartbeatAt: string | null;
  metadata: Readonly<Record<string, unknown>>;
}>;

type Queryable = {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
};

type LeaseRow = {
  target_id: string;
  projection_id: string;
  projection_version: string;
  mapping_hash: string;
  source_stream: string;
  partition_id: string;
  lease_owner: string;
  lease_token: string;
  fencing_token: string;
  acquired_at: Date;
  renewed_at: Date;
  lease_until: Date;
};

export class DomainProjectionControlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainProjectionControlError";
  }
}

export class DomainProjectionControlRepository {
  constructor(private readonly database: Queryable) {}

  async claimLease(input: ClaimDomainProjectionLease): Promise<DomainProjectionLease | null> {
    assertLeaseKey(input);
    assertNonEmpty("leaseOwner", input.leaseOwner);
    assertLeaseDuration(input.durationMs);
    const leaseToken = randomUUID();
    const result = await this.database.query<LeaseRow>(
      `INSERT INTO telemetry_control.domain_projection_lease (
         target_id, projection_id, projection_version, mapping_hash,
         source_stream, partition_id, lease_owner, lease_token, fencing_token,
         acquired_at, renewed_at, lease_until, released_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,statement_timestamp(),statement_timestamp(),
         statement_timestamp() + ($9::bigint * interval '1 millisecond'),NULL)
       ON CONFLICT (
         target_id, projection_id, projection_version, mapping_hash, source_stream, partition_id
       ) DO UPDATE SET
         lease_owner = EXCLUDED.lease_owner,
         lease_token = EXCLUDED.lease_token,
         fencing_token = telemetry_control.domain_projection_lease.fencing_token + 1,
         acquired_at = EXCLUDED.acquired_at,
         renewed_at = EXCLUDED.renewed_at,
         lease_until = EXCLUDED.lease_until,
         released_at = NULL
       WHERE telemetry_control.domain_projection_lease.lease_until <= statement_timestamp()
       RETURNING *`,
      leaseParameters(input, [input.leaseOwner, leaseToken, input.durationMs]),
    );
    return result.rows[0] === undefined ? null : leaseFromRow(result.rows[0]);
  }

  async renewLease(lease: DomainProjectionLease, durationMs: number): Promise<DomainProjectionLease | null> {
    assertLeaseKey(lease);
    assertNonEmpty("leaseOwner", lease.leaseOwner);
    assertNonEmpty("leaseToken", lease.leaseToken);
    assertPositiveInteger("fencingToken", lease.fencingToken);
    assertLeaseDuration(durationMs);
    const result = await this.database.query<LeaseRow>(
      `UPDATE telemetry_control.domain_projection_lease SET
         renewed_at = statement_timestamp(),
         lease_until = statement_timestamp() + ($10::bigint * interval '1 millisecond')
       WHERE target_id=$1 AND projection_id=$2 AND projection_version=$3 AND mapping_hash=$4
         AND source_stream=$5 AND partition_id=$6 AND lease_owner=$7 AND lease_token=$8
         AND fencing_token=$9 AND released_at IS NULL AND lease_until > statement_timestamp()
       RETURNING *`,
      leaseParameters(lease, [lease.leaseOwner, lease.leaseToken, lease.fencingToken, durationMs]),
    );
    return result.rows[0] === undefined ? null : leaseFromRow(result.rows[0]);
  }

  async releaseLease(lease: DomainProjectionLease): Promise<boolean> {
    assertLeaseKey(lease);
    assertNonEmpty("leaseOwner", lease.leaseOwner);
    assertNonEmpty("leaseToken", lease.leaseToken);
    assertPositiveInteger("fencingToken", lease.fencingToken);
    const result = await this.database.query(
      `UPDATE telemetry_control.domain_projection_lease SET
         renewed_at = statement_timestamp(),
         lease_until = statement_timestamp(),
         released_at = statement_timestamp()
       WHERE target_id=$1 AND projection_id=$2 AND projection_version=$3 AND mapping_hash=$4
         AND source_stream=$5 AND partition_id=$6 AND lease_owner=$7 AND lease_token=$8
         AND fencing_token=$9 AND released_at IS NULL AND lease_until > statement_timestamp()`,
      leaseParameters(lease, [lease.leaseOwner, lease.leaseToken, lease.fencingToken]),
    );
    return result.rowCount === 1;
  }

  async readActiveLease(key: DomainProjectionLeaseKey): Promise<DomainProjectionLease | null> {
    assertLeaseKey(key);
    const result = await this.database.query<LeaseRow>(
      `SELECT * FROM telemetry_control.domain_projection_lease
       WHERE target_id=$1 AND projection_id=$2 AND projection_version=$3 AND mapping_hash=$4
         AND source_stream=$5 AND partition_id=$6 AND released_at IS NULL
         AND lease_until > statement_timestamp()`,
      leaseParameters(key),
    );
    return result.rows[0] === undefined ? null : leaseFromRow(result.rows[0]);
  }

  async registerManagementAction(
    action: Omit<DomainProjectionManagementAction, "status" | "createdAt" | "decidedAt">,
  ): Promise<DomainProjectionManagementAction> {
    assertNonEmpty("actionId", action.actionId);
    assertProjectionIdentity(action);
    assertNonNegativeInteger("expectedRevision", action.expectedRevision);
    assertNonEmpty("requestedBy", action.requestedBy);
    assertHash("requestHash", action.requestHash);
    assertPlainObject("payload", action.payload);
    const result = await this.database.query<ManagementActionRow>(
      `INSERT INTO telemetry_control.domain_projection_management_action (
         action_id, projection_id, projection_version, action_type, expected_revision,
         requested_by, request_hash, payload_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (action_id) DO NOTHING
       RETURNING *`,
      [
        action.actionId,
        action.projectionId,
        action.projectionVersion,
        action.actionType,
        action.expectedRevision,
        action.requestedBy,
        action.requestHash,
        JSON.stringify(action.payload),
      ],
    );
    if (result.rows[0] !== undefined) return managementActionFromRow(result.rows[0]);
    const existing = await this.database.query<ManagementActionRow>(
      `SELECT * FROM telemetry_control.domain_projection_management_action WHERE action_id=$1`,
      [action.actionId],
    );
    const found = existing.rows[0];
    if (found === undefined || found.request_hash !== action.requestHash) {
      throw new DomainProjectionControlError(
        "DOMAIN_PROJECTION_ACTION_ID_CONFLICT",
        "management action id is already bound to a different request",
      );
    }
    return managementActionFromRow(found);
  }

  async registerReplayRequest(
    request: Omit<
      DomainProjectionReplayRequest,
      "status" | "createdAt" | "startedAt" | "finishedAt"
    >,
  ): Promise<DomainProjectionReplayRequest> {
    assertNonEmpty("replayRequestId", request.replayRequestId);
    assertProjectionIdentity(request);
    assertHash("mappingHash", request.mappingHash);
    assertNonEmpty("tenantId", request.tenantId);
    assertNonEmpty("projectId", request.projectId);
    if (request.episodeId !== null) assertNonEmpty("episodeId", request.episodeId);
    assertPlainObject("fromCursor", request.fromCursor);
    assertPlainObject("toCursor", request.toCursor);
    assertNonEmpty("requestedBy", request.requestedBy);
    assertHash("requestHash", request.requestHash);
    const result = await this.database.query<ReplayRequestRow>(
      `INSERT INTO telemetry_control.domain_projection_replay_request (
         replay_request_id, projection_id, projection_version, mapping_hash,
         tenant_id, project_id, episode_id, from_cursor_json, to_cursor_json,
         requested_by, request_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
       ON CONFLICT (replay_request_id) DO NOTHING
       RETURNING *`,
      [
        request.replayRequestId,
        request.projectionId,
        request.projectionVersion,
        request.mappingHash,
        request.tenantId,
        request.projectId,
        request.episodeId,
        JSON.stringify(request.fromCursor),
        JSON.stringify(request.toCursor),
        request.requestedBy,
        request.requestHash,
      ],
    );
    if (result.rows[0] !== undefined) return replayRequestFromRow(result.rows[0]);
    const existing = await this.database.query<ReplayRequestRow>(
      `SELECT * FROM telemetry_control.domain_projection_replay_request WHERE replay_request_id=$1`,
      [request.replayRequestId],
    );
    const found = existing.rows[0];
    if (found === undefined || found.request_hash !== request.requestHash) {
      throw new DomainProjectionControlError(
        "DOMAIN_PROJECTION_REPLAY_ID_CONFLICT",
        "replay request id is already bound to a different request",
      );
    }
    return replayRequestFromRow(found);
  }

  async registerReconciliationRequest(
    request: Omit<
      DomainProjectionReconciliationRequest,
      "status" | "createdAt" | "startedAt" | "finishedAt"
    >,
  ): Promise<DomainProjectionReconciliationRequest> {
    assertNonEmpty("reconciliationRequestId", request.reconciliationRequestId);
    assertProjectionIdentity(request);
    assertHash("mappingHash", request.mappingHash);
    assertNonEmpty("tenantId", request.tenantId);
    assertNonEmpty("projectId", request.projectId);
    if (request.episodeId !== null) assertNonEmpty("episodeId", request.episodeId);
    assertPlainObject("fromCursor", request.fromCursor);
    assertPlainObject("toCursor", request.toCursor);
    assertNonEmpty("requestedBy", request.requestedBy);
    assertHash("requestHash", request.requestHash);
    const result = await this.database.query<ReconciliationRequestRow>(
      `INSERT INTO telemetry_control.domain_projection_reconciliation_request (
         reconciliation_request_id, projection_id, projection_version, mapping_hash,
         tenant_id, project_id, episode_id, from_cursor_json, to_cursor_json,
         requested_by, request_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
       ON CONFLICT (reconciliation_request_id) DO NOTHING
       RETURNING *`,
      [
        request.reconciliationRequestId,
        request.projectionId,
        request.projectionVersion,
        request.mappingHash,
        request.tenantId,
        request.projectId,
        request.episodeId,
        JSON.stringify(request.fromCursor),
        JSON.stringify(request.toCursor),
        request.requestedBy,
        request.requestHash,
      ],
    );
    if (result.rows[0] !== undefined) return reconciliationRequestFromRow(result.rows[0]);
    const existing = await this.database.query<ReconciliationRequestRow>(
      `SELECT * FROM telemetry_control.domain_projection_reconciliation_request
       WHERE reconciliation_request_id=$1`,
      [request.reconciliationRequestId],
    );
    const found = existing.rows[0];
    if (found === undefined || found.request_hash !== request.requestHash) {
      throw new DomainProjectionControlError(
        "DOMAIN_PROJECTION_RECONCILIATION_ID_CONFLICT",
        "reconciliation request id is already bound to a different request",
      );
    }
    return reconciliationRequestFromRow(found);
  }

  async registerProducer(
    producer: Omit<DomainSourceProducerRegistration, "status" | "registeredAt" | "lastHeartbeatAt">,
  ): Promise<DomainSourceProducerRegistration> {
    assertNonEmpty("producerId", producer.producerId);
    if (producer.application !== "commander" && producer.application !== "npc") {
      invalid("application", "must be commander or npc");
    }
    assertNonEmpty("tenantId", producer.tenantId);
    assertNonEmpty("projectId", producer.projectId);
    if (producer.contractVersion !== "sdar.domain-source/v1") {
      invalid("contractVersion", "must be sdar.domain-source/v1");
    }
    assertNonEmpty("credentialRef", producer.credentialRef);
    assertPlainObject("metadata", producer.metadata);
    const result = await this.database.query<ProducerRow>(
      `INSERT INTO telemetry_control.domain_source_producer_registration (
         producer_id, application, tenant_id, project_id, contract_version,
         credential_ref, metadata_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (producer_id) DO UPDATE SET
         credential_ref=EXCLUDED.credential_ref,
         metadata_json=EXCLUDED.metadata_json
       WHERE telemetry_control.domain_source_producer_registration.application=EXCLUDED.application
         AND telemetry_control.domain_source_producer_registration.tenant_id=EXCLUDED.tenant_id
         AND telemetry_control.domain_source_producer_registration.project_id=EXCLUDED.project_id
         AND telemetry_control.domain_source_producer_registration.contract_version=EXCLUDED.contract_version
       RETURNING *`,
      [
        producer.producerId,
        producer.application,
        producer.tenantId,
        producer.projectId,
        producer.contractVersion,
        producer.credentialRef,
        JSON.stringify(producer.metadata),
      ],
    );
    if (result.rows[0] === undefined) {
      throw new DomainProjectionControlError(
        "DOMAIN_SOURCE_PRODUCER_ID_CONFLICT",
        "producer id is already bound to a different source identity",
      );
    }
    return producerFromRow(result.rows[0]);
  }

  async heartbeatProducer(producerId: string): Promise<DomainSourceProducerRegistration | null> {
    assertNonEmpty("producerId", producerId);
    const result = await this.database.query<ProducerRow>(
      `UPDATE telemetry_control.domain_source_producer_registration
       SET last_heartbeat_at=GREATEST(registered_at,clock_timestamp())
       WHERE producer_id=$1 AND status='active'
       RETURNING *`,
      [producerId],
    );
    return result.rows[0] === undefined ? null : producerFromRow(result.rows[0]);
  }
}

export class ControlPostgres {
  private readonly pool: Pool;

  readonly domainProjections: DomainProjectionControlRepository;

  constructor(url: string, config: Readonly<Record<string, unknown>> = {}) {
    assertNonEmpty("url", url);
    this.pool = new Pool({ ...config, connectionString: url });
    this.domainProjections = new DomainProjectionControlRepository(this.pool);
  }

  async migrate(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async audit(actor: string, action: string, payload: unknown): Promise<void> {
    await this.pool.query(
      "INSERT INTO telemetry_control.audit_log(actor,action,payload_json) VALUES($1,$2,$3)",
      [actor, action, JSON.stringify(payload)],
    );
  }

  async listSources(): Promise<readonly Record<string, unknown>[]> {
    return (
      await this.pool.query<Record<string, unknown>>(
        "SELECT * FROM telemetry_control.source ORDER BY source_id",
      )
    ).rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

type ManagementActionRow = {
  action_id: string;
  projection_id: string;
  projection_version: string;
  action_type: DomainProjectionManagementActionType;
  expected_revision: string;
  requested_by: string;
  request_hash: string;
  payload_json: Record<string, unknown>;
  status: DomainProjectionManagementAction["status"];
  created_at: Date;
  decided_at: Date | null;
};

type ReplayRequestRow = {
  replay_request_id: string;
  projection_id: string;
  projection_version: string;
  mapping_hash: string;
  tenant_id: string;
  project_id: string;
  episode_id: string | null;
  from_cursor_json: Record<string, unknown>;
  to_cursor_json: Record<string, unknown>;
  requested_by: string;
  request_hash: string;
  status: DomainProjectionReplayRequest["status"];
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

type ReconciliationRequestRow = {
  reconciliation_request_id: string;
  projection_id: string;
  projection_version: string;
  mapping_hash: string;
  tenant_id: string;
  project_id: string;
  episode_id: string | null;
  from_cursor_json: Record<string, unknown>;
  to_cursor_json: Record<string, unknown>;
  requested_by: string;
  request_hash: string;
  status: DomainProjectionReconciliationRequest["status"];
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

type ProducerRow = {
  producer_id: string;
  application: "commander" | "npc";
  tenant_id: string;
  project_id: string;
  contract_version: "sdar.domain-source/v1";
  credential_ref: string;
  status: "active" | "disabled";
  registered_at: Date;
  last_heartbeat_at: Date | null;
  metadata_json: Record<string, unknown>;
};

function leaseParameters(key: DomainProjectionLeaseKey, tail: readonly unknown[] = []): unknown[] {
  return [
    key.targetId,
    key.projectionId,
    key.projectionVersion,
    key.mappingHash,
    key.sourceStream,
    key.partitionId,
    ...tail,
  ];
}

function leaseFromRow(row: LeaseRow): DomainProjectionLease {
  return Object.freeze({
    targetId: row.target_id,
    projectionId: row.projection_id,
    projectionVersion: safeDatabaseInteger("projectionVersion", row.projection_version),
    mappingHash: row.mapping_hash,
    sourceStream: row.source_stream,
    partitionId: row.partition_id,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    fencingToken: safeDatabaseInteger("fencingToken", row.fencing_token),
    acquiredAt: row.acquired_at.toISOString(),
    renewedAt: row.renewed_at.toISOString(),
    leaseUntil: row.lease_until.toISOString(),
  });
}

function managementActionFromRow(row: ManagementActionRow): DomainProjectionManagementAction {
  return Object.freeze({
    actionId: row.action_id,
    projectionId: row.projection_id,
    projectionVersion: safeDatabaseInteger("projectionVersion", row.projection_version),
    actionType: row.action_type,
    expectedRevision: safeDatabaseInteger("expectedRevision", row.expected_revision),
    requestedBy: row.requested_by,
    requestHash: row.request_hash,
    payload: freezeRecord(row.payload_json),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
  });
}

function replayRequestFromRow(row: ReplayRequestRow): DomainProjectionReplayRequest {
  return Object.freeze({
    replayRequestId: row.replay_request_id,
    projectionId: row.projection_id,
    projectionVersion: safeDatabaseInteger("projectionVersion", row.projection_version),
    mappingHash: row.mapping_hash,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    episodeId: row.episode_id,
    fromCursor: freezeRecord(row.from_cursor_json),
    toCursor: freezeRecord(row.to_cursor_json),
    requestedBy: row.requested_by,
    requestHash: row.request_hash,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  });
}

function reconciliationRequestFromRow(
  row: ReconciliationRequestRow,
): DomainProjectionReconciliationRequest {
  return Object.freeze({
    reconciliationRequestId: row.reconciliation_request_id,
    projectionId: row.projection_id,
    projectionVersion: safeDatabaseInteger("projectionVersion", row.projection_version),
    mappingHash: row.mapping_hash,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    episodeId: row.episode_id,
    fromCursor: freezeRecord(row.from_cursor_json),
    toCursor: freezeRecord(row.to_cursor_json),
    requestedBy: row.requested_by,
    requestHash: row.request_hash,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  });
}

function producerFromRow(row: ProducerRow): DomainSourceProducerRegistration {
  return Object.freeze({
    producerId: row.producer_id,
    application: row.application,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    contractVersion: row.contract_version,
    credentialRef: row.credential_ref,
    status: row.status,
    registeredAt: row.registered_at.toISOString(),
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
    metadata: freezeRecord(row.metadata_json),
  });
}

function assertLeaseKey(key: DomainProjectionLeaseKey): void {
  assertNonEmpty("targetId", key.targetId);
  assertProjectionIdentity(key);
  assertHash("mappingHash", key.mappingHash);
  assertNonEmpty("sourceStream", key.sourceStream);
  assertNonEmpty("partitionId", key.partitionId);
}

function assertProjectionIdentity(value: { projectionId: string; projectionVersion: number }): void {
  assertNonEmpty("projectionId", value.projectionId);
  assertPositiveInteger("projectionVersion", value.projectionVersion);
}

function assertLeaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_LEASE_DURATION_MS) {
    invalid("durationMs", `must be an integer from 1000 through ${MAX_LEASE_DURATION_MS}`);
  }
}

function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) invalid(field, "must be a positive integer");
}

function assertNonNegativeInteger(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid(field, "must be a non-negative integer");
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") invalid(field, "must not be empty");
}

function assertHash(field: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) invalid(field, "must be a canonical sha256 hash");
}

function assertPlainObject(field: string, value: Readonly<Record<string, unknown>>): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(field, "must be a JSON object");
  }
  JSON.stringify(value);
}

function safeDatabaseInteger(field: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DomainProjectionControlError(
      "DOMAIN_PROJECTION_CONTROL_DATABASE_VALUE_INVALID",
      `${field} is outside the supported integer range`,
    );
  }
  return parsed;
}

function freezeRecord(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(structuredClone(value));
}

function invalid(field: string, reason: string): never {
  throw new DomainProjectionControlError(
    "DOMAIN_PROJECTION_CONTROL_INPUT_INVALID",
    `${field} ${reason}`,
  );
}
