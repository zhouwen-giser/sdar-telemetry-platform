import {
  hashCanonicalDomainProjectionJson,
  type DomainSourceSha256,
} from "../../telemetry-contracts/src/index.js";
import {
  DOMAIN_PROJECTION_DESCRIPTORS,
  type DomainProjectionId,
} from "./domain.js";

export type DomainProjectionLifecycleState =
  | "MAPPING_CONTRACT_BLOCKED"
  | "APPROVED_DISABLED"
  | "SHADOW_READ_ONLY"
  | "DRY_RUN"
  | "ACTIVE"
  | "SUSPENDED"
  | "BLOCKED_DRIFT";

export type DomainProjectionModeCap = "disabled" | "shadow" | "dry_run" | "active";

export function domainProjectionMaxModeFromEnv(
  value = process.env.DOMAIN_PROJECTION_MAX_MODE,
): DomainProjectionModeCap {
  if (value === undefined || value === "") return "shadow";
  if (value === "disabled" || value === "shadow" || value === "dry_run" || value === "active") {
    return value;
  }
  throw lifecycleError("PROJECTION_MODE_CAP_INVALID");
}

export type DomainProjectionLifecycle = Readonly<{
  projectionId: DomainProjectionId;
  projectionVersion: 1;
  state: DomainProjectionLifecycleState;
  revision: number;
  definitionHash: DomainSourceSha256;
  mappingHash: DomainSourceSha256;
  lastActionId: string;
  lastActionHash: DomainSourceSha256 | null;
}>;

export type DomainProjectionActivationGuard = Readonly<{
  expectedReleaseHash: DomainSourceSha256;
  actualReleaseHash: DomainSourceSha256;
  expectedSchemaHash: DomainSourceSha256;
  actualSchemaHash: DomainSourceSha256;
  expectedDefinitionHash: DomainSourceSha256;
  expectedMappingHash: DomainSourceSha256;
  sourceContractApproved: boolean;
  payloadContractApproved: boolean;
  targetContractApproved: boolean;
  activeProducerRegistered: boolean;
  fixtureQualificationMode: boolean;
  schemaDrift: boolean;
  maxMode: DomainProjectionModeCap;
}>;

export type DomainProjectionLifecycleAction = Readonly<{
  actionId: string;
  expectedRevision: number;
  action:
    | "approve_definition"
    | "set_shadow"
    | "set_dry_run"
    | "set_active"
    | "suspend"
    | "resume"
    | "block_drift";
}>;

export function transitionDomainProjectionLifecycle(
  current: DomainProjectionLifecycle,
  action: DomainProjectionLifecycleAction,
  guard: DomainProjectionActivationGuard,
): DomainProjectionLifecycle {
  assertLifecycleInput(current, action);
  const actionHash = hashCanonicalDomainProjectionJson(action);
  if (current.lastActionId === action.actionId) {
    if (current.lastActionHash !== actionHash) {
      throw lifecycleError("PROJECTION_ACTION_ID_CONFLICT");
    }
    return current;
  }
  if (current.revision !== action.expectedRevision) {
    throw lifecycleError("PROJECTION_REVISION_CONFLICT");
  }
  const target = transitionTarget(current.state, action.action);
  if (action.action === "block_drift") {
    if (!guard.schemaDrift) throw lifecycleError("PROJECTION_DRIFT_NOT_OBSERVED");
  } else {
    assertActivationGuard(current, guard);
    assertModeAllowed(target, guard.maxMode);
  }
  return Object.freeze({
    ...current,
    state: target,
    revision: current.revision + 1,
    lastActionId: action.actionId,
    lastActionHash: actionHash,
  });
}

export type DomainProjectionSetId =
  | "commander-standard"
  | "npc-standard"
  | "embodied-standard"
  | "embodied-diagnostic";

export type DomainProjectionSetDefinition = Readonly<{
  setId: DomainProjectionSetId;
  version: "1" | "0.1";
  contentHash: DomainSourceSha256;
  members: readonly Readonly<{
    projectionId: DomainProjectionId;
    requirement: "required" | "diagnostic";
  }>[];
}>;

