import {createHash} from "node:crypto";

import type {CanonicalFact, EvidenceV1Record} from "../../telemetry-types/src/index.js";

export * from "./domain.js";

const EVIDENCE_V1_CANONICAL_TABLE = "sdar_core.sdar_evidence_v1_record";
const EVIDENCE_V1_CANONICAL_PROJECTION_ID = "sdar-evidence-v1-canonical";
const EVIDENCE_V1_SPECIALIZED_PROJECTION_ID = "sdar-evidence-v1-node-control";
const SPECIALIZED_PROJECTION_VERSION = 1;

export interface ProjectionRow {
  table: string;
  row: Record<string, unknown>;
}

export interface Projection {
  id: string;
  version: string;
  supports(fact: CanonicalFact): boolean;
  project(fact: CanonicalFact): ProjectionRow[];
}

export class ProjectionRegistry {
  private readonly items: Projection[] = [];

  register(projection: Projection): void {
    if (
      this.items.some(
        (candidate) => candidate.id === projection.id && candidate.version === projection.version,
      )
    ) {
      throw new Error("duplicate projection");
    }
    this.items.push(projection);
  }

  project(fact: CanonicalFact): ProjectionRow[] {
    return this.items
      .filter((projection) => projection.supports(fact))
      .flatMap((projection) => projection.project(fact));
  }
}

const legacyBase = (fact: CanonicalFact): Record<string, unknown> => ({
  fact_id: fact.factId,
  source_id: fact.sourceId,
  source_record_id: fact.sourceRecordId,
  tenant_id: fact.tenantId,
  occurred_at: fact.occurredAt,
  payload_json: JSON.stringify(fact.payload),
  payload_hash: fact.payloadHash,
  projection_version: fact.projectionVersion,
});

export const canonicalProjection: Projection = {
  id: "canonical",
  version: "1.0.0",
  supports: () => true,
  project: (fact) => {
    if (isEvidenceV1Fact(fact)) {
      return [{table: EVIDENCE_V1_CANONICAL_TABLE, row: canonicalEvidenceV1Row(fact)}];
    }
    return [
      {
        table: "sdar_core.canonical_telemetry_fact",
        row: {...legacyBase(fact), record_family: fact.recordFamily, source_type: fact.sourceType},
      },
    ];
  },
};

export const v13Projection: Projection = {
  id: "sdar-v13",
  version: "1.0.0",
  supports: (fact) =>
    !isEvidenceV1Fact(fact) && fact.recordFamily.startsWith("sdar.runtime."),
  project: (fact) => {
    if (!fact.recordFamily.startsWith("sdar.runtime.")) return [];
    if (
      fact.recordFamily === "sdar.runtime.capability_summary" ||
      fact.recordFamily === "sdar.runtime.public_capability_card"
    ) {
      return [
        {
          table: "sdar_core.runtime_capability_summary_fact",
          row: {...legacyBase(fact), summary_kind: fact.recordFamily},
        },
      ];
    }
    return [
      {
        table: "sdar_core.runtime_fact",
        row: {...legacyBase(fact), fact_type: fact.recordFamily},
      },
    ];
  },
};

const legacyV14Tables = Object.freeze({
  "sdar.node_capability.version": "sdar_core.node_capability_version_fact",
  "sdar.node_capability.implementation_binding":
    "sdar_core.capability_implementation_binding_fact",
  "sdar.node_capability.readiness": "sdar_core.capability_readiness_fact",
  "sdar.a2a.exposure_revision": "sdar_core.a2a_exposure_revision_fact",
  "sdar.a2a.agent_card_revision": "sdar_core.agent_card_revision_fact",
  "sdar.task.capability_binding": "sdar_core.task_capability_binding_fact",
  "sdar.task.capability_attempt": "sdar_core.task_capability_attempt_fact",
} as const);

export const EVIDENCE_V1_SPECIALIZED_TABLES = Object.freeze({
  "node_control.capability_revision": "sdar_core.node_capability_version_fact",
  "node_control.a2a_exposure": "sdar_core.a2a_exposure_revision_fact",
  "node_control.agent_card_revision": "sdar_core.agent_card_revision_fact",
} as const);

/**
 * These frozen record types are intentionally canonical-only. Their payloads do not guarantee
 * every non-nullable column required by the existing v1.4 analytical DDL.
 */
export const EVIDENCE_V1_EXPLICIT_CANONICAL_ONLY_RECORD_TYPES = Object.freeze([
  "capability.definition",
  "capability.implementation_binding",
  "capability.readiness",
  "capability.a2a_exposure",
  "capability.agent_card_revision",
  "capability.task_binding",
  "capability.execution_attempt",
  "node_control.capability_readiness",
] as const);

