import type {
  CanonicalFact,
  EvidenceBatch,
  EvidenceV1BatchRequest,
  EvidenceV1Record,
  EvidenceV1WalContext,
  EvidenceV1WalPayload,
} from "../../telemetry-types/src/index.js";
import { sha256 } from "../../telemetry-validation/src/index.js";

export function normalizeBatch(
  batch: EvidenceV1BatchRequest,
  context?: EvidenceV1WalContext,
): CanonicalFact[];
export function normalizeBatch(
  payload: EvidenceV1WalPayload,
  context?: EvidenceV1WalContext,
): CanonicalFact[];
export function normalizeBatch(batch: EvidenceBatch, context?: EvidenceV1WalContext): CanonicalFact[];
export function normalizeBatch(
  input: EvidenceBatch | EvidenceV1BatchRequest | EvidenceV1WalPayload,
  context: EvidenceV1WalContext = {},
): CanonicalFact[] {
  if (isEvidenceV1WalPayload(input)) {
    return normalizeEvidenceV1(input.batch, { receivedAt: input.receivedAt, ...context });
  }
  if (isEvidenceV1Batch(input)) return normalizeEvidenceV1(input, context);
  return normalizeLegacy(input, context);
}

function normalizeEvidenceV1(
  batch: EvidenceV1BatchRequest,
  context: EvidenceV1WalContext,
): CanonicalFact[] {
  const receivedAt = context.receivedAt ?? context.walWrittenAt ?? new Date().toISOString();
  return batch.records.map((record) => evidenceV1Fact(batch, record, receivedAt, context));
}

function evidenceV1Fact(
  batch: EvidenceV1BatchRequest,
  record: EvidenceV1Record,
  receivedAt: string,
  context: EvidenceV1WalContext,
): CanonicalFact {
  return {
    factId: record.recordId,
    sourceId: batch.sourceId,
    sourceType: "sdar-evidence-v1",
    sourceRecordId: record.sourceRecordId,
    recordFamily: record.recordFamily,
    tenantId: record.tenantId,
    occurredAt: record.occurredAt,
    ingestedAt: receivedAt,
    payload: record.payload,
    payloadHash: record.payloadHash,
    correlationId: record.correlationId,
    projectionVersion: "1.0.0",
    contractVersion: batch.contractVersion,
    exportId: batch.exportId,
    nodeId: batch.nodeId,
    batchNodeId: batch.nodeId,
    exportRevision: batch.revision,
    batchHash: batch.batchHash,
    firstSequence: batch.firstSequence,
    lastSequence: batch.lastSequence,
    evidenceSequence: record.evidenceSequence,
    recordId: record.recordId,
    recordType: record.recordType,
    schemaName: record.schemaName,
    schemaVersion: record.schemaVersion,
    sourceSystem: record.sourceSystem,
    sourceTable: record.sourceTable,
    sourceRevision: record.sourceRevision,
    userScopeId: record.userScopeId,
    projectId: record.projectId,
    environment: record.environment,
    taskId: record.taskId,
    contextId: record.contextId,
    episodeId: record.episodeId,
    runId: record.runId,
    goalId: record.goalId,
    goalVersion: record.goalVersion,
    planId: record.planId,
    planVersion: record.planVersion,
    skillExecutionId: record.skillExecutionId,
    capabilityBindingId: record.capabilityBindingId,
    remoteTaskBindingId: record.remoteTaskBindingId,
    causationId: record.causationId,
    recordedAt: record.recordedAt,
    deliveryGuarantee: record.deliveryGuarantee,
    evaluationRole: record.evaluationRole,
    observationGeneration: record.observationGeneration,
    evidenceRefs: record.evidenceRefs,
    artifactRefs: record.artifactRefs,
    evidenceRecord: record,
    walPartition: context.walPartition,
    walOffset: context.walOffset,
    walWrittenAt: context.walWrittenAt,
    walPayloadHash: context.walPayloadHash,
    receivedAt,
  };
}

function normalizeLegacy(batch: EvidenceBatch, context: EvidenceV1WalContext): CanonicalFact[] {
  const ingestedAt = context.receivedAt ?? context.walWrittenAt ?? new Date().toISOString();
  return batch.records.map((record) => {
    const payloadHash = record.recordHash ?? sha256(record.payload);
    return {
      factId: `legacy_${sha256({
        sourceId: batch.sourceId,
        sourceRecordId: record.sourceRecordId,
        recordFamily: record.recordFamily,
        payloadHash,
      })}`,
      sourceId: batch.sourceId,
      sourceType: batch.sourceType,
      sourceRecordId: record.sourceRecordId,
      recordFamily: record.recordFamily,
      tenantId: record.tenantId,
      occurredAt: record.occurredAt,
      ingestedAt,
      payload: record.payload,
      payloadHash,
      traceId: record.traceId,
      correlationId: record.correlationId,
      projectionVersion: "1.0.0",
      walPartition: context.walPartition,
      walOffset: context.walOffset,
      walWrittenAt: context.walWrittenAt,
      walPayloadHash: context.walPayloadHash,
      receivedAt: ingestedAt,
    };
  });
}

function isEvidenceV1Batch(value: unknown): value is EvidenceV1BatchRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "contractVersion" in value &&
    value.contractVersion === "sdar.evidence/v1" &&
    "records" in value &&
    Array.isArray(value.records)
  );
}

function isEvidenceV1WalPayload(value: unknown): value is EvidenceV1WalPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "sdar-evidence-v1" &&
    "batch" in value &&
    isEvidenceV1Batch(value.batch)
  );
}
