import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  canonicalizeDomainSourceJson,
  type DomainSourceBatchRequest,
  type DomainSourceContractId,
  type DomainSourceEpisodeSealRequest,
  type DomainSourceRecord,
  type DomainSourceV1Validator,
  type DomainSourceWalPayload,
} from "../../../packages/telemetry-contracts/src/index.js";
import type { ClickHouseInsertOptions } from "../../../packages/telemetry-clickhouse/src/index.js";
import { deterministicInsertDeduplicationToken } from "../../../packages/telemetry-clickhouse/src/index.js";
import {
  DurableSegmentWal,
  type WalFrame,
} from "../../../packages/telemetry-wal/src/index.js";

export interface DomainSourceClickHouseWriter {
  insert(
    table: string,
    rows: Record<string, unknown>[],
    options?: ClickHouseInsertOptions,
  ): Promise<void>;
}

export interface DomainSourceLandingWorkerDependencies {
  readonly wal: DurableSegmentWal<DomainSourceWalPayload>;
  readonly validator: DomainSourceV1Validator;
  readonly clickhouse: DomainSourceClickHouseWriter;
  readonly stateRoot: string;
  readonly clock?: Readonly<{ now(): string }>;
}

export interface DomainSourceWorkerCycleResult {
  readonly partitionsVisited: number;
  readonly framesCompleted: number;
  readonly writesCompleted: number;
}

interface DomainSourceWorkerCheckpoint {
  readonly schemaVersion: 1;
  readonly partition: string;
  readonly lastCompletedOffset: number;
  readonly walPayloadHash: string;
  readonly updatedAt: string;
}

interface DomainSourceFrameJournal {
  readonly schemaVersion: 1;
  readonly partition: string;
  readonly offset: number;
  readonly walPayloadHash: string;
  readonly completedWriteTokens: readonly string[];
  readonly updatedAt: string;
}

interface DomainSourceWrite {
  readonly table: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly token: string;
}

const sourceTableByContract = Object.freeze({
  "sdar.domain-source/commander/mcp-action": "sdar_commander.domain_mcp_action_source_v1",
  "sdar.domain-source/commander/mcp-receipt": "sdar_commander.domain_mcp_receipt_source_v1",
  "sdar.domain-source/commander/capability-track-sample":
    "sdar_commander.domain_capability_track_sample_source_v1",
  "sdar.domain-source/commander/error-recovery":
    "sdar_commander.domain_error_recovery_source_v1",
  "sdar.domain-source/commander/ugv-state-snapshot":
    "sdar_commander.domain_ugv_state_snapshot_source_v1",
  "sdar.domain-source/npc/mission-tool-call": "sdar_npc.domain_mission_tool_call_source_v1",
  "sdar.domain-source/npc/mcp-receipt": "sdar_npc.domain_mcp_receipt_source_v1",
  "sdar.domain-source/npc/hmi-approval": "sdar_npc.domain_hmi_approval_source_v1",
  "sdar.domain-source/npc/preemption-record": "sdar_npc.domain_preemption_record_source_v1",
  "sdar.domain-source/npc/blackboard-snapshot":
    "sdar_npc.domain_blackboard_snapshot_source_v1",
} satisfies Readonly<Record<DomainSourceContractId, string>>);

export const DOMAIN_SOURCE_V1_TABLE_ALLOWLIST = Object.freeze([
  ...Object.values(sourceTableByContract),
  "sdar_commander.domain_source_episode_seal_v1",
  "sdar_npc.domain_source_episode_seal_v1",
] as const);

/**
 * Crash-safe landing worker for the exact RC2 Domain Source tables.
 *
 * It does not run Domain mappings. Every successful table write is journaled durably, and the WAL
 * frame checkpoint advances only after all allowlisted source writes have completed.
 */
export class DomainSourceLandingWorker {
  private activeCycle: Promise<DomainSourceWorkerCycleResult> | undefined;
  private readonly clock: Readonly<{ now(): string }>;

