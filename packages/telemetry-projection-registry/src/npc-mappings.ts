import {
  type DomainSourceRecord,
} from "../../telemetry-contracts/src/index.js";

import {
  COMMANDER_MAPPING_RULE_VERSION,
  mapControlActionTargetFields,
  mapControlReceiptTargetFields,
  mapPreemptionRecoveryTargetFields,
  mapStateFreshnessTargetFields,
  type CommanderTargetFields,
} from "./commander-mappings.js";
import {
  DomainProjectionRegistry,
  createDomainCommonTargetEnvelope,
  type DomainCommonTargetEnvelope,
  type DomainProjectionDescriptor,
  type DomainProjectionMappingId,
} from "./domain.js";

const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

export const NPC_MAPPING_RULE_VERSION = COMMANDER_MAPPING_RULE_VERSION;
export const NPC_MAPPING_IDS = Object.freeze([
  "DP-N01",
  "DP-N02",
  "DP-N03",
  "DP-N04",
  "DP-N05",
] as const);

export type NpcMappingId = (typeof NPC_MAPPING_IDS)[number];
export type NpcMappingFailureCode =
  | "SOURCE_CONTRACT_INVALID"
  | "MAPPING_REQUIRED_FIELD_MISSING"
  | "MAPPING_ENUM_UNSUPPORTED"
  | "HMI_APPROVAL_ACTION_LINK_UNRESOLVED";

export type NpcMappingDecision =
  | Readonly<{
      kind: "produce";
      mappingId: NpcMappingId;
      targetTable: DomainProjectionDescriptor["targetQualifiedTable"];
      envelope: DomainCommonTargetEnvelope;
      targetFields: CommanderTargetFields;
    }>
  | Readonly<{ kind: "skip"; reasonCode: "SOURCE_NOT_APPLICABLE" }>
  | Readonly<{
      kind: "fail";
      mappingId: NpcMappingId | null;
      failureCode: NpcMappingFailureCode;
      field: string;
    }>;

export class NpcDomainMapper {
  private readonly registry = new DomainProjectionRegistry();

  map(source: DomainSourceRecord): NpcMappingDecision {
    const descriptor = this.registry.resolveSource(source.sourceContractId);
    if (descriptor === undefined || !descriptor.mappingId.startsWith("DP-N")) {
      return Object.freeze({ kind: "skip", reasonCode: "SOURCE_NOT_APPLICABLE" });
    }
    try {
      const targetFields = mapTargetFields(descriptor.mappingId, source);
      const envelope = createDomainCommonTargetEnvelope({
        descriptor,
        source,
        mappedPayload: targetFields,
        mappingRuleId: descriptor.definition.mapperId,
        mappingRuleVersion: NPC_MAPPING_RULE_VERSION,
      });
      return deepFreeze({
        kind: "produce",
        mappingId: descriptor.mappingId as NpcMappingId,
        targetTable: descriptor.targetQualifiedTable,
        envelope,
        targetFields,
      });
    } catch (error) {
      if (isMappingFailure(error)) {
        return Object.freeze({
          kind: "fail",
          mappingId: descriptor.mappingId as NpcMappingId,
          failureCode: error.code,
          field: error.field,
        });
      }
      throw error;
    }
  }
}

function mapTargetFields(
  mappingId: DomainProjectionMappingId,
  source: DomainSourceRecord,
): CommanderTargetFields {
  if (!source.sourceContractId.startsWith("sdar.domain-source/npc/")) {
    throw mappingFailure("SOURCE_CONTRACT_INVALID", "sourceContractId");
  }
  switch (mappingId) {
    case "DP-N01":
      return mapControlActionTargetFields(source.payload);
    case "DP-N02":
      return mapControlReceiptTargetFields(source.payload);
    case "DP-N03":
      return mapHumanConfirmation(source.payload);
    case "DP-N04":
      return mapPreemptionRecoveryTargetFields(source.payload);
    case "DP-N05":
      return mapStateFreshnessTargetFields(source, "npc");
    default:
      throw mappingFailure("SOURCE_CONTRACT_INVALID", "sourceContractId");
  }
}

