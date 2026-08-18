import { Buffer } from "node:buffer";

import {
  DOMAIN_PROJECTION_CONTRACT_VERSION,
  canonicalizeDomainProjectionJson,
  hashCanonicalDomainProjectionJson,
  type DomainSourceRecord,
  type DomainSourceSha256,
} from "../../../packages/telemetry-contracts/src/index.js";
import type {
  ClickHouseInsertOptions,
  ClickHouseQueryOptions,
} from "../../../packages/telemetry-clickhouse/src/index.js";
import type { CommanderMappingDecision } from "../../../packages/telemetry-projection-registry/src/commander-mappings.js";
import {
  DOMAIN_CANONICAL_ID_NAMESPACE,
  DOMAIN_CANONICAL_ID_NAMESPACE_VERSION,
  DOMAIN_ENVIRONMENT_MAP_VERSION,
  type DomainCommonTargetEnvelope,
  type DomainProjectionDescriptor,
  uuidV5,
} from "../../../packages/telemetry-projection-registry/src/domain.js";
import type { NpcMappingDecision } from "../../../packages/telemetry-projection-registry/src/npc-mappings.js";

export const DOMAIN_TARGET_CONFLICT_CODE = "TARGET_CONTENT_CONFLICT" as const;
export const DOMAIN_LINEAGE_CONFLICT_CODE = "MAPPER_DETERMINISM_VIOLATION" as const;
const TARGET_DATABASE = "sdar_embodied" as const;
const LINEAGE_TABLE = "sdar_meta.projection_lineage" as const;
const DEAD_LETTER_TABLE = "sdar_meta.projection_dead_letter" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export type DomainMappingDecision = CommanderMappingDecision | NpcMappingDecision;

export type DomainTerminalOutcome = "produced" | "duplicate" | "skipped" | "failed" | "blocked";

export type DomainTerminalClosure = Readonly<{
  outcome: DomainTerminalOutcome;
  checkpointEligible: boolean;
  targetWritten: boolean;
  lineageWritten: boolean;
  deadLetterWritten: boolean;
  reasonCode: string;
}>;

export type DomainTerminalCloseInput = Readonly<{
  descriptor: DomainProjectionDescriptor;
  source: DomainSourceRecord;
  decision: DomainMappingDecision;
  projectionRunId: string;
  mappingHash: DomainSourceSha256;
  sourceCursor: string;
  projectedAt: string;
}>;

export interface DomainTargetClickHouseClient {
  query(sql: string, options?: ClickHouseQueryOptions): Promise<string>;
  insert(
    table: string,
    rows: Record<string, unknown>[],
    options?: ClickHouseInsertOptions,
  ): Promise<void>;
}

export interface DomainCheckpointCommitter {
  commit(
    input: Readonly<{ source: DomainSourceRecord; closure: DomainTerminalClosure }>,
  ): Promise<void>;
}

export class ClickHouseDomainTargetWriter {
  constructor(private readonly clickHouse: DomainTargetClickHouseClient) {}

  async close(input: DomainTerminalCloseInput): Promise<DomainTerminalClosure> {
    assertCloseInput(input);
    switch (input.decision.kind) {
      case "produce":
        return this.closeProduced(input, input.decision);
      case "skip":
        return this.closeSkipped(input, input.decision.reasonCode);
      case "fail":
        return this.closeFailed(input, input.decision.failureCode, input.decision.field);
    }
  }