  constructor(private readonly dependencies: DomainSourceLandingWorkerDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date().toISOString() };
  }

  processOnce(): Promise<DomainSourceWorkerCycleResult> {
    if (this.activeCycle !== undefined) return this.activeCycle;
    const operation = this.processAllPartitions();
    this.activeCycle = operation;
    const clear = (): void => {
      if (this.activeCycle === operation) this.activeCycle = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }

  async checkpoint(partition: string): Promise<number> {
    return (await this.readCheckpoint(partition))?.lastCompletedOffset ?? -1;
  }

  private async processAllPartitions(): Promise<DomainSourceWorkerCycleResult> {
    const partitions = await this.dependencies.wal.partitions();
    let framesCompleted = 0;
    let writesCompleted = 0;
    for (const partition of partitions) {
      const result = await this.processPartition(partition);
      framesCompleted += result.framesCompleted;
      writesCompleted += result.writesCompleted;
    }
    return Object.freeze({ partitionsVisited: partitions.length, framesCompleted, writesCompleted });
  }

  private async processPartition(
    partition: string,
  ): Promise<Pick<DomainSourceWorkerCycleResult, "framesCompleted" | "writesCompleted">> {
    const frames = await this.dependencies.wal.recover(partition);
    const checkpoint = await this.readCheckpoint(partition);
    if (
      checkpoint !== undefined &&
      (checkpoint.lastCompletedOffset >= frames.length ||
        frames[checkpoint.lastCompletedOffset]?.payloadHash !== checkpoint.walPayloadHash)
    ) {
      throw workerError("DOMAIN_SOURCE_WORKER_CHECKPOINT_CONFLICT");
    }
    let framesCompleted = 0;
    let writesCompleted = 0;
    for (const frame of frames) {
      if (frame.offset <= (checkpoint?.lastCompletedOffset ?? -1)) continue;
      writesCompleted += await this.processFrame(frame);
      await this.writeCheckpoint(frame);
      framesCompleted += 1;
    }
    return { framesCompleted, writesCompleted };
  }

  private async processFrame(frame: WalFrame<DomainSourceWalPayload>): Promise<number> {
    const writes = domainSourceWrites(frame.payload, this.dependencies.validator);
    const journal = await this.readJournal(frame);
    const completed = new Set(journal?.completedWriteTokens ?? []);
    const validTokens = new Set(writes.map((write) => write.token));
    if ([...completed].some((token) => !validTokens.has(token))) {
      throw workerError("DOMAIN_SOURCE_WORKER_JOURNAL_CONFLICT");
    }
    let writesCompleted = 0;
    for (const write of writes) {
      if (completed.has(write.token)) continue;
      await this.dependencies.clickhouse.insert(write.table, [...write.rows], {
        deduplicationToken: write.token,
      });
      completed.add(write.token);
      await this.writeJournal(frame, [...completed]);
      writesCompleted += 1;
    }
    return writesCompleted;
  }

  private async readCheckpoint(
    partition: string,
  ): Promise<DomainSourceWorkerCheckpoint | undefined> {
    const value = await readJsonIfPresent(this.checkpointPath(partition));
    if (value === undefined) return undefined;
    if (
      !isRecord(value) ||
      value["schemaVersion"] !== 1 ||
      value["partition"] !== partition ||
      !Number.isSafeInteger(value["lastCompletedOffset"]) ||
      (value["lastCompletedOffset"] as number) < 0 ||
      typeof value["walPayloadHash"] !== "string" ||
      typeof value["updatedAt"] !== "string"
    ) {
      throw workerError("DOMAIN_SOURCE_WORKER_CHECKPOINT_CORRUPT");
    }
    return value as unknown as DomainSourceWorkerCheckpoint;
  }

  private async readJournal(
    frame: WalFrame<DomainSourceWalPayload>,
  ): Promise<DomainSourceFrameJournal | undefined> {
    const value = await readJsonIfPresent(this.journalPath(frame));
    if (value === undefined) return undefined;
    if (
      !isRecord(value) ||
      value["schemaVersion"] !== 1 ||
      value["partition"] !== frame.partition ||
      value["offset"] !== frame.offset ||
      value["walPayloadHash"] !== frame.payloadHash ||
      typeof value["updatedAt"] !== "string" ||
      !Array.isArray(value["completedWriteTokens"]) ||
      !(value["completedWriteTokens"] as unknown[]).every(
        (token) => typeof token === "string" && /^[a-f0-9]{64}$/u.test(token),
      )
    ) {
      throw workerError("DOMAIN_SOURCE_WORKER_JOURNAL_CORRUPT");
    }
    return value as unknown as DomainSourceFrameJournal;
  }

  private async writeCheckpoint(frame: WalFrame<DomainSourceWalPayload>): Promise<void> {
    await writeDurableJson(this.checkpointPath(frame.partition), {
      schemaVersion: 1,
      partition: frame.partition,
      lastCompletedOffset: frame.offset,
      walPayloadHash: frame.payloadHash,
      updatedAt: this.clock.now(),
    } satisfies DomainSourceWorkerCheckpoint);
  }

  private async writeJournal(
    frame: WalFrame<DomainSourceWalPayload>,
    completedWriteTokens: readonly string[],
  ): Promise<void> {
    await writeDurableJson(this.journalPath(frame), {
      schemaVersion: 1,
      partition: frame.partition,
      offset: frame.offset,
      walPayloadHash: frame.payloadHash,
      completedWriteTokens,
      updatedAt: this.clock.now(),
    } satisfies DomainSourceFrameJournal);
  }

  private checkpointPath(partition: string): string {
    return path.join(this.dependencies.stateRoot, "checkpoints", `${partition}.json`);
  }

  private journalPath(frame: Pick<WalFrame, "partition" | "offset">): string {
    return path.join(
      this.dependencies.stateRoot,
      "journals",
      frame.partition,
      `${String(frame.offset).padStart(20, "0")}.json`,
    );
  }
}

