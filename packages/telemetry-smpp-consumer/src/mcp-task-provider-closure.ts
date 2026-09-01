import { hashCanonicalDomainProjectionJson as hash } from "../../telemetry-contracts/src/index.js";
import type {
  ProviderClosureFact,
  ProviderReconciliationHint,
  ProviderRemoteTaskBinding,
  ProviderRuntimeEvidence,
  ProviderTaskSemanticClosure,
} from "./closure-v2.js";

const TASK_EXECUTION_SOURCES = new Set([
  "smpp_runtime_committed_binding",
  "smpp_runtime_reconciliation_found",
]);

export function buildProviderTaskSemantics(input: {
  readonly bindings: readonly ProviderRemoteTaskBinding[];
  readonly facts: readonly ProviderClosureFact[];
  readonly relations: readonly ProviderReconciliationHint[];
  readonly runtimeEvidence: readonly ProviderRuntimeEvidence[];
}): readonly ProviderTaskSemanticClosure[] {
  return Object.freeze(input.bindings.map((binding) => buildOne(binding, input.facts, input.relations, input.runtimeEvidence)));
}

function buildOne(
  binding: ProviderRemoteTaskBinding,
  allFacts: readonly ProviderClosureFact[],
  allRelations: readonly ProviderReconciliationHint[],
  allRuntimeEvidence: readonly ProviderRuntimeEvidence[],
): ProviderTaskSemanticClosure {
  const facts = allFacts.filter((fact) =>
    fact.tenantId === binding.tenantId &&
    fact.projectId === binding.projectId &&
    fact.environment === binding.environment &&
    fact.externalTaskId === binding.remoteTaskId &&
    fact.smppSourceId === binding.providerOriginSourceId &&
    fact.providerId === binding.externalProviderId &&
    (binding.externalProviderInstanceId === undefined ||
      fact.providerInstanceId === binding.externalProviderInstanceId),
  );
  const relations = allRelations.filter((relation) =>
    relation.evidenceFactIds.some((factId) => facts.some((fact) => fact.factId === factId)),
  );
  const admissions = allRuntimeEvidence.filter((item) =>
    item.recordType === "mcp_task.admission" && item.payload["bindingId"] === binding.bindingId,
  );
  const intentIds = new Set(admissions.flatMap((item) => textValue(item.payload["intentId"])));
  const runtimeUncertainties = allRuntimeEvidence.filter((item) =>
    item.recordType === "mcp_task.dispatch_uncertain" &&
    textValue(item.payload["intentId"]).some((intentId) => intentIds.has(intentId)),
  );
  const runtimeReconciliations = allRuntimeEvidence.filter((item) =>
    item.recordType === "mcp_task.dispatch_reconciliation" &&
    textValue(item.payload["intentId"]).some((intentId) => intentIds.has(intentId)),
  );
  const bindingRuntimeLinks = allRuntimeEvidence.filter((item) =>
    item.recordType === "mcp_task.provider_execution_link" && item.payload["bindingId"] === binding.bindingId,
  );
  const runtimeLinks = bindingRuntimeLinks.filter((item) =>
    item.payload["remoteTaskId"] === binding.remoteTaskId &&
    item.payload["providerId"] === binding.externalProviderId &&
    item.payload["smppSourceId"] === binding.providerOriginSourceId &&
    (binding.externalProviderInstanceId === undefined ||
      item.payload["externalServerId"] === binding.externalProviderInstanceId) &&
    ((binding.authoritativeOriginRuntimeIds?.length ?? 0) === 0 ||
      textValue(item.payload["runtimeServerId"]).some((runtimeId) =>
        binding.authoritativeOriginRuntimeIds?.includes(runtimeId) === true)),
  );
  const runtimeControls = allRuntimeEvidence.filter((item) =>
    item.recordType === "mcp_task.control_event" && item.payload["bindingId"] === binding.bindingId,
  );
  const exactTaskRelations = relations.filter((relation) =>
    relation.relationType === "task_execution_binding" &&
    relation.sourceEntityType === "task" &&
    relation.sourceEntityId === binding.remoteTaskId &&
    relation.targetEntityType === "execution" &&
    relation.confidenceClass === "authoritative" &&
    TASK_EXECUTION_SOURCES.has(relation.bindingSource),
  );
  const candidateIds = normalized([
    ...facts.flatMap((fact) => fact.externalExecutionId === undefined ? [] : [fact.externalExecutionId]),
    ...exactTaskRelations.flatMap((relation) => relation.targetEntityId === undefined ? [] : [relation.targetEntityId]),
    ...runtimeLinks.flatMap((item) => item.payload["executionStatus"] === "exact"
      ? textValue(item.payload["externalExecutionId"])
      : []),
  ]);
  const sourceFactIds = normalized(facts
    .filter((fact) => fact.externalExecutionId !== undefined)
    .map((fact) => fact.factId));
  const sourceRelationIds = normalized([
    ...exactTaskRelations.map((relation) => relation.relationId),
    ...runtimeLinks.map((item) => item.rowId),
  ]);
  const factIdentityConflict = hasIdentityHashConflict(facts.map((fact) => ({
    id: fact.factId,
    hash: fact.factHash,
  })));
  const relationIdentityConflict = hasIdentityHashConflict(exactTaskRelations.map((relation) => ({
    id: relation.relationId,
    hash: relation.sourceRecordHash,
  })));
  const runtimeIdentityConflict = hasIdentityHashConflict(runtimeLinks.map((item) => ({
    id: item.sourceRecordId,
    hash: item.payloadHash,
  })));
  const explicitRuntimeExecutionConflict = runtimeLinks.some((item) => item.payload["executionStatus"] === "conflict") ||
    bindingRuntimeLinks.length !== runtimeLinks.length;
  const identityConflict = factIdentityConflict || relationIdentityConflict || runtimeIdentityConflict;
  const executionStatus = identityConflict || explicitRuntimeExecutionConflict || candidateIds.length > 1
    ? "conflict" as const
    : candidateIds.length === 1
      ? "exact" as const
      : "unresolved" as const;
  const taskExecutionBase = {
    bindingId: binding.bindingId,
    remoteTaskId: binding.remoteTaskId,
    providerSourceId: binding.providerOriginSourceId,
    providerId: binding.externalProviderId,
    ...(binding.externalProviderInstanceId === undefined ? {} : {
      providerInstanceId: binding.externalProviderInstanceId,
    }),
    candidateExecutionIds: candidateIds,
    ...(executionStatus === "exact" ? { selectedExecutionId: candidateIds[0] } : {}),
    sourceFactIds,
    sourceRelationIds,
    status: executionStatus,
    identityConflict,
  };
  const taskExecution = Object.freeze({ ...taskExecutionBase, contentHash: hash(taskExecutionBase) });

  const uncertainties = facts.filter((fact) => fact.providerOpsSemantics?.uncertainty !== undefined);
  const reconciliations = facts.filter((fact) => fact.providerOpsSemantics?.reconciliation !== undefined);
  const reconcileStatuses = normalized(reconciliations.flatMap((fact) => {
    const value = fact.providerOpsSemantics?.reconciliation?.status;
    return value === undefined ? [] : [value];
  }));
  const recoveredIds = normalized(reconciliations.flatMap((fact) => {
    const value = fact.providerOpsSemantics?.reconciliation;
    return value?.status === "found" && value.identityValidated && value.externalExecutionId !== undefined
      ? [value.externalExecutionId]
      : [];
  }));
  const runtimeReconcileStatuses = runtimeReconciliations.flatMap((item) => textValue(item.payload["status"]));
  const runtimeRecoveredIds = runtimeReconciliations.flatMap((item) =>
    item.payload["status"] === "found_exact" && item.payload["identityValidated"] === true &&
      item.payload["remoteTaskId"] === binding.remoteTaskId
      ? textValue(item.payload["externalExecutionId"])
      : []);
  const reconciliationStatus = runtimeReconcileStatuses.length > 0
    ? reconcileRuntimeState(runtimeReconcileStatuses, runtimeRecoveredIds, taskExecution.selectedExecutionId)
    : reconcileState(reconcileStatuses, recoveredIds, taskExecution.selectedExecutionId);
  const uncertaintyPresent = runtimeUncertainties.length > 0 || uncertainties.length > 0;
  const reconciliationPresent = runtimeReconciliations.length > 0 || reconciliations.length > 0;
  const dispatchStatus = !uncertaintyPresent
    ? "certain" as const
    : reconciliationStatus === "found_exact"
      ? "recovered" as const
      : reconciliationStatus === "conflict"
        ? "conflict" as const
        : !reconciliationPresent
          ? "uncertain" as const
          : "unresolved" as const;

  const terminals = facts.filter((fact) => fact.providerOpsSemantics?.businessTerminal !== undefined);
  const terminalValues = terminals.map((fact) => fact.providerOpsSemantics!.businessTerminal!);
  const terminalTuples = normalized(terminalValues.map((value) => JSON.stringify({
    mcpTaskStatus: value.mcpTaskStatus,
    transportStatus: value.transportStatus,
    providerExecutionStatus: value.providerExecutionStatus,
    businessStatus: value.businessStatus,
  })));
  const terminalConflict = terminalTuples.length > 1;
  const terminalValue = terminalConflict ? undefined : terminalValues[0];
  const runtimeControlStates = normalized(runtimeControls.flatMap((item) =>
    controlState(item.payload["eventType"])));
  const runtimeControlConflict = runtimeControlStates.length > 1;
  const runtimeControlState = runtimeControlConflict ? "conflict" : runtimeControlStates[0];

  const selectedExecutionId = taskExecution.selectedExecutionId;
  const missionFacts = facts.filter((fact) =>
    fact.providerOpsSemantics?.missionRelation !== undefined &&
    (selectedExecutionId === undefined ||
      fact.providerOpsSemantics.missionRelation.externalExecutionId === selectedExecutionId),
  );
  const latestMissionFact = selectLatestMissionFact(missionFacts);
  const latestMission = latestMissionFact?.providerOpsSemantics?.missionRelation;
  const exactMissionRelations = relations.filter((relation) =>
    latestMissionFact !== undefined &&
    latestMission?.relationStatus === "exact" &&
    relation.evidenceFactIds.includes(latestMissionFact.factId) &&
    relation.relationType === "execution_mission_binding" &&
    relation.sourceEntityType === "execution" &&
    relation.sourceEntityId === selectedExecutionId &&
    relation.targetEntityType === "device_mission" &&
    relation.bindingSource === "provider_authoritative_mission_identity" &&
    relation.confidenceClass === "authoritative",
  );
  const runtimeMissionLinks = runtimeLinks.filter((item) =>
    selectedExecutionId !== undefined && item.payload["externalExecutionId"] === selectedExecutionId,
  );
  const providerMissionIds = latestMission?.relationStatus === "exact"
    ? normalized([
        ...(latestMission.deviceMissionId === undefined ? [] : [latestMission.deviceMissionId]),
        ...exactMissionRelations.flatMap((relation) =>
          relation.targetEntityId === undefined ? [] : [relation.targetEntityId]),
      ])
    : Object.freeze([]) as readonly string[];
  const runtimeMissionIds = normalized(runtimeMissionLinks.flatMap((item) =>
    item.payload["missionStatus"] === "exact" ? textValue(item.payload["deviceMissionId"]) : []));
  const missionIds = latestMission === undefined ? runtimeMissionIds : providerMissionIds;
  const runtimeMissionConflict = runtimeMissionLinks.some((item) => item.payload["missionStatus"] === "conflict");
  const runtimeMissionUnresolved = runtimeMissionLinks.some((item) => item.payload["missionStatus"] === "unresolved");
  const missionStatus = latestMission !== undefined
    ? latestMission.relationStatus === "conflict" || providerMissionIds.length > 1
      ? "conflict" as const
      : latestMission.relationStatus === "exact" && providerMissionIds.length === 1
        ? "exact" as const
        : "unresolved" as const
    : runtimeMissionConflict || missionIds.length > 1
      ? "conflict" as const
      : missionIds.length === 1
        ? "exact" as const
        : runtimeMissionUnresolved
          ? "unresolved" as const
          : "not_required" as const;

  const reasonCodes = new Set<string>();
  if (executionStatus === "unresolved") reasonCodes.add("SMPP_PROVIDER_EXECUTION_MISSING");
  if (executionStatus === "conflict") reasonCodes.add(identityConflict
    ? "SMPP_PROVIDER_IDENTITY_HASH_CONFLICT"
    : "SMPP_PROVIDER_EXECUTION_CONFLICT");
  if (uncertaintyPresent) reasonCodes.add("SMPP_DISPATCH_UNCERTAIN");
  if (dispatchStatus === "recovered") reasonCodes.add("SMPP_DISPATCH_RECOVERED");
  if (dispatchStatus === "unresolved" || dispatchStatus === "uncertain") {
    reasonCodes.add("SMPP_RECONCILIATION_UNRESOLVED");
  }
  if (dispatchStatus === "conflict") reasonCodes.add("SMPP_RECONCILIATION_CONFLICT");
  if (terminalConflict || runtimeControlConflict) reasonCodes.add("SMPP_PROVIDER_TERMINAL_CONFLICT");
  if (missionStatus === "conflict") reasonCodes.add("SMPP_PROVIDER_MISSION_CONFLICT");

  const value = {
    bindingId: binding.bindingId,
    taskExecution,
    dispatch: Object.freeze({
      status: dispatchStatus,
      reconciliationStatus,
      uncertaintyFactIds: Object.freeze(normalized([
        ...uncertainties.map((fact) => fact.factId),
        ...runtimeUncertainties.map((item) => item.rowId),
      ])),
      reconciliationFactIds: Object.freeze(normalized([
        ...reconciliations.map((fact) => fact.factId),
        ...runtimeReconciliations.map((item) => item.rowId),
      ])),
    }),
    terminal: Object.freeze({
      mcpTaskControlState: runtimeControlState ?? terminalValue?.mcpTaskStatus ?? "unknown",
      dispatchTransportState: dispatchStatus,
      providerExecutionState: terminalValue?.providerExecutionStatus ?? "unknown",
      providerBusinessOutcome: terminalValue?.businessStatus ?? "unknown",
      terminalFactIds: Object.freeze(normalized([
        ...terminals.map((fact) => fact.factId),
        ...runtimeControls.map((item) => item.rowId),
      ])),
      conflict: terminalConflict || runtimeControlConflict,
    }),
    mission: Object.freeze({
      status: missionStatus,
      deviceMissionIds: Object.freeze(missionIds),
      sourceFactIds: Object.freeze(latestMissionFact === undefined ? [] : [latestMissionFact.factId]),
      sourceRelationIds: Object.freeze(exactMissionRelations.map((relation) => relation.relationId).sort()),
    }),
    reasonCodes: Object.freeze([...reasonCodes].sort()),
  };
  return Object.freeze({ ...value, contentHash: hash(value) });
}

