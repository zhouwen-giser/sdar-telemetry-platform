import { createHash } from "node:crypto";

import {
  DOMAIN_PROJECTION_CONTRACT_VERSION,
  canonicalizeDomainProjectionJson,
  createDomainProjectionDefinitionHash,
  hashCanonicalDomainProjectionJson,
  type DomainProjectionDefinition,
} from "../../telemetry-contracts/src/index.js";
import type {
  DomainSourceContractId,
  DomainSourceRecord,
  DomainSourceSha256,
} from "../../telemetry-contracts/src/domain-source.js";

export const DOMAIN_CANONICAL_ID_NAMESPACE = "5832c301-3d9e-5927-8f15-fa6262c8fc4e" as const;
export const DOMAIN_CANONICAL_ID_NAMESPACE_VERSION = 1 as const;
export const DOMAIN_ENVIRONMENT_MAP_VERSION = "identity/1" as const;
export const DOMAIN_PROJECTION_MAPPER_VERSION = "0.1.0" as const;
export const DOMAIN_PROJECTION_VERSION = 1 as const;
export const DOMAIN_PROJECTION_SOURCE_STREAM = "sdar.domain-source/v1" as const;
const SEMANTIC_VERSION =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export type DomainProjectionMappingId =
  | "DP-C01"
  | "DP-C02"
  | "DP-C03"
  | "DP-C04"
  | "DP-C05"
  | "DP-N01"
  | "DP-N02"
  | "DP-N03"
  | "DP-N04"
  | "DP-N05";

export type DomainProjectionId =
  | "application_to_embodied.dp-c01"
  | "application_to_embodied.dp-c02"
  | "application_to_embodied.dp-c03"
  | "application_to_embodied.dp-c04"
  | "application_to_embodied.dp-c05"
  | "application_to_embodied.dp-n01"
  | "application_to_embodied.dp-n02"
  | "application_to_embodied.dp-n03"
  | "application_to_embodied.dp-n04"
  | "application_to_embodied.dp-n05";

export type DomainTargetTable =
  | "control_action"
  | "control_receipt"
  | "human_confirmation"
  | "physical_verification"
  | "preemption_recovery"
  | "state_freshness_check";

export type DomainProjectionDescriptor = Readonly<{
  mappingId: DomainProjectionMappingId;
  sourceContractId: DomainSourceContractId;
  sourceQualifiedTable: `sdar_${"commander" | "npc"}.${string}`;
  targetQualifiedTable: `sdar_embodied.${DomainTargetTable}`;
  targetEntityType: `embodied.${DomainTargetTable}`;
  definition: DomainProjectionDefinition;
  definitionHash: `sha256:${string}`;
}>;

export type CanonicalDomainIdentityInput = Readonly<{
  tenantId: string;
  projectId: string;
  sourceAgentType: "commander" | "npc" | "sdar";
  sourceEntityType: string;
  sourceId: string;
}>;

export type CanonicalDomainIdentity = Readonly<{
  canonicalName: string;
  targetId: string;
  sourceKeyHash: `sha256:${string}`;
}>;

export type DomainCommonTargetEnvelope = Readonly<{
  tenantId: string;
  projectId: string;
  environment: "dev" | "test" | "staging" | "prod";
  sourceDeploymentId: string;
  sourceEnvironmentRaw: string;
  environmentMapVersion: typeof DOMAIN_ENVIRONMENT_MAP_VERSION;
  environmentMappingId: null;
  recordId: string;
  canonicalRecordId: string;
  episodeKey: string;
  canonicalEpisodeId: string;
  runId: string;
  segmentId: string;
  agentId: string;
  agentType: "commander" | "npc";
  agentVersion: string | null;
  scenarioId: string | null;
  correlationId: string | null;
  episodeSequence: string;
  sequence: string;
  runSequence: string;
  evidenceSequence: null;
  sourceDatabase: "sdar_commander" | "sdar_npc";
  sourceTable: string;
  sourceRecordId: string;
  sourceSchemaName: DomainSourceContractId;
  sourceSchemaVersion: 1;
  sourceCollectionProfile: typeof DOMAIN_PROJECTION_SOURCE_STREAM;
  sourceEvidenceLevel: "direct";
  mappingRuleId: string;
  mappingRuleVersion: string;
  sourcePayloadHash: DomainSourceSha256;
  rootSourceDatabase: "sdar_commander" | "sdar_npc";
  rootSourceTable: string;
  rootSourceRecordId: string;
  rootSourceSchemaName: DomainSourceContractId;
  rootSourceSchemaVersion: 1;
  rootSourcePayloadHash: DomainSourceSha256;
  projectionId: DomainProjectionId;
  projectionVersion: typeof DOMAIN_PROJECTION_VERSION;
  projectionRevision: string;
  supersedesRecordId: null;
  payloadJson: string;
  payloadSha256: `sha256:${string}`;
  occurredAt: string;
  idNamespaceVersion: typeof DOMAIN_CANONICAL_ID_NAMESPACE_VERSION;
}>;

