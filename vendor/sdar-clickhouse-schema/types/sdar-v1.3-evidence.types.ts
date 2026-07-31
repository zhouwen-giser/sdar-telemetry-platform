/** SDAR Runtime v1.3 / Schema document V1.2 / sdar.evidence/v1. */
export type DeliveryGuarantee = 'transactional' | 'buffered';
export type EvaluationRole = 'required' | 'supporting' | 'diagnostic';
export type SkillExecutionMode = 'guidance' | 'template' | 'procedure';
export type SkillFailurePolicy = 'fail_fast' | 'recoverable' | 'optional' | 'degraded';
export type SkillExecutionStatus = 'selected' | 'planning' | 'executing' | 'waiting_external' | 'completed' | 'failed' | 'cancelled' | 'degraded';

export interface EvidenceReference {
  evidenceId: string;
  evidenceType: string;
  sourceSystem: 'sdar' | 'mcp_provider' | 'upstream_agent' | 'human' | 'artifact_store' | 'other';
  sourceRecordId?: string;
  uri?: string;
  checksum?: string;
  producedAt?: string;
  producerRefs?: string[];
}

export interface ArtifactReference {
  artifactId: string;
  uri: string;
  sha256: string;
  mediaType: string;
  sizeBytes: string;
  storageProvider: 'filesystem' | 'minio' | 's3';
  contentRole: string;
  createdAt: string;
  encoding?: string;
  preview?: string;
}

export interface CanonicalEvidenceEnvelope<TPayload extends object = Record<string, unknown>> {
  evidenceFamily: 'sdar.evidence/v1';
  recordId: string;
  recordType: string;
  schemaName: string;
  schemaVersion: number;
  eventType: string;
  eventCategory: string;
  deliveryGuarantee: DeliveryGuarantee;
  evaluationRole: EvaluationRole;
  tenantId: string;
  projectId: string;
  environment: 'dev' | 'test' | 'staging' | 'prod';
  agentId: string;
  agentType: 'sdar';
  agentVersion: string;
  applicationVersion: string;
  episodeId: string;
  runId: string;
  segmentId: string;
  correlationId: string;
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  sequence: string;
  evidenceSequence?: string;
  aggregateType: string;
  aggregateId: string;
  skillId?: string;
  skillVersion?: number;
  skillExecutionId?: string;
  rootSkillExecutionId?: string;
  parentSkillExecutionId?: string;
  usageSpecVersion?: string;
  usageSpecHash?: string;
  usageSpecSource?: string;
  skillExecutionMode?: SkillExecutionMode;
  compositionId?: string;
  capabilitySlotId?: string;
  recursionDepth?: number;
  remainingRecursionBudget?: number;
  failurePolicy?: SkillFailurePolicy;
  planComplianceId?: string;
  evidenceRefs: EvidenceReference[];
  artifactRefs: ArtifactReference[];
  attributes: Record<string, string>;
  payloadHash: string;
  payload: TPayload;
  occurredAt: string;
  observedAt?: string;
}

export interface SkillRecordBase {
  skillId: string;
  skillVersion: number;
  skillExecutionId: string;
}

export interface SkillExecutionRecord extends SkillRecordBase {
  rootSkillExecutionId: string;
  parentSkillExecutionId?: string;
  usageSpecVersion: string;
  usageSpecHash: string;
  usageSpecSource: 'native' | 'legacy_projection';
  executionMode: SkillExecutionMode;
  status: SkillExecutionStatus;
  recursionDepth: number;
  remainingRecursionBudget: number;
  failurePolicy: SkillFailurePolicy;
  selectionId: string;
  applicabilityId: string;
  modeSelectionId: string;
  degraded: boolean;
  degradedReasons: string[];
  missingEffects: string[];
  recordVersion: number;
  startedAt?: string;
  endedAt?: string;
}

export interface SkillPlanCompliance {
  planComplianceId: string;
  skillExecutionId: string;
  skillId: string;
  skillVersion: number;
  planId: string;
  planVersion: number;
  result: 'passed' | 'repaired' | 'confirmation_required' | 'rejected';
  checks: Array<Record<string, unknown>>;
  repairAttemptCount: number;
  reportHash: string;
  checkedAt: string;
}

/**
 * The JSON Schemas under schemas/sdar_runtime/v1_3_skill_aware are the
 * authoritative definitions. Generate full payload types from those schemas;
 * do not widen them based on these integration-facing convenience interfaces.
 */