type SpecializedRecordType = keyof typeof EVIDENCE_V1_SPECIALIZED_TABLES;
type SpecializedMapper = (fact: CanonicalFact) => ProjectionRow | undefined;

const specializedMappers: Readonly<Record<SpecializedRecordType, SpecializedMapper>> =
  Object.freeze({
    "node_control.capability_revision": projectNodeControlCapabilityRevision,
    "node_control.a2a_exposure": projectNodeControlA2aExposure,
    "node_control.agent_card_revision": projectNodeControlAgentCardRevision,
  });

export const v14Projection: Projection = {
  id: "sdar-v14-capability",
  version: "1.0.0",
  supports: (fact) => {
    if (isEvidenceV1Fact(fact)) return isSpecializedRecordType(fact.recordType);
    return Object.hasOwn(legacyV14Tables, fact.recordFamily);
  },
  project: (fact) => {
    if (isEvidenceV1Fact(fact)) {
      if (!isSpecializedRecordType(fact.recordType)) return [];
      const row = specializedMappers[fact.recordType](fact);
      return row === undefined ? [] : [row];
    }
    const table = legacyV14Tables[fact.recordFamily as keyof typeof legacyV14Tables];
    if (table === undefined) return [];
    return [{table, row: {...legacyBase(fact), fact_type: fact.recordFamily}}];
  },
};

export const smppProjection: Projection = {
  id: "smpp-providerops",
  version: "1.1.0",
  supports: (fact) => !isEvidenceV1Fact(fact) && fact.sourceType === "smpp-providerops-1.1.0",
  project: (fact) => [
    {
      table: "sdar_core.smpp_provider_ops_fact",
      row: {
        ...legacyBase(fact),
        smpp_source_id: fact.sourceId,
        record_type: fact.recordFamily,
      },
    },
  ],
};

export interface EvidenceV1ProjectionCoverage {
  recordType: string;
  mode: "canonical+specialized" | "canonical-only";
  canonicalTable: typeof EVIDENCE_V1_CANONICAL_TABLE;
  specializedTable?: string;
  reason: string;
}

export function evidenceV1ProjectionCoverage(fact: CanonicalFact): EvidenceV1ProjectionCoverage {
  const evidence = requireEvidenceV1Fact(fact);
  if (isSpecializedRecordType(evidence.record.recordType)) {
    const specialized = specializedMappers[evidence.record.recordType](fact);
    if (specialized !== undefined) {
      return {
        recordType: evidence.record.recordType,
        mode: "canonical+specialized",
        canonicalTable: EVIDENCE_V1_CANONICAL_TABLE,
        specializedTable: specialized.table,
        reason: "complete frozen payload and target DDL coverage",
      };
    }
    return {
      recordType: evidence.record.recordType,
      mode: "canonical-only",
      canonicalTable: EVIDENCE_V1_CANONICAL_TABLE,
      reason: "specialized target requires complete frozen payload and source scope",
    };
  }
  return {
    recordType: evidence.record.recordType,
    mode: "canonical-only",
    canonicalTable: EVIDENCE_V1_CANONICAL_TABLE,
    reason: isExplicitCanonicalOnlyRecordType(evidence.record.recordType)
      ? "existing target DDL requires fields not guaranteed by the frozen payload"
      : "no explicit lossless specialized mapper is registered",
  };
}

interface RequiredEvidenceFact {
  fact: CanonicalFact;
  record: EvidenceV1Record;
  exportId: string;
  exportRevision: number;
  batchNodeId: string;
  batchHash: string;
  firstSequence: string;
  lastSequence: string;
}