  private async closeProduced(
    input: DomainTerminalCloseInput,
    decision: Extract<DomainMappingDecision, { kind: "produce" }>,
  ): Promise<DomainTerminalClosure> {
    assertProduceMatchesDescriptor(input.descriptor, input.source, decision);
    const targetRow = buildExactTargetRow(decision.envelope, decision.targetFields);
    const existingTargetHashes = await this.existingTargetHashes(
      decision.targetTable,
      decision.envelope,
    );
    const expectedHash = decision.envelope.payloadSha256;
    if (existingTargetHashes.some((hash) => hash !== expectedHash)) {
      await this.writeDeadLetter(input, DOMAIN_TARGET_CONFLICT_CODE, "target");
      return closure("blocked", false, false, false, true, DOMAIN_TARGET_CONFLICT_CODE);
    }

    let targetWritten = false;
    if (existingTargetHashes.length === 0) {
      try {
        await this.clickHouse.insert(decision.targetTable, [targetRow]);
      } catch {
        throw targetWriterError("TARGET_WRITE_TRANSIENT");
      }
      targetWritten = true;
    }

    const lineage = buildLineageRow(input, {
      decision: "produced",
      reasonCode: "",
      targetRecordId: decision.envelope.canonicalRecordId,
      targetPayloadHash: expectedHash,
    });
    const lineageState = await this.ensureLineage(lineage);
    if (lineageState === "conflict") {
      await this.writeDeadLetter(input, DOMAIN_LINEAGE_CONFLICT_CODE, "lineage");
      return closure("blocked", false, targetWritten, false, true, DOMAIN_LINEAGE_CONFLICT_CODE);
    }
    return closure(
      targetWritten ? "produced" : "duplicate",
      true,
      targetWritten,
      lineageState === "written",
      false,
      targetWritten ? "TARGET_PRODUCED" : "TARGET_DUPLICATE_SAME_HASH",
    );
  }

  private async closeSkipped(
    input: DomainTerminalCloseInput,
    reasonCode: string,
  ): Promise<DomainTerminalClosure> {
    const lineage = buildLineageRow(input, {
      decision: "skipped",
      reasonCode,
      targetRecordId: "",
      targetPayloadHash: "",
    });
    const lineageState = await this.ensureLineage(lineage);
    if (lineageState === "conflict") {
      await this.writeDeadLetter(input, DOMAIN_LINEAGE_CONFLICT_CODE, "lineage");
      return closure("blocked", false, false, false, true, DOMAIN_LINEAGE_CONFLICT_CODE);
    }
    return closure("skipped", true, false, lineageState === "written", false, reasonCode);
  }

  private async closeFailed(
    input: DomainTerminalCloseInput,
    failureCode: string,
    field: string,
  ): Promise<DomainTerminalClosure> {
    await this.writeDeadLetter(input, failureCode, "mapping", field);
    return closure("failed", true, false, false, true, failureCode);
  }

  private async existingTargetHashes(
    table: string,
    envelope: DomainCommonTargetEnvelope,
  ): Promise<readonly DomainSourceSha256[]> {
    assertExactTargetTable(table);
    const sql = `SELECT payload_sha256
FROM ${table}
WHERE tenant_id = ${stringExpression(envelope.tenantId)}
  AND project_id = ${stringExpression(envelope.projectId)}
  AND projection_id = ${stringExpression(envelope.projectionId)}
  AND projection_version = ${stringExpression(String(envelope.projectionVersion))}
  AND canonical_record_id = toUUID('${envelope.canonicalRecordId}')
LIMIT 16
FORMAT JSON`;
    const rows = parseRows(await this.clickHouse.query(sql, { readonly: 2, maxResultRows: 16 }));
    return Object.freeze(
      rows.map((row) => normalizeHash(requiredString(row, "payload_sha256"))),
    );
  }

  private async ensureLineage(
    row: Record<string, unknown>,
  ): Promise<"written" | "duplicate" | "conflict"> {
    const lineageId = requiredUuid(row, "lineage_id");
    const rows = parseRows(
      await this.clickHouse.query(
        `SELECT source_payload_hash, target_payload_hash, decision, reason_code
FROM ${LINEAGE_TABLE}
WHERE lineage_id = toUUID('${lineageId}')
LIMIT 16
FORMAT JSON`,
        { readonly: 2, maxResultRows: 16 },
      ),
    );
    if (rows.length > 0) {
      const expected = lineageComparable(row);
      const allMatch = rows.every((candidate) => lineageComparable(candidate) === expected);
      return allMatch ? "duplicate" : "conflict";
    }
    try {
      await this.clickHouse.insert(LINEAGE_TABLE, [row]);
    } catch {
      throw targetWriterError("LINEAGE_WRITE_TRANSIENT");
    }
    return "written";
  }

  private async writeDeadLetter(
    input: DomainTerminalCloseInput,
    reasonCode: string,
    stage: "mapping" | "target" | "lineage",
    field = "",
  ): Promise<void> {
    const row = buildDeadLetterRow(input, reasonCode, stage, field);
    try {
      await this.clickHouse.insert(DEAD_LETTER_TABLE, [row]);
    } catch {
      throw targetWriterError("DEAD_LETTER_WRITE_TRANSIENT");
    }
  }
}

