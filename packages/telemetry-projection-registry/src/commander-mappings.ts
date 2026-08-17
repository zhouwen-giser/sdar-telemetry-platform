import {
  canonicalizeDomainProjectionJson,
  type DomainSourceRecord,
} from "../../telemetry-contracts/src/index.js";

import {
  DOMAIN_PROJECTION_MAPPER_VERSION,
  DomainProjectionRegistry,
  createCanonicalDomainIdentity,
  createDerivedDomainSourceId,
  createDomainCommonTargetEnvelope,
  type DomainCommonTargetEnvelope,
  type DomainProjectionDescriptor,
  type DomainProjectionMappingId,
} from "./domain.js";

const MAX_UINT32 = 4_294_967_295n;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

export const COMMANDER_MAPPING_RULE_VERSION = DOMAIN_PROJECTION_MAPPER_VERSION;
export const COMMANDER_MAPPING_IDS = Object.freeze([
  "DP-C01",
  "DP-C02",
  "DP-C03",
  "DP-C04",
  "DP-C05",
] as const);

export type CommanderMappingId = (typeof COMMANDER_MAPPING_IDS)[number];
export type CommanderMappingFailureCode =
  | "SOURCE_CONTRACT_INVALID"
  | "MAPPING_REQUIRED_FIELD_MISSING"
  | "MAPPING_ENUM_UNSUPPORTED";
export type CommanderMappingSkipReason = "SOURCE_NOT_APPLICABLE";
export type CommanderTargetFields = Readonly<Record<string, unknown>>;

export type CommanderMappingDecision =
  | Readonly<{
      kind: "produce";
      mappingId: CommanderMappingId;
      targetTable: DomainProjectionDescriptor["targetQualifiedTable"];
      envelope: DomainCommonTargetEnvelope;
      targetFields: CommanderTargetFields;
    }>
  | Readonly<{ kind: "skip"; reasonCode: CommanderMappingSkipReason }>
  | Readonly<{
      kind: "fail";
      mappingId: CommanderMappingId | null;
      failureCode: CommanderMappingFailureCode;
      field: string;
    }>;

export class CommanderDomainMapper {
  private readonly registry = new DomainProjectionRegistry();