export const DOMAIN_PROJECTION_SET_DEFINITIONS: readonly DomainProjectionSetDefinition[] =
  Object.freeze([
    setDefinition(
      "commander-standard",
      "1",
      "sha256:7fedf9cf60960dd451b5289c1b979d979bdaeb92f8de56c73e11fc39e75ebfce",
      [
        "application_to_embodied.dp-c01",
        "application_to_embodied.dp-c02",
        "application_to_embodied.dp-c03",
        "application_to_embodied.dp-c04",
        "application_to_embodied.dp-c05",
      ],
      "required",
    ),
    setDefinition(
      "npc-standard",
      "1",
      "sha256:7acc53cbc1ebee9ed765853da5080c03613c72f480e13440ff185a7686bfbc28",
      [
        "application_to_embodied.dp-n01",
        "application_to_embodied.dp-n02",
        "application_to_embodied.dp-n03",
        "application_to_embodied.dp-n04",
        "application_to_embodied.dp-n05",
      ],
      "required",
    ),
    setDefinition(
      "embodied-standard",
      "1",
      "sha256:6fd248c5b13bb7c5784560f6f540532cbd307cac77fde9248abf850c1494e0bb",
      DOMAIN_PROJECTION_DESCRIPTORS.map(
        (descriptor) => descriptor.definition.projectionId as DomainProjectionId,
      ),
      "required",
    ),
    setDefinition(
      "embodied-diagnostic",
      "0.1",
      "sha256:c245d9bd5939d04a61d10e1bc50ae5c1053ddff6b453c8954ad30462eaaf68cb",
      [
        "application_to_embodied.dp-c02",
        "application_to_embodied.dp-c05",
        "application_to_embodied.dp-n02",
        "application_to_embodied.dp-n03",
      ],
      "diagnostic",
    ),
  ]);

export type DomainProjectionReadinessMember = Readonly<{
  projectionId: DomainProjectionId;
  state: DomainProjectionLifecycleState;
  sourceCount: number;
  terminalCount: number;
  blockingDeadLetterCount: number;
  schemaDrift: boolean;
  episodeSealVerified: boolean;
}>;

export type DomainProjectionSetReadiness = Readonly<{
  setId: DomainProjectionSetId;
  version: string;
  status: "not_required" | "not_ready" | "degraded" | "ready" | "blocked_drift";
  reasonCodes: readonly string[];
  expectedMemberCount: number;
  observedMemberCount: number;
}>;

export function evaluateDomainProjectionSetReadiness(input: Readonly<{
  definition: DomainProjectionSetDefinition;
  members: readonly DomainProjectionReadinessMember[];
  formalDomainRequired: boolean;
}>): DomainProjectionSetReadiness {
  if (!input.formalDomainRequired) {
    return readiness(input, "not_required", ["DOMAIN_NOT_REQUIRED"]);
  }
  const memberById = new Map(input.members.map((member) => [member.projectionId, member]));
  const relevant = input.definition.members.map((entry) => ({
    entry,
    member: memberById.get(entry.projectionId),
  }));
  if (relevant.some(({ member }) => member?.schemaDrift || member?.state === "BLOCKED_DRIFT")) {
    return readiness(input, "blocked_drift", ["SCHEMA_CONTRACT_DRIFT"]);
  }
  const reasons = new Set<string>();
  for (const { entry, member } of relevant) {
    if (member === undefined) reasons.add("PROJECTION_MEMBER_MISSING");
    else {
      if (member.state !== "ACTIVE") reasons.add("PROJECTION_NOT_ACTIVE");
      if (member.sourceCount === 0) reasons.add("SOURCE_EMPTY");
      if (member.terminalCount < member.sourceCount) reasons.add("TERMINAL_COVERAGE_INCOMPLETE");
      if (member.blockingDeadLetterCount > 0) reasons.add("BLOCKING_DLQ_OPEN");
      if (!member.episodeSealVerified) reasons.add("EPISODE_SEAL_UNVERIFIED");
      if (entry.requirement === "diagnostic" && reasons.size > 0) {
        reasons.add("DIAGNOSTIC_GAP");
      }
    }
  }
  const orderedReasons = [...reasons].sort();
  if (orderedReasons.length === 0) return readiness(input, "ready", []);
  const requiredGap = relevant.some(
    ({ entry, member }) =>
      entry.requirement === "required" &&
      (member === undefined ||
        member.state !== "ACTIVE" ||
        member.sourceCount === 0 ||
        member.terminalCount < member.sourceCount ||
        member.blockingDeadLetterCount > 0 ||
        !member.episodeSealVerified),
  );
  return readiness(input, requiredGap ? "not_ready" : "degraded", orderedReasons);
}