export class DomainProjectionTerminalCloser {
  constructor(
    private readonly writer: ClickHouseDomainTargetWriter,
    private readonly checkpoint: DomainCheckpointCommitter,
  ) {}

  async close(input: DomainTerminalCloseInput): Promise<DomainTerminalClosure> {
    const result = await this.writer.close(input);
    if (result.checkpointEligible) {
      await this.checkpoint.commit({ source: input.source, closure: result });
    }
    return result;
  }
}

export class ClickHouseDomainCheckpointCommitter implements DomainCheckpointCommitter {
  constructor(
    private readonly clickHouse: DomainTargetClickHouseClient,
    private readonly scope: Readonly<{
      descriptor: DomainProjectionDescriptor;
      mappingHash: DomainSourceSha256;
      projectionRunId: string;
      sourceCursor: string;
      projectedAt: string;
      lookbackMs: number;
    }>,
  ) {
    rawHash(scope.mappingHash);
    requiredUuid({ value: scope.projectionRunId }, "value");
    if (!Number.isSafeInteger(scope.lookbackMs) || scope.lookbackMs < 0) {
      throw targetWriterError("DOMAIN_CHECKPOINT_SCOPE_INVALID");
    }
  }

  async commit(
    input: Readonly<{source: DomainSourceRecord; closure: DomainTerminalClosure}>,
  ): Promise<void> {
    if (!input.closure.checkpointEligible) throw targetWriterError("CHECKPOINT_TERMINAL_REQUIRED");
    const {descriptor} = this.scope;
    if (input.source.sourceContractId !== descriptor.sourceContractId) {
      throw targetWriterError("SOURCE_CONTRACT_INVALID");
    }
    const sourcePartition = [
      input.source.tenantId,
      input.source.projectId,
      input.source.episodeId,
      descriptor.definition.projectionId,
    ].join("\u001f");
    const recordId = uuidV5(
      DOMAIN_CANONICAL_ID_NAMESPACE,
      ["sdar-domain-checkpoint-v1", sourcePartition].join("\u001f"),
    );
    const checkpointToken = hashCanonicalDomainProjectionJson({
      projectionId: descriptor.definition.projectionId,
      projectionVersion: descriptor.definition.projectionVersion,
      mappingHash: this.scope.mappingHash,
      sourceRecordId: input.source.recordId,
      sourceRevision: input.source.sourceRevision,
      sourceSequence: input.source.sequence,
      sourcePayloadHash: input.source.payloadHash,
      sourceCursor: this.scope.sourceCursor,
      outcome: input.closure.outcome === "duplicate" ? "produced" : input.closure.outcome,
    });
    const existing = parseRows(await this.clickHouse.query(
      `SELECT last_source_sequence,last_source_record_id,last_source_payload_hash,checkpoint_token
FROM sdar_meta.projection_checkpoint FINAL
WHERE tenant_id=${stringExpression(input.source.tenantId)}
  AND project_id=${stringExpression(input.source.projectId)}
  AND projection_id=${stringExpression(descriptor.definition.projectionId)}
  AND projection_version=${stringExpression(String(descriptor.definition.projectionVersion))}
  AND consumer_group='sdar-domain-projection-v1'
  AND source_stream='sdar.domain-source/v1'
  AND source_partition=${stringExpression(sourcePartition)}
LIMIT 1 FORMAT JSON`,
      {readonly: 2, maxResultRows: 1},
    ));
    const current = existing[0];
    if (current !== undefined) {
      const currentSequence = BigInt(requiredUInt64String(current, "last_source_sequence"));
      const candidateSequence = BigInt(input.source.sequence);
      if (currentSequence > candidateSequence) return;
      if (currentSequence === candidateSequence) {
        if (
          requiredString(current, "last_source_record_id") === input.source.recordId &&
          normalizeHash(requiredString(current, "last_source_payload_hash")) === input.source.payloadHash &&
          normalizeHash(requiredString(current, "checkpoint_token")) === checkpointToken
        ) return;
        throw targetWriterError("CHECKPOINT_CONTENT_CONFLICT");
      }
    }
    const outcomeCounts = {
      produced_count: input.closure.outcome === "produced" || input.closure.outcome === "duplicate" ? 1 : 0,
      skipped_count: input.closure.outcome === "skipped" ? 1 : 0,
      failed_count: input.closure.outcome === "failed" ? 1 : 0,
    };
    await this.clickHouse.insert("sdar_meta.projection_checkpoint", [{
      tenant_id: input.source.tenantId,
      project_id: input.source.projectId,
      record_id: recordId,
      projection_id: descriptor.definition.projectionId,
      projection_version: String(descriptor.definition.projectionVersion),
      consumer_group: "sdar-domain-projection-v1",
      source_stream: "sdar.domain-source/v1",
      source_partition: sourcePartition,
      source_offset: input.source.sequence,
      source_watermark: input.source.occurredAt,
      last_source_record_id: input.source.recordId,
      last_source_payload_hash: input.source.payloadHash,
      checkpoint_token: checkpointToken,
      projection_run_id: this.scope.projectionRunId,
      processed_count: 1,
      status: "active",
      committed_at: this.scope.projectedAt,
      updated_at: this.scope.projectedAt,
      sequence: input.source.sequence,
      source_database: descriptor.definition.source.database,
      source_table: descriptor.definition.source.table,
      last_source_revision: input.source.sourceRevision,
      last_source_sequence: input.source.sequence,
      checkpoint_version: 1,
      ...outcomeCounts,
      lookback_ms: this.scope.lookbackMs,
      source_cursor_json: this.scope.sourceCursor,
      episode_key: input.source.episodeId,
    }], {deduplicationToken: rawHash(checkpointToken)});
  }
}