const catalogRows = Object.freeze([
  catalogRow(
    "DP-C01",
    "sdar.domain-source/commander/mcp-action",
    "sdar_commander",
    "domain_mcp_action_source_v1",
    "control_action",
  ),
  catalogRow(
    "DP-C02",
    "sdar.domain-source/commander/mcp-receipt",
    "sdar_commander",
    "domain_mcp_receipt_source_v1",
    "control_receipt",
  ),
  catalogRow(
    "DP-C03",
    "sdar.domain-source/commander/capability-track-sample",
    "sdar_commander",
    "domain_capability_track_sample_source_v1",
    "physical_verification",
  ),
  catalogRow(
    "DP-C04",
    "sdar.domain-source/commander/error-recovery",
    "sdar_commander",
    "domain_error_recovery_source_v1",
    "preemption_recovery",
  ),
  catalogRow(
    "DP-C05",
    "sdar.domain-source/commander/ugv-state-snapshot",
    "sdar_commander",
    "domain_ugv_state_snapshot_source_v1",
    "state_freshness_check",
    true,
  ),
  catalogRow(
    "DP-N01",
    "sdar.domain-source/npc/mission-tool-call",
    "sdar_npc",
    "domain_mission_tool_call_source_v1",
    "control_action",
  ),
  catalogRow(
    "DP-N02",
    "sdar.domain-source/npc/mcp-receipt",
    "sdar_npc",
    "domain_mcp_receipt_source_v1",
    "control_receipt",
  ),
  catalogRow(
    "DP-N03",
    "sdar.domain-source/npc/hmi-approval",
    "sdar_npc",
    "domain_hmi_approval_source_v1",
    "human_confirmation",
  ),
  catalogRow(
    "DP-N04",
    "sdar.domain-source/npc/preemption-record",
    "sdar_npc",
    "domain_preemption_record_source_v1",
    "preemption_recovery",
  ),
  catalogRow(
    "DP-N05",
    "sdar.domain-source/npc/blackboard-snapshot",
    "sdar_npc",
    "domain_blackboard_snapshot_source_v1",
    "state_freshness_check",
    true,
  ),
] as const);

export const DOMAIN_PROJECTION_DESCRIPTORS: readonly DomainProjectionDescriptor[] = Object.freeze(
  catalogRows.map((row) => descriptorFromRow(row)),
);

export class DomainProjectionRegistry {
  private readonly byProjection = new Map<string, DomainProjectionDescriptor>();
  private readonly bySource = new Map<DomainSourceContractId, DomainProjectionDescriptor>();

  constructor(descriptors: readonly DomainProjectionDescriptor[] = DOMAIN_PROJECTION_DESCRIPTORS) {
    for (const descriptor of descriptors) {
      const projectionKey = `${descriptor.definition.projectionId}@${String(descriptor.definition.projectionVersion)}`;
      if (this.byProjection.has(projectionKey)) {
        throw domainCoreError("DOMAIN_PROJECTION_DUPLICATE", "duplicate projection identity");
      }
      if (this.bySource.has(descriptor.sourceContractId)) {
        throw domainCoreError("DOMAIN_PROJECTION_SOURCE_DUPLICATE", "duplicate source contract");
      }
      if (descriptor.definition.enabled) {
        throw domainCoreError("DOMAIN_PROJECTION_ACTIVATION_FORBIDDEN", "catalog definitions must be disabled");
      }
      assertDescriptorConsistency(descriptor);
      if (descriptor.definitionHash !== createDomainProjectionDefinitionHash(descriptor.definition)) {
        throw domainCoreError("DOMAIN_PROJECTION_DEFINITION_HASH_INVALID", "definition hash mismatch");
      }
      this.byProjection.set(projectionKey, descriptor);
      this.bySource.set(descriptor.sourceContractId, descriptor);
    }
  }