function selectLatestMissionFact(
  facts: readonly ProviderClosureFact[],
): ProviderClosureFact | undefined {
  return facts.reduce<ProviderClosureFact | undefined>((latest, candidate) => {
    if (latest === undefined) return candidate;
    const latestObservedAt = latest.providerOpsSemantics?.missionRelation?.observedAt ?? latest.observedAt ?? "";
    const candidateObservedAt = candidate.providerOpsSemantics?.missionRelation?.observedAt ?? candidate.observedAt ?? "";
    if (candidateObservedAt !== latestObservedAt) {
      return candidateObservedAt > latestObservedAt ? candidate : latest;
    }
    return candidate.sourceRecordId > latest.sourceRecordId ? candidate : latest;
  }, undefined);
}

function reconcileState(
  statuses: readonly string[],
  recoveredIds: readonly string[],
  selectedExecutionId: string | undefined,
): ProviderTaskSemanticClosure["dispatch"]["reconciliationStatus"] {
  if (statuses.length === 0) return "not_required";
  if (statuses.includes("conflict") || recoveredIds.length > 1) return "conflict";
  if (statuses.includes("found")) {
    return recoveredIds.length === 1 && recoveredIds[0] === selectedExecutionId
      ? "found_exact"
      : "conflict";
  }
  if (statuses.includes("not_found")) return "not_found";
  if (statuses.includes("deferred")) return "deferred";
  if (statuses.includes("transient_unavailable")) return "unavailable";
  return "attempted";
}