export function buildExactTargetRow(
  envelope: DomainCommonTargetEnvelope,
  targetFields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const table = `${TARGET_DATABASE}.${targetTableForProjection(envelope.projectionId)}`;
  assertTargetFieldSet(table, targetFields);
  return {
    tenant_id: envelope.tenantId,
    project_id: envelope.projectId,
    environment: envelope.environment,
    source_deployment_id: envelope.sourceDeploymentId,
    source_environment_raw: envelope.sourceEnvironmentRaw,
    environment_mapping_id: envelope.environmentMappingId,
    environment_map_version: envelope.environmentMapVersion,
    record_id: envelope.recordId,
    canonical_record_id: envelope.canonicalRecordId,
    episode_key: envelope.episodeKey,
    canonical_episode_id: envelope.canonicalEpisodeId,
    agent_id: envelope.agentId,
    agent_type: envelope.agentType,
    agent_version: envelope.agentVersion ?? "",
    scenario_id: envelope.scenarioId ?? "",
    correlation_id: envelope.correlationId ?? "",
    episode_sequence: envelope.episodeSequence,
    run_id: envelope.runId,
    segment_id: envelope.segmentId,
    run_sequence: envelope.runSequence,
    evidence_sequence: envelope.evidenceSequence,
    source_database: envelope.sourceDatabase,
    source_table: envelope.sourceTable,
    source_record_id: envelope.sourceRecordId,
    source_schema_name: envelope.sourceSchemaName,
    source_schema_version: String(envelope.sourceSchemaVersion),
    source_collection_profile: envelope.sourceCollectionProfile,
    source_evidence_level: envelope.sourceEvidenceLevel,
    mapping_rule_id: envelope.mappingRuleId,
    mapping_rule_version: envelope.mappingRuleVersion,
    source_payload_hash: rawHash(envelope.sourcePayloadHash),
    root_source_database: envelope.rootSourceDatabase,
    root_source_table: envelope.rootSourceTable,
    root_source_record_id: envelope.rootSourceRecordId,
    root_source_schema_name: envelope.rootSourceSchemaName,
    root_source_schema_version: String(envelope.rootSourceSchemaVersion),
    root_source_payload_hash: rawHash(envelope.rootSourcePayloadHash),
    projection_id: envelope.projectionId,
    projection_version: String(envelope.projectionVersion),
    projection_revision: envelope.projectionRevision,
    supersedes_record_id: envelope.supersedesRecordId,
    payload_json: envelope.payloadJson,
    payload_sha256: rawHash(envelope.payloadSha256),
    occurred_at: envelope.occurredAt,
    ...targetFields,
  };
}