export function domainSourceWrites(
  payload: DomainSourceWalPayload,
  validator: DomainSourceV1Validator,
): readonly DomainSourceWrite[] {
  if (payload.kind === "sdar-domain-source-v1-batch") {
    const batch = validator.assertBatch(payload.batch);
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const record of batch.records) {
      const table = sourceTableByContract[record.sourceContractId];
      const rows = grouped.get(table) ?? [];
      rows.push(recordRow(record, payload.receivedAt));
      grouped.set(table, rows);
    }
    return writesFromGroups(grouped);
  }
  if (payload.kind === "sdar-domain-source-v1-seal") {
    const seal = validator.assertEpisodeSeal(payload.seal);
    const table = `sdar_${seal.application}.domain_source_episode_seal_v1`;
    assertAllowlisted(table);
    return writesFromGroups(new Map([[table, [sealRow(seal, payload.receivedAt)]]]));
  }
  throw workerError("DOMAIN_SOURCE_WORKER_WAL_PAYLOAD_INVALID");
}

function recordRow(record: DomainSourceRecord, receivedAt: string): Record<string, unknown> {
  const payload = record.payload as Record<string, unknown>;
  const row: Record<string, unknown> = {
    tenant_id: record.tenantId,
    project_id: record.projectId,
    environment: record.environment,
    record_id: record.recordId,
    episode_id: record.episodeId,
    task_id: record.taskId ?? "",
    context_id: record.contextId ?? "",
    agent_id: record.agentId,
    agent_version: record.agentVersion ?? "",
    scenario_id: record.scenarioId ?? "",
    correlation_id: record.correlationId ?? "",
    sequence: record.sequence,
    source_revision: record.sourceRevision,
    source_contract_id: record.sourceContractId,
    source_contract_version: record.sourceContractVersion,
    producer_id: record.producerId,
    producer_version: record.producerVersion,
    payload_json: canonicalizeDomainSourceJson(record.payload),
    payload_sha256: stripHashPrefix(record.payloadHash),
    occurred_at: record.occurredAt,
    ingested_at: receivedAt,
  };
  switch (record.sourceContractId) {
    case "sdar.domain-source/commander/mcp-action":
    case "sdar.domain-source/npc/mission-tool-call":
      return Object.assign(row, actionColumns(payload));
    case "sdar.domain-source/commander/mcp-receipt":
    case "sdar.domain-source/npc/mcp-receipt":
      return Object.assign(row, receiptColumns(payload));
    case "sdar.domain-source/commander/capability-track-sample":
      return Object.assign(row, verificationColumns(payload));
    case "sdar.domain-source/commander/error-recovery":
    case "sdar.domain-source/npc/preemption-record":
      return Object.assign(row, preemptionColumns(payload));
    case "sdar.domain-source/commander/ugv-state-snapshot":
    case "sdar.domain-source/npc/blackboard-snapshot":
      return Object.assign(row, stateColumns(payload));
    case "sdar.domain-source/npc/hmi-approval":
      return Object.assign(row, approvalColumns(payload));
  }
}