  list(): readonly DomainProjectionDescriptor[] {
    return Object.freeze([...this.byProjection.values()]);
  }

  get(
    projectionId: string,
    projectionVersion: number = DOMAIN_PROJECTION_VERSION,
  ): DomainProjectionDescriptor | undefined {
    return this.byProjection.get(`${projectionId}@${String(projectionVersion)}`);
  }

  resolveSource(sourceContractId: DomainSourceContractId): DomainProjectionDescriptor | undefined {
    return this.bySource.get(sourceContractId);
  }
}

export function createCanonicalDomainIdentity(
  input: CanonicalDomainIdentityInput,
): CanonicalDomainIdentity {
  const tenantId = canonicalIdComponent("tenantId", input.tenantId);
  const projectId = canonicalIdComponent("projectId", input.projectId);
  if (!(["commander", "npc", "sdar"] as const).includes(input.sourceAgentType)) {
    throw domainCoreError("DOMAIN_ID_COMPONENT_INVALID", "sourceAgentType is invalid");
  }
  const sourceEntityType = canonicalIdComponent("sourceEntityType", input.sourceEntityType);
  const sourceId = canonicalIdComponent("sourceId", input.sourceId);
  const canonicalName = [
    "sdar-id-v1",
    tenantId,
    projectId,
    input.sourceAgentType,
    sourceEntityType,
    sourceId,
  ].join("\u001f");
  return Object.freeze({
    canonicalName,
    targetId: uuidV5(DOMAIN_CANONICAL_ID_NAMESPACE, canonicalName),
    sourceKeyHash: `sha256:${createHash("sha256").update(canonicalName, "utf8").digest("hex")}`,
  });
}

export function createDerivedDomainSourceId(
  sourceRecordId: string,
  businessDiscriminator: string,
): string {
  const source = canonicalIdComponent("sourceRecordId", sourceRecordId);
  const discriminator = canonicalIdComponent("businessDiscriminator", businessDiscriminator);
  return `derived-v1:${String(Buffer.byteLength(source, "utf8"))}:${source}:${String(Buffer.byteLength(discriminator, "utf8"))}:${discriminator}`;
}