function canonicalEvidenceV1Row(fact: CanonicalFact): Record<string, unknown> {
  const evidence = requireEvidenceV1Fact(fact);
  const {record} = evidence;
  const receivedAt = fact.receivedAt ?? fact.ingestedAt;
  return {
    row_id: canonicalRowId(evidence),
    fact_id: fact.factId,
    contract_version: record.contractVersion,
    export_id: evidence.exportId,
    export_revision: evidence.exportRevision,
    source_id: fact.sourceId,
    source_type: fact.sourceType,
    batch_node_id: evidence.batchNodeId,
    batch_hash: evidence.batchHash,
    first_sequence: evidence.firstSequence,
    last_sequence: evidence.lastSequence,
    evidence_sequence: record.evidenceSequence,
    record_id: record.recordId,
    record_family: record.recordFamily,
    record_type: record.recordType,
    schema_name: record.schemaName,
    schema_version: record.schemaVersion,
    source_system: record.sourceSystem,
    source_table: record.sourceTable,
    source_record_id: record.sourceRecordId,
    source_revision: record.sourceRevision,
    tenant_id: record.tenantId ?? null,
    user_scope_id: record.userScopeId ?? null,
    project_id: record.projectId ?? null,
    environment: record.environment,
    node_id: record.nodeId ?? null,
    task_id: record.taskId ?? null,
    context_id: record.contextId ?? null,
    episode_id: record.episodeId ?? null,
    run_id: record.runId ?? null,
    goal_id: record.goalId ?? null,
    goal_version: record.goalVersion ?? null,
    plan_id: record.planId ?? null,
    plan_version: record.planVersion ?? null,
    skill_execution_id: record.skillExecutionId ?? null,
    capability_binding_id: record.capabilityBindingId ?? null,
    remote_task_binding_id: record.remoteTaskBindingId ?? null,
    correlation_id: record.correlationId,
    causation_id: record.causationId ?? null,
    delivery_guarantee: record.deliveryGuarantee,
    evaluation_role: record.evaluationRole,
    observation_generation: record.observationGeneration ?? null,
    evidence_refs: [...record.evidenceRefs],
    artifact_refs: [...record.artifactRefs],
    payload_hash: record.payloadHash,
    payload_json: JSON.stringify(record.payload),
    record_json: JSON.stringify(record),
    occurred_at: record.occurredAt,
    recorded_at: record.recordedAt,
    received_at: receivedAt,
    ingested_at: fact.ingestedAt,
    wal_partition: fact.walPartition ?? null,
    wal_offset: fact.walOffset ?? null,
    wal_written_at: fact.walWrittenAt ?? null,
    wal_payload_hash: fact.walPayloadHash ?? null,
    projected_at: fact.ingestedAt,
    projection_id: EVIDENCE_V1_CANONICAL_PROJECTION_ID,
    projection_version: fact.projectionVersion,
  };
}

function projectNodeControlCapabilityRevision(fact: CanonicalFact): ProjectionRow | undefined {
  const context = specializedContext(fact);
  if (context === undefined) return undefined;
  const payload = jsonObject(context.record.payload);
  if (
    payload === undefined ||
    !hasOwnKeys(payload, [
      "capabilityId",
      "version",
      "domain",
      "name",
      "description",
      "inputSchema",
      "outputSchema",
      "successCriteria",
      "requiredEvidence",
      "effects",
      "artifacts",
      "constraints",
      "supportedModes",
      "riskLevel",
      "status",
      "definitionHash",
      "previousVersion",
      "createdBy",
      "createdAt",
      "updatedAt",
    ])
  ) {
    return undefined;
  }
  const capabilityId = nonEmptyString(payload.capabilityId);
  const version = positiveSafeInteger(payload.version);
  const domain = nonEmptyString(payload.domain);
  const name = nonEmptyString(payload.name);
  const status = nonEmptyString(payload.status);
  const riskLevel = nonEmptyString(payload.riskLevel);
  const definitionHash = sha256Hex(payload.definitionHash);
  if (
    capabilityId === undefined ||
    version === undefined ||
    domain === undefined ||
    name === undefined ||
    status === undefined ||
    riskLevel === undefined ||
    definitionHash === undefined ||
    !Array.isArray(payload.successCriteria) ||
    !Array.isArray(payload.requiredEvidence)
  ) {
    return undefined;
  }
  return {
    table: EVIDENCE_V1_SPECIALIZED_TABLES["node_control.capability_revision"],
    row: {
      ...context.scope,
      record_id: deterministicEvidenceUuid(context.record.recordId),
      capability_id: capabilityId,
      capability_version: version,
      domain,
      name,
      capability_status: status,
      risk_level: riskLevel,
      definition_hash: definitionHash,
      success_criteria_hash: stableSha256Hex(payload.successCriteria),
      evidence_requirement_hash: stableSha256Hex(payload.requiredEvidence),
      source_record_id: context.record.sourceRecordId,
      source_record_hash: context.sourceRecordHash,
      payload_json: JSON.stringify(payload),
      occurred_at: context.record.occurredAt,
      received_at: context.receivedAt,
      projected_at: context.projectedAt,
      projection_id: EVIDENCE_V1_SPECIALIZED_PROJECTION_ID,
      projection_version: SPECIALIZED_PROJECTION_VERSION,
    },
  };
}