function actionColumns(p: Record<string, unknown>): Record<string, unknown> {
  return pick(p, {
    actionId: "action_id", actionName: "action_name", targetEntityId: "target_entity_id",
    targetEntityType: "target_entity_type", deviceId: "device_id", resourceChannel: "resource_channel",
    capabilityRef: "capability_ref", controlAuthorityRef: "control_authority_ref",
    executionBasisRef: "execution_basis_ref", idempotencyKey: "idempotency_key",
    parametersHash: "parameters_hash", dispatchStatus: "dispatch_status",
  });
}

function receiptColumns(p: Record<string, unknown>): Record<string, unknown> {
  return pick(p, {
    receiptId: "receipt_id", actionId: "action_id", deviceId: "device_id",
    resourceChannel: "resource_channel", providerId: "provider_id",
    providerRequestId: "provider_request_id", transportStatus: "transport_status",
    acceptanceStatus: "acceptance_status", executionStatus: "execution_status",
    receivedAt: "received_at", outputSummary: "output_summary", errorCode: "error_code",
    rawResponseRef: "raw_response_ref", observedStateRef: "observed_state_ref",
  });
}

function verificationColumns(p: Record<string, unknown>): Record<string, unknown> {
  const row = pick(p, {
    physicalVerificationId: "physical_verification_id", verificationId: "verification_id",
    criterionId: "criterion_id", actionId: "action_id", receiptId: "receipt_id",
    deviceId: "device_id", resourceChannel: "resource_channel", capability: "capability",
    verificationChannel: "verification_channel", comparator: "comparator",
    verificationResult: "verification_result", stableDurationMs: "stable_duration_ms",
    deviceTimestamp: "device_timestamp", verifiedAt: "verified_at", sourceStateId: "source_state_id",
    evidenceRefs: "evidence_refs",
  });
  row["expected_json"] = canonicalizeDomainSourceJson(p["expected"]);
  row["actual_json"] = canonicalizeDomainSourceJson(p["actual"]);
  row["critical"] = booleanUInt8(p["critical"]);
  return row;
}

function preemptionColumns(p: Record<string, unknown>): Record<string, unknown> {
  const row = pick(p, {
    preemptionId: "preemption_id", preemptedActionId: "preempted_action_id",
    deviceId: "device_id", resourceChannel: "resource_channel", phase: "phase",
    triggerType: "trigger_type", triggerEventId: "trigger_event_id",
    requiredDeadlineMs: "required_deadline_ms", stopConfirmedAt: "stop_confirmed_at",
    recoveryStrategy: "recovery_strategy", recoveryResult: "recovery_result",
    recoveryBasisRef: "recovery_basis_ref", recoveryBasisVersion: "recovery_basis_version",
    resumedBasisId: "resumed_basis_id", resumedBasisVersion: "resumed_basis_version",
  });
  row["stop_confirmed"] = booleanUInt8(p["stopConfirmed"]);
  return row;
}