function buildLineageRow(
  input: DomainTerminalCloseInput,
  terminal: Readonly<{
    decision: "produced" | "skipped";
    reasonCode: string;
    targetRecordId: string;
    targetPayloadHash: string;
  }>,
): Record<string, unknown> {
  const { descriptor, source } = input;
  const lineageId = stableOperationalId("lineage", input, terminal.decision);
  return {
    record_id: lineageId,
    tenant_id: source.tenantId,
    project_id: source.projectId,
    lineage_id: lineageId,
    projection_run_id: input.projectionRunId,
    projection_id: descriptor.definition.projectionId,
    projection_version: String(descriptor.definition.projectionVersion),
    contract_version: DOMAIN_PROJECTION_CONTRACT_VERSION,
    mapping_hash: rawHash(input.mappingHash),
    id_namespace_version: DOMAIN_CANONICAL_ID_NAMESPACE_VERSION,
    environment_map_version: DOMAIN_ENVIRONMENT_MAP_VERSION,
    mapping_rule_id: descriptor.definition.mapperId,
    mapping_rule_version: descriptor.definition.mapperVersion,
    source_system: "sdar-domain-source",
    source_agent_type: descriptor.definition.source.database === "sdar_commander" ? "commander" : "npc",
    source_database: descriptor.definition.source.database,
    source_table: descriptor.definition.source.table,
    source_record_id: source.recordId,
    source_position: source.sequence,
    source_payload_hash: source.payloadHash,
    target_database: TARGET_DATABASE,
    target_table: descriptor.definition.target.table,
    target_record_id: terminal.targetRecordId,
    target_payload_hash: terminal.targetPayloadHash,
    relationship: terminal.decision === "produced" ? "derived_from" : "not_applicable",
    projected_at: input.projectedAt,
    status: "active",
    mapper_id: descriptor.definition.mapperId,
    mapper_version: descriptor.definition.mapperVersion,
    source_revision: source.sourceRevision,
    decision: terminal.decision,
    reason_code: terminal.reasonCode,
    source_content_hash: source.payloadHash,
    target_content_hash: terminal.targetPayloadHash,
    episode_key: source.episodeId,
    source_cursor: input.sourceCursor,
  };
}

function buildDeadLetterRow(
  input: DomainTerminalCloseInput,
  reasonCode: string,
  stage: "mapping" | "target" | "lineage",
  field: string,
): Record<string, unknown> {
  const { descriptor, source } = input;
  const deadLetterId = stableOperationalId("dead-letter", input, reasonCode);
  const failureClass =
    reasonCode === DOMAIN_TARGET_CONFLICT_CODE
      ? "content_conflict"
      : reasonCode === DOMAIN_LINEAGE_CONFLICT_CODE
        ? "implementation_error"
        : reasonCode.startsWith("SOURCE_")
          ? "data_contract"
          : "mapping_error";
  return {
    record_id: deadLetterId,
    tenant_id: source.tenantId,
    project_id: source.projectId,
    dead_letter_id: deadLetterId,
    projection_run_id: input.projectionRunId,
    projection_id: descriptor.definition.projectionId,
    projection_version: String(descriptor.definition.projectionVersion),
    source_system: "sdar-domain-source",
    source_agent_type: descriptor.definition.source.database === "sdar_commander" ? "commander" : "npc",
    source_database: descriptor.definition.source.database,
    source_table: descriptor.definition.source.table,
    source_record_id: source.recordId,
    source_position: source.sequence,
    target_database: TARGET_DATABASE,
    target_table: descriptor.definition.target.table,
    error_stage: stage,
    error_code: reasonCode,
    error_message: field === "" ? reasonCode : `${reasonCode}:${field}`,
    severity: "error",
    blocking: 1,
    retryable: 0,
    retry_count: 0,
    resolution_status: "open",
    payload_hash: source.payloadHash,
    payload_json: canonicalizeDomainProjectionJson({ field, reasonCode }),
    failed_at: input.projectedAt,
    source_revision: source.sourceRevision,
    failure_class: failureClass,
    first_failed_at: input.projectedAt,
    last_failed_at: input.projectedAt,
    source_content_hash: source.payloadHash,
    episode_key: source.episodeId,
    source_cursor: input.sourceCursor,
  };
}