function projectNodeControlA2aExposure(fact: CanonicalFact): ProjectionRow | undefined {
  const context = specializedContext(fact);
  if (context === undefined) return undefined;
  const payload = jsonObject(context.record.payload);
  if (
    payload === undefined ||
    !hasOwnKeys(payload, [
      "exposureId",
      "version",
      "capabilityId",
      "capabilityVersion",
      "agentSkillId",
      "name",
      "description",
      "tags",
      "examples",
      "inputModes",
      "outputModes",
      "requestSchema",
      "resultSchema",
      "visibility",
      "requesterPolicy",
      "readinessPublicationPolicy",
      "status",
      "exposureHash",
      "createdAt",
      "updatedAt",
    ])
  ) {
    return undefined;
  }
  const exposureId = nonEmptyString(payload.exposureId);
  const exposureVersion = positiveSafeInteger(payload.version);
  const agentSkillId = nonEmptyString(payload.agentSkillId);
  const capabilityId = nonEmptyString(payload.capabilityId);
  const capabilityVersion = positiveSafeInteger(payload.capabilityVersion);
  const visibility = nonEmptyString(payload.visibility);
  const status = nonEmptyString(payload.status);
  const readinessPublicationPolicy = nonEmptyString(payload.readinessPublicationPolicy);
  const exposureHash = sha256Hex(payload.exposureHash);
  if (
    exposureId === undefined ||
    exposureVersion === undefined ||
    agentSkillId === undefined ||
    capabilityId === undefined ||
    capabilityVersion === undefined ||
    visibility === undefined ||
    status === undefined ||
    readinessPublicationPolicy === undefined ||
    exposureHash === undefined
  ) {
    return undefined;
  }
  return {
    table: EVIDENCE_V1_SPECIALIZED_TABLES["node_control.a2a_exposure"],
    row: {
      ...context.scope,
      record_id: deterministicEvidenceUuid(context.record.recordId),
      exposure_id: exposureId,
      exposure_version: exposureVersion,
      agent_skill_id: agentSkillId,
      capability_id: capabilityId,
      capability_version: capabilityVersion,
      visibility,
      exposure_status: status,
      readiness_publication_policy: readinessPublicationPolicy,
      exposure_hash: exposureHash,
      source_record_id: context.record.sourceRecordId,
      source_record_hash: context.sourceRecordHash,
      occurred_at: context.record.occurredAt,
      received_at: context.receivedAt,
      projected_at: context.projectedAt,
      projection_id: EVIDENCE_V1_SPECIALIZED_PROJECTION_ID,
      projection_version: SPECIALIZED_PROJECTION_VERSION,
    },
  };
}

function projectNodeControlAgentCardRevision(fact: CanonicalFact): ProjectionRow | undefined {
  const context = specializedContext(fact);
  if (context === undefined) return undefined;
  const payload = jsonObject(context.record.payload);
  if (
    payload === undefined ||
    !hasOwnKeys(payload, [
      "revision",
      "nodeId",
      "exposureRefs",
      "contentHash",
      "capabilityCatalogHash",
      "status",
      "card",
      "generatedAt",
      "activatedAt",
      "rejectionCode",
    ])
  ) {
    return undefined;
  }
  const revision = positiveSafeInteger(payload.revision);
  const nodeId = nonEmptyString(payload.nodeId);
  const exposureRefs = stringArray(payload.exposureRefs);
  const contentHash = sha256Hex(payload.contentHash);
  const capabilityCatalogHash = sha256Hex(payload.capabilityCatalogHash);
  const status = nonEmptyString(payload.status);
  const activatedAt = nullableString(payload.activatedAt);
  if (
    revision === undefined ||
    nodeId === undefined ||
    exposureRefs === undefined ||
    contentHash === undefined ||
    capabilityCatalogHash === undefined ||
    status === undefined ||
    activatedAt === undefined
  ) {
    return undefined;
  }
  return {
    table: EVIDENCE_V1_SPECIALIZED_TABLES["node_control.agent_card_revision"],
    row: {
      ...context.scope,
      node_id: nodeId,
      record_id: deterministicEvidenceUuid(context.record.recordId),
      agent_card_revision: revision,
      card_status: status,
      content_hash: contentHash,
      capability_catalog_hash: capabilityCatalogHash,
      exposure_refs: exposureRefs,
      source_record_id: context.record.sourceRecordId,
      source_record_hash: context.sourceRecordHash,
      occurred_at: context.record.occurredAt,
      activated_at: activatedAt,
      received_at: context.receivedAt,
      projected_at: context.projectedAt,
      projection_id: EVIDENCE_V1_SPECIALIZED_PROJECTION_ID,
      projection_version: SPECIALIZED_PROJECTION_VERSION,
    },
  };
}