function stateColumns(p: Record<string, unknown>): Record<string, unknown> {
  const row = pick(p, {
    stateSnapshotId: "state_snapshot_id", stateSnapshotVersion: "state_snapshot_version",
    entityId: "entity_id", deviceId: "device_id", stateField: "state_field",
    sourceComponent: "source_component", observedAt: "observed_at", evaluatedAt: "evaluated_at",
    ageMs: "age_ms", thresholdMs: "threshold_ms", thresholdPolicyId: "threshold_policy_id",
    thresholdPolicyVersion: "threshold_policy_version", freshnessResult: "freshness_result",
  });
  row["conflict_detected"] = booleanUInt8(p["conflictDetected"]);
  row["missing"] = booleanUInt8(p["missing"]);
  return row;
}

function approvalColumns(p: Record<string, unknown>): Record<string, unknown> {
  return pick(p, {
    confirmationId: "confirmation_id", approvalId: "approval_id", actionId: "action_id",
    decision: "decision", requestedAt: "requested_at", respondedAt: "responded_at",
    approvedBy: "approved_by", validFrom: "valid_from", expiresAt: "expires_at",
    invalidatedAt: "invalidated_at", invalidationReason: "invalidation_reason",
    confirmationScope: "confirmation_scope", confirmationBasisRef: "confirmation_basis_ref",
    stateVersionAtApproval: "state_version_at_approval", evidenceRefs: "evidence_refs",
  });
}

function sealRow(
  seal: DomainSourceEpisodeSealRequest,
  receivedAt: string,
): Record<string, unknown> {
  return {
    tenant_id: seal.tenantId,
    project_id: seal.projectId,
    environment: seal.environment,
    seal_id: seal.sealId,
    seal_revision: seal.sealRevision,
    source_contract_id: seal.sourceContractId,
    source_contract_version: seal.sourceContractVersion,
    episode_id: seal.episodeId,
    final_sequence: seal.finalSequence,
    final_source_revision: seal.finalSourceRevision,
    source_record_count: seal.sourceRecordCount,
    source_snapshot_hash: stripHashPrefix(seal.sourceSnapshotHash),
    seal_status: seal.sealStatus,
    producer_id: seal.producerId,
    producer_version: seal.producerVersion,
    payload_json: canonicalizeDomainSourceJson(seal.payload),
    sealed_at: seal.sealedAt,
    ingested_at: receivedAt,
  };
}

function pick(
  source: Record<string, unknown>,
  fields: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [sourceField, targetField] of Object.entries(fields)) {
    if (source[sourceField] !== undefined) result[targetField] = source[sourceField];
  }
  return result;
}

function booleanUInt8(value: unknown): 0 | 1 {
  if (value === true) return 1;
  if (value === false) return 0;
  throw workerError("DOMAIN_SOURCE_WORKER_BOOLEAN_INVALID");
}

function stripHashPrefix(value: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw workerError("DOMAIN_SOURCE_WORKER_HASH_INVALID");
  }
  return value.slice("sha256:".length);
}

function writesFromGroups(
  grouped: ReadonlyMap<string, readonly Record<string, unknown>[]>,
): readonly DomainSourceWrite[] {
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, rows]) => {
      assertAllowlisted(table);
      return { table, rows, token: deterministicInsertDeduplicationToken(table, rows) };
    });
}

function assertAllowlisted(table: string): void {
  if (!(DOMAIN_SOURCE_V1_TABLE_ALLOWLIST as readonly string[]).includes(table)) {
    throw workerError("DOMAIN_SOURCE_WORKER_TABLE_FORBIDDEN");
  }
}

async function readJsonIfPresent(filename: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filename, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    if (error instanceof SyntaxError) throw workerError("DOMAIN_SOURCE_WORKER_STATE_CORRUPT");
    throw error;
  }
}

async function writeDurableJson(filename: string, value: unknown): Promise<void> {
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filename)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporary, filename);
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

function workerError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