  map(source: DomainSourceRecord): CommanderMappingDecision {
    const descriptor = this.registry.resolveSource(source.sourceContractId);
    if (descriptor === undefined || !descriptor.mappingId.startsWith("DP-C")) {
      return Object.freeze({ kind: "skip", reasonCode: "SOURCE_NOT_APPLICABLE" });
    }
    try {
      const targetFields = mapTargetFields(descriptor.mappingId, source);
      const envelope = createDomainCommonTargetEnvelope({
        descriptor,
        source,
        mappedPayload: targetFields,
        mappingRuleId: descriptor.definition.mapperId,
        mappingRuleVersion: COMMANDER_MAPPING_RULE_VERSION,
      });
      return deepFreeze({
        kind: "produce",
        mappingId: descriptor.mappingId as CommanderMappingId,
        targetTable: descriptor.targetQualifiedTable,
        envelope,
        targetFields,
      });
    } catch (error) {
      if (isMappingFailure(error)) {
        return Object.freeze({
          kind: "fail",
          mappingId: descriptor.mappingId as CommanderMappingId,
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
  if (!source.sourceContractId.startsWith("sdar.domain-source/commander/")) {
    throw mappingFailure("SOURCE_CONTRACT_INVALID", "sourceContractId");
  }
  switch (mappingId) {
    case "DP-C01":
      return mapControlAction(source.payload);
    case "DP-C02":
      return mapControlReceipt(source.payload);
    case "DP-C03":
      return mapPhysicalVerification(source.payload);
    case "DP-C04":
      return mapPreemptionRecovery(source.payload);
    case "DP-C05":
      return mapStateFreshness(source);
    default:
      throw mappingFailure("SOURCE_CONTRACT_INVALID", "sourceContractId");
  }
}

function mapControlAction(payload: Readonly<Record<string, unknown>>): CommanderTargetFields {
  const targetEntityId = requiredString(payload, "targetEntityId");
  const targetEntityType = requiredString(payload, "targetEntityType");
  return deepFreeze({
    action_id: requiredString(payload, "actionId"),
    device_id: requiredString(payload, "deviceId"),
    action_type: "device_control",
    action_name: requiredString(payload, "actionName"),
    capability: requiredString(payload, "capabilityRef"),
    resource_channel: requiredString(payload, "resourceChannel"),
    target_id: targetEntityId,
    target_json: canonicalizeDomainProjectionJson({
      entityId: targetEntityId,
      entityType: targetEntityType,
    }),
    risk_level: requiredString(payload, "riskLevel"),
    idempotency_key: requiredString(payload, "idempotencyKey"),
    input_hash: sha256(payload, "parametersHash"),
    side_effect: 1,
    execution_status: requiredString(payload, "dispatchStatus"),
    controller_ref: requiredString(payload, "controlAuthorityRef"),
    basis_id: requiredString(payload, "executionBasisRef"),
    input_summary: stringValue(payload, "inputSummary"),
  });
}

function mapControlReceipt(payload: Readonly<Record<string, unknown>>): CommanderTargetFields {
  requiredString(payload, "deviceId");
  requiredString(payload, "resourceChannel");
  return deepFreeze({
    receipt_id: requiredString(payload, "receiptId"),
    action_id: requiredString(payload, "actionId"),
    provider_id: requiredString(payload, "providerId"),
    provider_request_id: optionalString(payload, "providerRequestId"),
    transport_status: requiredString(payload, "transportStatus"),
    acceptance_status: requiredString(payload, "acceptanceStatus"),
    execution_status: requiredString(payload, "executionStatus"),
    received_at: timestamp(payload, "receivedAt"),
    output_summary: optionalString(payload, "outputSummary"),
    error_code: optionalString(payload, "errorCode"),
    raw_response_ref: optionalString(payload, "rawResponseRef"),
    observed_state_ref: optionalString(payload, "observedStateRef"),
    error_json: canonicalizeDomainProjectionJson(optionalObject(payload, "error")),
    metrics_json: canonicalizeDomainProjectionJson(optionalArray(payload, "metrics")),
  });
}

function mapPhysicalVerification(
  payload: Readonly<Record<string, unknown>>,
): CommanderTargetFields {
  requiredString(payload, "resourceChannel");
  const deviceTimestamp = timestamp(payload, "deviceTimestamp");
  const verifiedAt = timestamp(payload, "verifiedAt");
  const latency = Date.parse(verifiedAt) - Date.parse(deviceTimestamp);
  if (!Number.isSafeInteger(latency) || latency < 0) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", "confirmationLatencyMs");
  }
  return deepFreeze({
    physical_verification_id: requiredString(payload, "physicalVerificationId"),
    verification_id: requiredString(payload, "verificationId"),
    criterion_id: requiredString(payload, "criterionId"),
    action_id: requiredString(payload, "actionId"),
    device_id: requiredString(payload, "deviceId"),
    capability: requiredString(payload, "capability"),
    verification_channel: requiredString(payload, "verificationChannel"),
    expected_json: canonicalizeDomainProjectionJson(requiredJson(payload, "expected")),
    actual_json: canonicalizeDomainProjectionJson(requiredJson(payload, "actual")),
    comparator: requiredString(payload, "comparator"),
    verification_result: exactEnum(payload, "verificationResult", [
      "passed",
      "failed",
      "inconclusive",
      "not_observed",
    ]),
    critical: booleanInt(payload, "critical"),
    stable_duration_ms: optionalUnsignedDecimal(payload, "stableDurationMs", 64),
    device_timestamp: deviceTimestamp,
    verified_at: verifiedAt,
    confirmation_latency_ms: String(latency),
    source_state_id: optionalString(payload, "sourceStateId"),
    evidence_refs: stringArray(payload, "evidenceRefs"),
  });
}

function mapPreemptionRecovery(
  payload: Readonly<Record<string, unknown>>,
): CommanderTargetFields {
  requiredString(payload, "resourceChannel");
  return deepFreeze({
    preemption_id: requiredString(payload, "preemptionId"),
    phase: exactEnum(payload, "phase", [
      "requested",
      "stopping",
      "stopped",
      "recovering",
      "resumed",
      "failed",
    ]),
    device_id: requiredString(payload, "deviceId"),
    trigger_type: requiredString(payload, "triggerType"),
    trigger_event_id: optionalString(payload, "triggerEventId"),
    preempted_basis_id: requiredString(payload, "preemptedBasisId"),
    preempted_basis_version: unsignedDecimal(payload, "preemptedBasisVersion", 32),
    preempted_action_id: requiredString(payload, "preemptedActionId"),
    selected_basis_id: requiredString(payload, "recoveryBasisRef"),
    selected_basis_version: unsignedDecimal(payload, "recoveryBasisVersion", 32),
    selected_intent: requiredString(payload, "selectedIntent"),
    required_deadline_ms: optionalUnsignedDecimal(payload, "requiredDeadlineMs", 64),
    actual_latency_ms: unsignedDecimal(payload, "actualLatencyMs", 64, true),
    stop_confirmed: booleanInt(payload, "stopConfirmed"),
    recovery_strategy: requiredString(payload, "recoveryStrategy"),
    recovery_result: requiredString(payload, "recoveryResult"),
    resumed_basis_id: optionalString(payload, "resumedBasisId"),
    resumed_basis_version: optionalPositiveUInt32(payload, "resumedBasisVersion"),
  });
}

function mapStateFreshness(source: DomainSourceRecord): CommanderTargetFields {
  const payload = source.payload;
  const snapshotId = requiredString(payload, "stateSnapshotId");
  const stateField = requiredString(payload, "stateField");
  requiredString(payload, "entityId");
  requiredString(payload, "deviceId");
  unsignedDecimal(payload, "stateSnapshotVersion", 64);
  requiredString(payload, "thresholdPolicyId");
  unsignedDecimal(payload, "thresholdPolicyVersion", 64);
  const checkIdentity = createCanonicalDomainIdentity({
    tenantId: source.tenantId,
    projectId: source.projectId,
    sourceAgentType: "commander",
    sourceEntityType: "state_freshness_check",
    sourceId: createDerivedDomainSourceId(snapshotId, stateField),
  });
  const observedAt = timestamp(payload, "observedAt");
  const checkedAt = timestamp(payload, "evaluatedAt");
  if (Date.parse(checkedAt) < Date.parse(observedAt)) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", "evaluatedAt");
  }
  return deepFreeze({
    check_id: checkIdentity.targetId,
    state_field: stateField,
    source_component: requiredString(payload, "sourceComponent"),
    observed_at: observedAt,
    checked_at: checkedAt,
    age_ms: unsignedDecimal(payload, "ageMs", 64, true),
    max_allowed_age_ms: unsignedDecimal(payload, "thresholdMs", 64, true),
    check_result: exactEnum(payload, "freshnessResult", ["fresh", "stale", "unknown"]),
    conflict_detected: booleanInt(payload, "conflictDetected"),
    missing: booleanInt(payload, "missing"),
  });
}

function requiredString(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return candidate;
}

function stringValue(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
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

function sha256(value: Readonly<Record<string, unknown>>, field: string): string {
  const candidate = requiredString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return candidate;
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

function unsignedDecimal(
  value: Readonly<Record<string, unknown>>,
  field: string,
  bits: 32 | 64,
  allowZero = false,
): string {
  const candidate = requiredString(value, field);
  const pattern = allowZero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u;
  if (!pattern.test(candidate)) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  if (BigInt(candidate) > (bits === 32 ? MAX_UINT32 : MAX_UINT64)) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return candidate;
}

function optionalPositiveUInt32(
  value: Readonly<Record<string, unknown>>,
  field: string,
): string {
  if (value[field] === undefined || value[field] === "") return "0";
  return unsignedDecimal(value, field, 32);
}

function optionalUnsignedDecimal(
  value: Readonly<Record<string, unknown>>,
  field: string,
  bits: 32 | 64,
): string {
  if (value[field] === undefined) return "0";
  return unsignedDecimal(value, field, bits, true);
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

function booleanInt(value: Readonly<Record<string, unknown>>, field: string): 0 | 1 {
  if (value[field] === true) return 1;
  if (value[field] === false) return 0;
  throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
}

function stringArray(value: Readonly<Record<string, unknown>>, field: string): readonly string[] {
  const candidate = value[field];
  if (
    !Array.isArray(candidate) ||
    candidate.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  return Object.freeze([...candidate]);
}

function requiredJson(value: Readonly<Record<string, unknown>>, field: string): unknown {
  if (!(field in value)) throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  canonicalizeDomainProjectionJson(value[field]);
  return value[field];
}

function optionalObject(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, unknown>> {
  const candidate = value[field];
  if (candidate === undefined) return Object.freeze({});
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  }
  canonicalizeDomainProjectionJson(candidate);
  return candidate as Readonly<Record<string, unknown>>;
}

function optionalArray(value: Readonly<Record<string, unknown>>, field: string): readonly unknown[] {
  const candidate = value[field];
  if (candidate === undefined) return Object.freeze([]);
  if (!Array.isArray(candidate)) throw mappingFailure("MAPPING_REQUIRED_FIELD_MISSING", field);
  canonicalizeDomainProjectionJson(candidate);
  return candidate;
}

type MappingFailure = Error & { code: CommanderMappingFailureCode; field: string };

function mappingFailure(code: CommanderMappingFailureCode, field: string): MappingFailure {
  return Object.assign(new Error(code), { code, field });
}

function isMappingFailure(value: unknown): value is MappingFailure {
  return (
    value instanceof Error &&
    "code" in value &&
    "field" in value &&
    (value.code === "SOURCE_CONTRACT_INVALID" ||
      value.code === "MAPPING_REQUIRED_FIELD_MISSING" ||
      value.code === "MAPPING_ENUM_UNSUPPORTED") &&
    typeof value.field === "string"
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