const targetFieldSets = Object.freeze({
  "sdar_embodied.control_action": Object.freeze([
    "action_id", "device_id", "action_type", "action_name", "capability", "resource_channel",
    "target_id", "target_json", "risk_level", "idempotency_key", "input_hash", "side_effect",
    "execution_status", "controller_ref", "basis_id", "input_summary",
  ]),
  "sdar_embodied.control_receipt": Object.freeze([
    "receipt_id", "action_id", "provider_id", "provider_request_id", "transport_status",
    "acceptance_status", "execution_status", "received_at", "output_summary", "error_code",
    "raw_response_ref", "observed_state_ref", "error_json", "metrics_json",
  ]),
  "sdar_embodied.human_confirmation": Object.freeze([
    "confirmation_id", "action_id", "subject_type", "subject_id", "confirmation_status",
    "requested_at", "decided_at", "decided_by", "valid_from", "valid_until",
    "invalidation_conditions", "evidence_refs",
  ]),
  "sdar_embodied.physical_verification": Object.freeze([
    "physical_verification_id", "verification_id", "criterion_id", "action_id", "device_id",
    "capability", "verification_channel", "expected_json", "actual_json", "comparator",
    "verification_result", "critical", "stable_duration_ms", "device_timestamp", "verified_at",
    "confirmation_latency_ms", "source_state_id", "evidence_refs",
  ]),
  "sdar_embodied.preemption_recovery": Object.freeze([
    "preemption_id", "phase", "device_id", "trigger_type", "trigger_event_id",
    "preempted_basis_id", "preempted_basis_version", "preempted_action_id", "selected_basis_id",
    "selected_basis_version", "selected_intent", "required_deadline_ms", "actual_latency_ms",
    "stop_confirmed", "recovery_strategy", "recovery_result", "resumed_basis_id",
    "resumed_basis_version",
  ]),
  "sdar_embodied.state_freshness_check": Object.freeze([
    "check_id", "state_field", "source_component", "observed_at", "checked_at", "age_ms",
    "max_allowed_age_ms", "check_result", "conflict_detected", "missing",
  ]),
} satisfies Readonly<Record<string, readonly string[]>>);

function assertTargetFieldSet(table: string, fields: Readonly<Record<string, unknown>>): void {
  assertExactTargetTable(table);
  const expected = targetFieldSets[table as keyof typeof targetFieldSets];
  const actual = Object.keys(fields).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== [...expected].sort()[index])) {
    throw targetWriterError("TARGET_SCHEMA_INVALID");
  }
}

function assertExactTargetTable(table: string): void {
  if (!(table in targetFieldSets)) throw targetWriterError("TARGET_TABLE_FORBIDDEN");
}

function targetTableForProjection(projectionId: string): string {
  const descriptorTable = Object.entries({
    "application_to_embodied.dp-c01": "control_action",
    "application_to_embodied.dp-c02": "control_receipt",
    "application_to_embodied.dp-c03": "physical_verification",
    "application_to_embodied.dp-c04": "preemption_recovery",
    "application_to_embodied.dp-c05": "state_freshness_check",
    "application_to_embodied.dp-n01": "control_action",
    "application_to_embodied.dp-n02": "control_receipt",
    "application_to_embodied.dp-n03": "human_confirmation",
    "application_to_embodied.dp-n04": "preemption_recovery",
    "application_to_embodied.dp-n05": "state_freshness_check",
  } as const).find(([id]) => id === projectionId)?.[1];
  if (descriptorTable === undefined) throw targetWriterError("TARGET_TABLE_FORBIDDEN");
  return descriptorTable;
}