export function createDomainCommonTargetEnvelope(input: Readonly<{
  descriptor: DomainProjectionDescriptor;
  source: DomainSourceRecord;
  mappedPayload: Readonly<Record<string, unknown>>;
  mappingRuleId: string;
  mappingRuleVersion: string;
  businessDiscriminator?: string;
}>): DomainCommonTargetEnvelope {
  const { descriptor, source } = input;
  if (source.sourceContractId !== descriptor.sourceContractId) {
    throw domainCoreError("DOMAIN_PROJECTION_SOURCE_MISMATCH", "source contract does not match projection");
  }
  const application = source.sourceContractId.includes("/commander/") ? "commander" : "npc";
  const expectedDatabase = application === "commander" ? "sdar_commander" : "sdar_npc";
  if (descriptor.definition.source.database !== expectedDatabase) {
    throw domainCoreError("DOMAIN_PROJECTION_DEFINITION_INVALID", "source database does not match source contract");
  }
  const revision = positiveUInt64("sourceRevision", source.sourceRevision);
  positiveUInt64("sequence", source.sequence);
  const mappingRuleId = canonicalIdComponent("mappingRuleId", input.mappingRuleId);
  const mappingRuleVersion = canonicalIdComponent("mappingRuleVersion", input.mappingRuleVersion);
  if (!SEMANTIC_VERSION.test(mappingRuleVersion)) {
    throw domainCoreError("DOMAIN_MAPPING_RULE_VERSION_INVALID", "mappingRuleVersion must be semantic version");
  }
  const episode = createCanonicalDomainIdentity({
    tenantId: source.tenantId,
    projectId: source.projectId,
    sourceAgentType: application,
    sourceEntityType: "episode",
    sourceId: source.episodeId,
  });
  const run = createCanonicalDomainIdentity({
    tenantId: source.tenantId,
    projectId: source.projectId,
    sourceAgentType: application,
    sourceEntityType: "run",
    sourceId: `p1-default-run:${canonicalIdComponent("episodeId", source.episodeId)}`,
  });
  const segment = createCanonicalDomainIdentity({
    tenantId: source.tenantId,
    projectId: source.projectId,
    sourceAgentType: application,
    sourceEntityType: "segment",
    sourceId: `p1-default-segment:${canonicalIdComponent("episodeId", source.episodeId)}`,
  });
  const targetSourceId =
    input.businessDiscriminator === undefined
      ? source.recordId
      : createDerivedDomainSourceId(source.recordId, input.businessDiscriminator);
  const target = createCanonicalDomainIdentity({
    tenantId: source.tenantId,
    projectId: source.projectId,
    sourceAgentType: application,
    sourceEntityType: descriptor.targetEntityType,
    sourceId: targetSourceId,
  });
  const payloadJson = canonicalizeMappedPayload(input.mappedPayload);
  const payloadSha256 = hashCanonicalDomainProjectionJson(input.mappedPayload);
  return deepFreezeDomain({
    tenantId: source.tenantId,
    projectId: source.projectId,
    environment: source.environment,
    sourceDeploymentId: source.producerId,
    sourceEnvironmentRaw: source.environment,
    environmentMapVersion: DOMAIN_ENVIRONMENT_MAP_VERSION,
    environmentMappingId: null,
    recordId: target.targetId,
    canonicalRecordId: target.targetId,
    episodeKey: source.episodeId,
    canonicalEpisodeId: episode.targetId,
    runId: run.targetId,
    segmentId: segment.targetId,
    agentId: source.agentId,
    agentType: application,
    agentVersion: source.agentVersion ?? null,
    scenarioId: source.scenarioId ?? null,
    correlationId: source.correlationId ?? null,
    episodeSequence: source.sequence,
    sequence: source.sequence,
    runSequence: source.sequence,
    evidenceSequence: null,
    sourceDatabase: expectedDatabase,
    sourceTable: descriptor.definition.source.table,
    sourceRecordId: source.recordId,
    sourceSchemaName: source.sourceContractId,
    sourceSchemaVersion: 1,
    sourceCollectionProfile: DOMAIN_PROJECTION_SOURCE_STREAM,
    sourceEvidenceLevel: "direct",
    mappingRuleId,
    mappingRuleVersion,
    sourcePayloadHash: source.payloadHash,
    rootSourceDatabase: expectedDatabase,
    rootSourceTable: descriptor.definition.source.table,
    rootSourceRecordId: source.recordId,
    rootSourceSchemaName: source.sourceContractId,
    rootSourceSchemaVersion: 1,
    rootSourcePayloadHash: source.payloadHash,
    projectionId: descriptor.definition.projectionId as DomainProjectionId,
    projectionVersion: DOMAIN_PROJECTION_VERSION,
    projectionRevision: revision,
    supersedesRecordId: null,
    payloadJson,
    payloadSha256,
    occurredAt: source.occurredAt,
    idNamespaceVersion: DOMAIN_CANONICAL_ID_NAMESPACE_VERSION,
  });
}

export function uuidV5(namespace: string, name: string): string {
  const namespaceHex = namespace.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/u.test(namespaceHex)) {
    throw domainCoreError("DOMAIN_UUID_NAMESPACE_INVALID", "UUID namespace is invalid");
  }
  const namespaceBytes = Buffer.from(namespaceHex, "hex");
  const digest = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type CatalogRow = Readonly<{
  mappingId: DomainProjectionMappingId;
  sourceContractId: DomainSourceContractId;
  sourceDatabase: "sdar_commander" | "sdar_npc";
  sourceTable: string;
  targetTable: DomainTargetTable;
  stateLike: boolean;
}>;

function catalogRow(
  mappingId: DomainProjectionMappingId,
  sourceContractId: DomainSourceContractId,
  sourceDatabase: "sdar_commander" | "sdar_npc",
  sourceTable: string,
  targetTable: DomainTargetTable,
  stateLike = false,
): CatalogRow {
  return Object.freeze({
    mappingId,
    sourceContractId,
    sourceDatabase,
    sourceTable,
    targetTable,
    stateLike,
  });
}