interface SpecializedContext {
  record: EvidenceV1Record;
  scope: {tenant_id: string; project_id: string; environment: string; node_id: string};
  sourceRecordHash: string;
  receivedAt: string;
  projectedAt: string;
}

function specializedContext(fact: CanonicalFact): SpecializedContext | undefined {
  if (!isEvidenceV1Fact(fact)) return undefined;
  let evidence: RequiredEvidenceFact;
  try {
    evidence = requireEvidenceV1Fact(fact);
  } catch {
    return undefined;
  }
  const tenantId = nonEmptyString(evidence.record.tenantId);
  const projectId = nonEmptyString(evidence.record.projectId);
  const environment = nonEmptyString(evidence.record.environment);
  const nodeId = nonEmptyString(evidence.record.nodeId) ?? nonEmptyString(evidence.batchNodeId);
  const sourceRecordHash = sha256Hex(evidence.record.payloadHash);
  if (
    tenantId === undefined ||
    projectId === undefined ||
    environment === undefined ||
    nodeId === undefined ||
    sourceRecordHash === undefined
  ) {
    return undefined;
  }
  return {
    record: evidence.record,
    scope: {tenant_id: tenantId, project_id: projectId, environment, node_id: nodeId},
    sourceRecordHash,
    receivedAt: fact.receivedAt ?? fact.ingestedAt,
    projectedAt: fact.ingestedAt,
  };
}

function isEvidenceV1Fact(fact: CanonicalFact): boolean {
  return fact.sourceType === "sdar-evidence-v1" && fact.contractVersion === "sdar.evidence/v1";
}

function requireEvidenceV1Fact(fact: CanonicalFact): RequiredEvidenceFact {
  if (!isEvidenceV1Fact(fact) || fact.evidenceRecord === undefined) {
    throw new Error("Evidence v1 canonical fact is incomplete.");
  }
  const record = fact.evidenceRecord;
  if (
    fact.factId !== record.recordId ||
    fact.recordId !== record.recordId ||
    fact.recordType !== record.recordType ||
    fact.recordFamily !== record.recordFamily ||
    fact.sourceRecordId !== record.sourceRecordId ||
    fact.payloadHash !== record.payloadHash
  ) {
    throw new Error("Evidence v1 canonical fact identity is inconsistent.");
  }
  const exportId = nonEmptyString(fact.exportId);
  const exportRevision = nonNegativeSafeInteger(fact.exportRevision);
  const batchNodeId = nonEmptyString(fact.batchNodeId ?? fact.nodeId);
  const batchHash = nonEmptyString(fact.batchHash);
  const firstSequence = nonEmptyString(fact.firstSequence);
  const lastSequence = nonEmptyString(fact.lastSequence);
  if (
    exportId === undefined ||
    exportRevision === undefined ||
    batchNodeId === undefined ||
    batchHash === undefined ||
    firstSequence === undefined ||
    lastSequence === undefined
  ) {
    throw new Error("Evidence v1 canonical fact batch lineage is incomplete.");
  }
  return {fact, record, exportId, exportRevision, batchNodeId, batchHash, firstSequence, lastSequence};
}

function canonicalRowId(evidence: RequiredEvidenceFact): string {
  return createHash("sha256")
    .update(`${EVIDENCE_V1_CANONICAL_PROJECTION_ID}\u0000${evidence.record.recordId}`, "utf8")
    .digest("hex");
}

function deterministicEvidenceUuid(recordId: string): string {
  const digest = createHash("sha256")
    .update(`sdar-evidence-v1-specialized\u0000${recordId}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  const variant = Number.parseInt(digest[16] ?? "0", 16);
  digest[16] = ((variant & 0x3) | 0x8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableSha256Hex(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Projection input contains a non-finite number.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Projection input is not JSON.");
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOwnKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : nonEmptyString(value);
}

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => nonEmptyString(item) !== undefined)
    ? [...value]
    : undefined;
}

function sha256Hex(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) return undefined;
  return value.slice("sha256:".length);
}

function isSpecializedRecordType(value: string | undefined): value is SpecializedRecordType {
  return value !== undefined && Object.hasOwn(EVIDENCE_V1_SPECIALIZED_TABLES, value);
}

function isExplicitCanonicalOnlyRecordType(value: string): boolean {
  return (EVIDENCE_V1_EXPLICIT_CANONICAL_ONLY_RECORD_TYPES as readonly string[]).includes(value);
}
