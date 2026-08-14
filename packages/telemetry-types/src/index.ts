export type SourceType =
  | "sdar-v1.3-outbox"
  | "sdar-v1.4-node-control"
  | "smpp-providerops-1.1.0"
  | "sdar-evidence-v1";

/** Legacy telemetry input retained for compatibility-only adapters. */
export interface EvidenceRecord {
  sourceRecordId: string;
  recordFamily: string;
  occurredAt: string;
  tenantId: string;
  payload: unknown;
  recordHash?: string;
  traceId?: string;
  correlationId?: string;
  sequence?: number;
}

/** Legacy telemetry input retained for compatibility-only adapters. */
export interface EvidenceBatch {
  schemaVersion: "1.0";
  sourceId: string;
  sourceType: SourceType;
  batchId: string;
  records: EvidenceRecord[];
}

/** Legacy acknowledgement retained for compatibility-only adapters. */
export interface DurableAck {
  status: "accepted" | "duplicate" | "retryable" | "rejected" | "conflict";
  batchId: string;
  walPartition?: string;
  firstOffset?: number;
  lastOffset?: number;
  durableAt?: string;
  errorCode?: string;
  message?: string;
}

export type EvidenceV1JsonScalar = string | number | boolean | null;
export type EvidenceV1JsonValue =
  | EvidenceV1JsonScalar
  | readonly EvidenceV1JsonValue[]
  | Readonly<{ [key: string]: EvidenceV1JsonValue }>;

export type EvidenceV1RecordFamily =
  | "runtime"
  | "skill"
  | "mcp_task"
  | "capability"
  | "experience"
  | "replay"
  | "artifact"
  | "node_control"
  | "evidence";

export type EvidenceV1SourceSystem = "runtime" | "node_control";
export type EvidenceV1DeliveryGuarantee = "transactional" | "durable_projection" | "buffered";
export type EvidenceV1EvaluationRole = "required" | "supporting" | "diagnostic";

/** The lossless sdar.evidence/v1 canonical record carried on the wire. */
export interface EvidenceV1Record {
  readonly contractVersion: "sdar.evidence/v1";
  readonly schemaName: string;
  readonly schemaVersion: 1;
  readonly recordFamily: EvidenceV1RecordFamily;
  readonly recordType: string;
  readonly recordId: `evidence_${string}`;
  readonly sourceSystem: EvidenceV1SourceSystem;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: string;
  readonly tenantId?: string;
  readonly userScopeId?: string;
  readonly projectId?: string;
  readonly environment: string;
  readonly taskId?: string;
  readonly contextId?: string;
  readonly episodeId?: string;
  readonly runId?: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly skillExecutionId?: string;
  readonly capabilityBindingId?: string;
  readonly remoteTaskBindingId?: string;
  readonly nodeId?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly deliveryGuarantee: EvidenceV1DeliveryGuarantee;
  readonly evaluationRole: EvidenceV1EvaluationRole;
  readonly observationGeneration?: 0 | 1;
  readonly evidenceSequence: string;
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly payloadHash: `sha256:${string}`;
  readonly payload: EvidenceV1JsonValue;
}

export interface EvidenceV1BatchRequest {
  readonly contractVersion: "sdar.evidence/v1";
  readonly exportId: string;
  readonly sourceId: string;
  readonly nodeId: string;
  readonly revision: number;
  readonly firstSequence: string;
  readonly lastSequence: string;
  readonly batchHash: `sha256:${string}`;
  readonly records: readonly EvidenceV1Record[];
}

export interface EvidenceV1BatchAcknowledgement {
  readonly lastAcknowledgedSequence: string;
}

/** Exact validated batch plus receiver time persisted as the v1 WAL payload. */
export interface EvidenceV1WalPayload {
  readonly kind: "sdar-evidence-v1";
  readonly receivedAt: string;
  readonly batch: EvidenceV1BatchRequest;
}

export interface EvidenceV1WalContext {
  readonly receivedAt?: string;
  readonly walPartition?: string;
  readonly walOffset?: number;
  readonly walWrittenAt?: string;
  readonly walPayloadHash?: string;
}

export interface CanonicalFact {
  factId: string;
  sourceId: string;
  sourceType: SourceType;
  sourceRecordId: string;
  recordFamily: string;
  tenantId?: string;
  occurredAt: string;
  ingestedAt: string;
  payload: unknown;
  payloadHash: string;
  traceId?: string;
  correlationId?: string;
  projectionVersion: string;

  // Lossless sdar.evidence/v1 lineage. Legacy facts may omit these fields.
  contractVersion?: "sdar.evidence/v1";
  exportId?: string;
  nodeId?: string;
  exportRevision?: number;
  batchHash?: `sha256:${string}`;
  batchNodeId?: string;
  firstSequence?: string;
  lastSequence?: string;
  evidenceSequence?: string;
  recordId?: `evidence_${string}`;
  recordType?: string;
  schemaName?: string;
  schemaVersion?: number;
  sourceSystem?: EvidenceV1SourceSystem;
  sourceTable?: string;
  sourceRevision?: string;
  userScopeId?: string;
  projectId?: string;
  environment?: string;
  taskId?: string;
  contextId?: string;
  episodeId?: string;
  runId?: string;
  goalId?: string;
  goalVersion?: number;
  planId?: string;
  planVersion?: number;
  skillExecutionId?: string;
  capabilityBindingId?: string;
  remoteTaskBindingId?: string;
  causationId?: string;
  recordedAt?: string;
  deliveryGuarantee?: EvidenceV1DeliveryGuarantee;
  evaluationRole?: EvidenceV1EvaluationRole;
  observationGeneration?: 0 | 1;
  evidenceRefs?: readonly string[];
  artifactRefs?: readonly string[];
  evidenceRecord?: EvidenceV1Record;
  walPartition?: string;
  walOffset?: number;
  walWrittenAt?: string;
  walPayloadHash?: string;
  receivedAt?: string;
}

export interface QueryEnvelope<T> {
  data: T;
  asOf: string;
  watermark: string | null;
  freshness: { status: "fresh" | "stale" | "degraded"; lagSeconds: number | null };
  sourceCoverage: { expected: string[]; observed: string[] };
}

export const V13_FAMILIES = [
  "sdar.runtime.goal",
  "sdar.runtime.plan",
  "sdar.runtime.task",
  "sdar.runtime.workflow",
  "sdar.runtime.skill_attempt",
  "sdar.runtime.skill_execution",
  "sdar.runtime.outcome",
  "sdar.runtime.recovery",
  "sdar.runtime.completed_effect",
  "sdar.runtime.mcp_tool_call",
  "sdar.runtime.remote_task",
  "sdar.runtime.artifact",
  "sdar.runtime.a2a_projection",
  "sdar.runtime.capability_summary",
  "sdar.runtime.public_capability_card",
  "sdar.runtime.audit",
] as const;

export const V14_FAMILIES = [
  "sdar.node_control.configuration_revision",
  "sdar.node_capability.version",
  "sdar.node_capability.implementation_binding",
  "sdar.node_capability.readiness",
  "sdar.a2a.exposure_revision",
  "sdar.a2a.agent_card_revision",
  "sdar.task.capability_binding",
  "sdar.task.capability_attempt",
] as const;