function transitionTarget(
  state: DomainProjectionLifecycleState,
  action: DomainProjectionLifecycleAction["action"],
): DomainProjectionLifecycleState {
  const transitions: Readonly<Record<string, DomainProjectionLifecycleState>> = {
    "MAPPING_CONTRACT_BLOCKED:approve_definition": "APPROVED_DISABLED",
    "APPROVED_DISABLED:set_shadow": "SHADOW_READ_ONLY",
    "SHADOW_READ_ONLY:set_dry_run": "DRY_RUN",
    "DRY_RUN:set_active": "ACTIVE",
    "ACTIVE:suspend": "SUSPENDED",
    "SUSPENDED:resume": "SHADOW_READ_ONLY",
    "BLOCKED_DRIFT:resume": "APPROVED_DISABLED",
    "APPROVED_DISABLED:block_drift": "BLOCKED_DRIFT",
    "SHADOW_READ_ONLY:block_drift": "BLOCKED_DRIFT",
    "DRY_RUN:block_drift": "BLOCKED_DRIFT",
    "ACTIVE:block_drift": "BLOCKED_DRIFT",
    "SUSPENDED:block_drift": "BLOCKED_DRIFT",
  };
  const target = transitions[`${state}:${action}`];
  if (target === undefined) throw lifecycleError("PROJECTION_TRANSITION_FORBIDDEN");
  return target;
}

function assertActivationGuard(
  current: DomainProjectionLifecycle,
  guard: DomainProjectionActivationGuard,
): void {
  if (
    guard.expectedReleaseHash !== guard.actualReleaseHash ||
    guard.expectedSchemaHash !== guard.actualSchemaHash ||
    current.definitionHash !== guard.expectedDefinitionHash ||
    current.mappingHash !== guard.expectedMappingHash
  ) {
    throw lifecycleError("PROJECTION_ACTIVATION_HASH_MISMATCH");
  }
  if (
    !guard.sourceContractApproved ||
    !guard.payloadContractApproved ||
    !guard.targetContractApproved ||
    (!guard.activeProducerRegistered && !guard.fixtureQualificationMode)
  ) {
    throw lifecycleError("PROJECTION_ACTIVATION_PREREQUISITE_MISSING");
  }
  if (guard.schemaDrift) throw lifecycleError("PROJECTION_BLOCKED_DRIFT");
}

function assertModeAllowed(
  target: DomainProjectionLifecycleState,
  cap: DomainProjectionModeCap,
): void {
  const level: Readonly<Record<DomainProjectionModeCap, number>> = {
    disabled: 0,
    shadow: 1,
    dry_run: 2,
    active: 3,
  };
  const targetLevel =
    target === "ACTIVE" ? 3 : target === "DRY_RUN" ? 2 : target === "SHADOW_READ_ONLY" ? 1 : 0;
  if (targetLevel > level[cap]) throw lifecycleError("PROJECTION_MODE_CAP_EXCEEDED");
}

function assertLifecycleInput(
  current: DomainProjectionLifecycle,
  action: DomainProjectionLifecycleAction,
): void {
  if (
    current.projectionId.trim() === "" ||
    !Number.isSafeInteger(current.revision) ||
    current.revision < 0 ||
    action.actionId.trim() === "" ||
    !Number.isSafeInteger(action.expectedRevision) ||
    action.expectedRevision < 0
  ) {
    throw lifecycleError("PROJECTION_ACTION_INVALID");
  }
}

function setDefinition(
  setId: DomainProjectionSetId,
  version: "1" | "0.1",
  contentHash: DomainSourceSha256,
  ids: readonly DomainProjectionId[],
  requirement: "required" | "diagnostic",
): DomainProjectionSetDefinition {
  return Object.freeze({
    setId,
    version,
    contentHash,
    members: Object.freeze(ids.map((projectionId) => Object.freeze({ projectionId, requirement }))),
  });
}

function readiness(
  input: Readonly<{
    definition: DomainProjectionSetDefinition;
    members: readonly DomainProjectionReadinessMember[];
  }>,
  status: DomainProjectionSetReadiness["status"],
  reasonCodes: readonly string[],
): DomainProjectionSetReadiness {
  const expectedIds = new Set(input.definition.members.map((entry) => entry.projectionId));
  return Object.freeze({
    setId: input.definition.setId,
    version: input.definition.version,
    status,
    reasonCodes: Object.freeze([...reasonCodes]),
    expectedMemberCount: input.definition.members.length,
    observedMemberCount: new Set(
      input.members
        .filter((member) => expectedIds.has(member.projectionId))
        .map((member) => member.projectionId),
    ).size,
  });
}

function lifecycleError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