function mapHumanConfirmation(
  payload: Readonly<Record<string, unknown>>,
): CommanderTargetFields {
  requiredString(payload, "approvalId");
  const actionId = payload["actionId"];
  if (typeof actionId !== "string" || actionId.trim() === "") {
    throw mappingFailure("HMI_APPROVAL_ACTION_LINK_UNRESOLVED", "actionId");
  }
  const requestedAt = timestamp(payload, "requestedAt");
  const decidedAt = nullableTimestamp(payload, "respondedAt");
  const validFrom = nullableTimestamp(payload, "validFrom");
  const validUntil = nullableTimestamp(payload, "expiresAt");
  const invalidatedAt = nullableTimestamp(payload, "invalidatedAt");
  assertNotBefore(decidedAt, requestedAt, "respondedAt");
  assertNotBefore(validFrom, requestedAt, "validFrom");
  assertNotBefore(validUntil, validFrom ?? requestedAt, "expiresAt");
  assertNotBefore(invalidatedAt, validFrom ?? requestedAt, "invalidatedAt");
  const invalidationConditions = stringArray(payload, "invalidationConditions", true);
  const invalidationReason = optionalString(payload, "invalidationReason");
  const effectiveConditions =
    invalidationConditions.length === 0 && invalidationReason !== ""
      ? Object.freeze([invalidationReason])
      : invalidationConditions;
  requiredString(payload, "confirmationScope");
  return deepFreeze({
    confirmation_id: requiredString(payload, "confirmationId"),
    action_id: actionId,
    subject_type: "action",
    subject_id: actionId,
    confirmation_status: exactEnum(payload, "decision", [
      "approved",
      "rejected",
      "expired",
      "cancelled",
    ]),
    requested_at: requestedAt,
    decided_at: decidedAt,
    decided_by: optionalString(payload, "approvedBy"),
    valid_from: validFrom,
    valid_until: validUntil,
    invalidation_conditions: effectiveConditions,
    evidence_refs: stringArray(payload, "evidenceRefs", true),
  });
}

function requiredString(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return candidate;
}

function optionalString(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (candidate === undefined) return "";
  if (typeof candidate !== "string") {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return candidate;
}

function exactEnum<const T extends string>(
  value: Readonly<Record<string, unknown>>,
  field: string,
  allowed: readonly T[],
): T {
  const candidate = requiredString(value, field);
  if (!allowed.includes(candidate as T)) {
    throw mappingFailure("MAPPING_ENUM_UNSUPPORTED", field);
  }
  return candidate as T;
}

function timestamp(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = requiredString(value, field);
  const match = UTC_TIMESTAMP.exec(candidate);
  if (match === null) throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3) || "0");
  const instant = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    milliseconds,
  );
  const parsed = new Date(instant);
  if (
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3]) ||
    parsed.getUTCHours() !== Number(match[4]) ||
    parsed.getUTCMinutes() !== Number(match[5]) ||
    parsed.getUTCSeconds() !== Number(match[6]) ||
    parsed.getUTCMilliseconds() !== milliseconds
  ) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return parsed.toISOString();
}

function nullableTimestamp(
  value: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  if (value[field] === undefined || value[field] === null) return null;
  return timestamp(value, field);
}

function assertNotBefore(
  later: string | null,
  earlier: string,
  field: string,
): void {
  if (later !== null && Date.parse(later) < Date.parse(earlier)) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
}

function stringArray(
  value: Readonly<Record<string, unknown>>,
  field: string,
  optional: boolean,
): readonly string[] {
  const candidate = value[field];
  if (candidate === undefined && optional) return Object.freeze([]);
  if (
    !Array.isArray(candidate) ||
    candidate.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return Object.freeze([...candidate]);
}

type MappingFailure = Error & { code: NpcMappingFailureCode; field: string };

function mappingFailure(code: NpcMappingFailureCode, field: string): MappingFailure {
  return Object.assign(new Error(code), { code, field });
}

function isMappingFailure(value: unknown): value is MappingFailure {
  return (
    value instanceof Error &&
    "code" in value &&
    "field" in value &&
    (value.code === "SOURCE_CONTRACT_INVALID" ||
      value.code === "MAPPING_REQUIRED_FIELD_MISSING" ||
      value.code === "MAPPING_ENUM_UNSUPPORTED" ||
      value.code === "HMI_APPROVAL_ACTION_LINK_UNRESOLVED") &&
    typeof value.field === "string"
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