function descriptorFromRow(row: CatalogRow): DomainProjectionDescriptor {
  const suffix = row.mappingId.toLowerCase();
  const definition: DomainProjectionDefinition = deepFreezeDomain({
    contractVersion: DOMAIN_PROJECTION_CONTRACT_VERSION,
    projectionId: `application_to_embodied.${suffix}`,
    projectionVersion: DOMAIN_PROJECTION_VERSION,
    source: { database: row.sourceDatabase, table: row.sourceTable },
    target: { database: "sdar_embodied", table: row.targetTable },
    mapperId: `domain.mapper.${suffix}`,
    mapperVersion: DOMAIN_PROJECTION_MAPPER_VERSION,
    cursorPolicy: {
      fields: row.stateLike
        ? ["occurred_at", "state_snapshot_version", "record_id", "source_revision"]
        : ["occurred_at", "sequence", "record_id", "source_revision"],
      uniqueTieBreakerFields: ["record_id", "source_revision"],
      order: "asc",
    },
    identityPolicy: { version: "uuidv5-rfc9562-v1" },
    enabled: false,
  });
  return deepFreezeDomain({
    mappingId: row.mappingId,
    sourceContractId: row.sourceContractId,
    sourceQualifiedTable: `${row.sourceDatabase}.${row.sourceTable}`,
    targetQualifiedTable: `sdar_embodied.${row.targetTable}`,
    targetEntityType: `embodied.${row.targetTable}`,
    definition,
    definitionHash: createDomainProjectionDefinitionHash(definition),
  });
}

function canonicalizeMappedPayload(value: Readonly<Record<string, unknown>>): string {
  return canonicalizeDomainProjectionJson(value);
}

function canonicalIdComponent(field: string, value: string): string {
  if (typeof value !== "string") {
    throw domainCoreError("DOMAIN_ID_COMPONENT_INVALID", `${field} must be a string`);
  }
  const normalized = value.normalize("NFC").trim();
  if (normalized === "" || normalized.includes("\u001f")) {
    throw domainCoreError("DOMAIN_ID_COMPONENT_INVALID", `${field} is empty or contains U+001F`);
  }
  return normalized;
}

function assertDescriptorConsistency(descriptor: DomainProjectionDescriptor): void {
  const suffix = descriptor.mappingId.toLowerCase();
  const expectedProjectionId = `application_to_embodied.${suffix}`;
  const expectedMapperId = `domain.mapper.${suffix}`;
  const definition = descriptor.definition;
  if (
    definition.contractVersion !== DOMAIN_PROJECTION_CONTRACT_VERSION ||
    definition.projectionId !== expectedProjectionId ||
    definition.projectionVersion !== DOMAIN_PROJECTION_VERSION ||
    definition.mapperId !== expectedMapperId ||
    definition.mapperVersion !== DOMAIN_PROJECTION_MAPPER_VERSION ||
    definition.identityPolicy.version !== "uuidv5-rfc9562-v1" ||
    descriptor.sourceQualifiedTable !==
      `${definition.source.database}.${definition.source.table}` ||
    descriptor.targetQualifiedTable !== `sdar_embodied.${definition.target.table}` ||
    descriptor.targetEntityType !== `embodied.${definition.target.table}`
  ) {
    throw domainCoreError("DOMAIN_PROJECTION_DESCRIPTOR_INVALID", "descriptor is inconsistent");
  }
  const expectedAgent = descriptor.sourceContractId.includes("/commander/")
    ? "sdar_commander"
    : "sdar_npc";
  if (definition.source.database !== expectedAgent) {
    throw domainCoreError(
      "DOMAIN_PROJECTION_DESCRIPTOR_INVALID",
      "source contract application does not match source database",
    );
  }
}

function positiveUInt64(field: string, value: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw domainCoreError("DOMAIN_SOURCE_REVISION_INVALID", `${field} must be a positive decimal`);
  }
  const parsed = BigInt(value);
  if (parsed > 18_446_744_073_709_551_615n) {
    throw domainCoreError("DOMAIN_SOURCE_REVISION_INVALID", `${field} exceeds UInt64`);
  }
  return value;
}

function deepFreezeDomain<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreezeDomain(nested);
  return Object.freeze(value);
}

function domainCoreError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