function reconcileRuntimeState(
  statuses: readonly string[],
  recoveredIds: readonly string[],
  selectedExecutionId: string | undefined,
): ProviderTaskSemanticClosure["dispatch"]["reconciliationStatus"] {
  if (statuses.includes("conflict") || normalized(recoveredIds).length > 1) return "conflict";
  if (statuses.includes("found_exact")) {
    const exact = normalized(recoveredIds);
    return exact.length === 1 && exact[0] === selectedExecutionId ? "found_exact" : "conflict";
  }
  if (statuses.includes("not_found")) return "not_found";
  if (statuses.includes("deferred")) return "deferred";
  if (statuses.includes("unavailable")) return "unavailable";
  return "attempted";
}

function controlState(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  const match = /^task\.(input_required|completed|failed|cancelled)$/u.exec(value);
  return match?.[1] === undefined ? [] : [match[1]];
}

function textValue(value: unknown): readonly string[] {
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

function hasIdentityHashConflict(values: readonly { readonly id: string; readonly hash: string }[]): boolean {
  const seen = new Map<string, string>();
  for (const value of values) {
    const prior = seen.get(value.id);
    if (prior !== undefined && prior !== value.hash) return true;
    seen.set(value.id, value.hash);
  }
  return false;
}

function normalized(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value) => value.length > 0))].sort());
}