function assertCloseInput(input: DomainTerminalCloseInput): void {
  if (input.source.sourceContractId !== input.descriptor.sourceContractId) {
    throw targetWriterError("SOURCE_CONTRACT_INVALID");
  }
  requiredUuid({ value: input.projectionRunId }, "value");
  rawHash(input.mappingHash);
  if (input.sourceCursor === "" || Buffer.byteLength(input.sourceCursor, "utf8") > 4_096) {
    throw targetWriterError("DOMAIN_SOURCE_CURSOR_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.projectedAt)) || !input.projectedAt.endsWith("Z")) {
    throw targetWriterError("PROJECTION_TIMESTAMP_INVALID");
  }
}

function assertProduceMatchesDescriptor(
  descriptor: DomainProjectionDescriptor,
  source: DomainSourceRecord,
  decision: Extract<DomainMappingDecision, { kind: "produce" }>,
): void {
  if (
    decision.mappingId !== descriptor.mappingId ||
    decision.targetTable !== descriptor.targetQualifiedTable ||
    decision.envelope.projectionId !== descriptor.definition.projectionId ||
    decision.envelope.sourceRecordId !== source.recordId ||
    decision.envelope.sourcePayloadHash !== source.payloadHash ||
    decision.envelope.payloadSha256 !== hashCanonicalDomainProjectionJson(decision.targetFields) ||
    decision.envelope.payloadJson !== canonicalizeDomainProjectionJson(decision.targetFields)
  ) {
    throw targetWriterError("MAPPER_DETERMINISM_VIOLATION");
  }
}

function stableOperationalId(
  kind: "lineage" | "dead-letter",
  input: DomainTerminalCloseInput,
  discriminator: string,
): string {
  return uuidV5(
    DOMAIN_CANONICAL_ID_NAMESPACE,
    [
      `sdar-domain-${kind}-v1`,
      input.source.tenantId,
      input.source.projectId,
      input.descriptor.definition.projectionId,
      String(input.descriptor.definition.projectionVersion),
      input.source.recordId,
      input.source.sourceRevision,
      discriminator,
    ].join("\u001f"),
  );
}

function lineageComparable(value: Record<string, unknown>): string {
  return canonicalizeDomainProjectionJson({
    sourcePayloadHash: requiredString(value, "source_payload_hash"),
    targetPayloadHash: requiredStringAllowEmpty(value, "target_payload_hash"),
    decision: requiredString(value, "decision"),
    reasonCode: requiredStringAllowEmpty(value, "reason_code"),
  });
}

function closure(
  outcome: DomainTerminalOutcome,
  checkpointEligible: boolean,
  targetWritten: boolean,
  lineageWritten: boolean,
  deadLetterWritten: boolean,
  reasonCode: string,
): DomainTerminalClosure {
  return Object.freeze({
    outcome,
    checkpointEligible,
    targetWritten,
    lineageWritten,
    deadLetterWritten,
    reasonCode,
  });
}

function rawHash(value: string): string {
  if (!SHA256.test(value)) throw targetWriterError("DOMAIN_HASH_INVALID");
  return value.slice("sha256:".length);
}

function normalizeHash(value: string): DomainSourceSha256 {
  const normalized = value.startsWith("sha256:") ? value : `sha256:${value}`;
  if (!SHA256.test(normalized)) throw targetWriterError("TARGET_SCHEMA_INVALID");
  return normalized as DomainSourceSha256;
}

function requiredUuid(value: Record<string, unknown>, field: string): string {
  const candidate = requiredString(value, field);
  if (!UUID.test(candidate)) throw targetWriterError("DOMAIN_UUID_INVALID");
  return candidate;
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate === "") throw targetWriterError("TARGET_SCHEMA_INVALID");
  return candidate;
}

function requiredUInt64String(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  const normalized = typeof candidate === "number" ? String(candidate) : candidate;
  if (typeof normalized !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    throw targetWriterError("TARGET_SCHEMA_INVALID");
  }
  return normalized;
}

function requiredStringAllowEmpty(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") throw targetWriterError("TARGET_SCHEMA_INVALID");
  return candidate;
}

function parseRows(value: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw targetWriterError("TARGET_RESPONSE_INVALID");
  }
  if (
    typeof parsed !== "object" || parsed === null || !("data" in parsed) ||
    !Array.isArray((parsed as { data: unknown }).data) ||
    !(parsed as { data: unknown[] }).data.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))
  ) {
    throw targetWriterError("TARGET_RESPONSE_INVALID");
  }
  return (parsed as { data: Record<string, unknown>[] }).data;
}

function stringExpression(value: string): string {
  return `reinterpretAsString(unhex('${Buffer.from(value, "utf8").toString("hex")}'))`;
}

function targetWriterError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
