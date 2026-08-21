export const SMPP_PROVIDEROPS_CONTRACT = "smpp.providerops/v1.1";

export * from "./closure-v2.js";

export type McpProviderReadinessStatus =
  | "not_required"
  | "not_ready"
  | "degraded"
  | "ready"
  | "conflict";

export interface SmppProviderFact {
  readonly fact_id: string;
  readonly fact_hash: string;
  readonly fact_type: string;
  readonly smpp_source_id: string;
  readonly external_task_id?: string;
  readonly external_execution_id?: string;
  readonly external_command_id?: string;
  readonly lifecycle_status?: string;
  readonly provider_revision?: string;
  readonly runtime_revision?: string;
  readonly occurred_at: string;
  readonly projected_at: string;
  readonly relation_id?: string;
}

export interface SmppEntityRelation {
  readonly relation_id: string;
  readonly relation_type: string;
  readonly source_entity_type: string;
  readonly source_entity_id: string;
  readonly target_entity_type: string;
  readonly target_entity_id: string;
  readonly evidence_fact_ids: readonly string[];
  readonly source_record_hash: string;
  readonly projection_id: string;
  readonly projection_version: number;
}

export interface SmppFactFilter {
  readonly factId?: string;
  readonly smppSourceId?: string;
  readonly providerId?: string;
  readonly externalTaskId?: string;
  readonly resourceId?: string;
  readonly externalExecutionId?: string;
  readonly limit: number;
}

export interface SmppRelationFilter {
  readonly smppSourceId?: string;
  readonly relationType?: string;
  readonly sourceEntityType?: string;
  readonly sourceEntityId?: string;
  readonly targetEntityType?: string;
  readonly targetEntityId?: string;
  readonly limit: number;
}

export interface SmppExternalFactSource {
  list(filter: SmppFactFilter): Promise<readonly SmppProviderFact[]>;
  get(factId: string): Promise<SmppProviderFact | null>;
}

export interface SmppRelationSource {
  list(filter: SmppRelationFilter): Promise<readonly SmppEntityRelation[]>;
}

export interface SmppEpisodeBinding {
  readonly episodeId: string;
  readonly taskId: string;
  readonly externalTaskId: string;
  readonly runtimeStatus: string;
  readonly runtimeRevision?: string;
}

export interface SmppEpisodeBindingSource {
  listByEpisode(episodeId: string): Promise<readonly SmppEpisodeBinding[]>;
}

export interface McpProviderReconciliationIssue {
  readonly code:
    | "SMPP_PROVIDER_TELEMETRY_MISSING"
    | "SMPP_RELATION_AMBIGUOUS"
    | "SMPP_PROVIDER_TERMINAL_MISMATCH"
    | "SMPP_REVISION_MISMATCH"
    | "SMPP_SOURCE_CONTENT_CONFLICT"
    | "SMPP_FACT_CONTENT_CONFLICT";
  readonly blocking: boolean;
  readonly identity: string;
}

export interface McpProviderReadiness {
  readonly status: McpProviderReadinessStatus;
  readonly reasonCodes: readonly string[];
  readonly providerFactCount: number;
  readonly relationCount: number;
  readonly watermark: string | null;
  readonly sourceContract: typeof SMPP_PROVIDEROPS_CONTRACT;
  readonly goalSuccessProven: false;
  readonly physicalSuccessProven: false;
}

export interface McpProviderTelemetrySnapshot {
  readonly episodeId: string;
  readonly facts: readonly SmppProviderFact[];
  readonly relations: readonly SmppEntityRelation[];
  readonly issues: readonly McpProviderReconciliationIssue[];
  readonly readiness: McpProviderReadiness;
}

export async function assembleMcpProviderTelemetry(input: {
  readonly episodeId: string;
  readonly required: boolean;
  readonly bindings: SmppEpisodeBindingSource;
  readonly facts: SmppExternalFactSource;
  readonly relations: SmppRelationSource;
}): Promise<McpProviderTelemetrySnapshot> {
  const bindings = await input.bindings.listByEpisode(input.episodeId);
  const relationsById = new Map<string, SmppEntityRelation>();
  for (const binding of bindings) {
    const relations = await input.relations.list({
      sourceEntityType: "task",
      sourceEntityId: binding.taskId,
      limit: 1_000,
    });
    for (const relation of relations) relationsById.set(relation.relation_id, relation);
  }

  const relations = [...relationsById.values()];
  const factsById = new Map<string, SmppProviderFact>();
  for (const relation of relations) {
    for (const factId of relation.evidence_fact_ids) {
      const fact = await input.facts.get(factId);
      if (fact !== null) factsById.set(fact.fact_id, fact);
    }
  }
  const facts = [...factsById.values()];
  const issues = reconcileMcpProviderTelemetry({
    runtimeBindings: bindings.map((binding) => ({
      externalTaskId: binding.externalTaskId,
      runtimeStatus: binding.runtimeStatus,
      ...(binding.runtimeRevision === undefined
        ? {}
        : {runtimeRevision: binding.runtimeRevision}),
    })),
    facts,
    relations,
  });
  return Object.freeze({
    episodeId: input.episodeId,
    facts: Object.freeze(facts),
    relations: Object.freeze(relations),
    issues,
    readiness: evaluateMcpProviderReadiness({
      required: input.required,
      facts,
      relations,
      issues,
    }),
  });
}

const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "rejected",
  "expired",
]);

export function evaluateMcpProviderReadiness(input: {
  readonly required: boolean;
  readonly facts: readonly SmppProviderFact[];
  readonly relations: readonly SmppEntityRelation[];
  readonly issues?: readonly McpProviderReconciliationIssue[];
}): McpProviderReadiness {
  const issues = input.issues ?? [];
  const watermark = latest(input.facts.map((fact) => fact.projected_at));
  const base = {
    providerFactCount: input.facts.length,
    relationCount: input.relations.length,
    watermark,
    sourceContract: SMPP_PROVIDEROPS_CONTRACT as typeof SMPP_PROVIDEROPS_CONTRACT,
    goalSuccessProven: false as const,
    physicalSuccessProven: false as const,
  };
  if (!input.required) return {...base, status: "not_required", reasonCodes: []};

  const conflicts = issues.filter((issue) => issue.blocking || issue.code.includes("CONFLICT"));
  const factConflicts = conflictingFacts(input.facts);
  const terminalConflicts = conflictingTaskTerminals(input.facts);
  if (conflicts.length > 0 || factConflicts || terminalConflicts) {
    return {
      ...base,
      status: "conflict",
      reasonCodes: [
        ...new Set([
          ...conflicts.map((issue) => issue.code),
          ...(factConflicts ? ["SMPP_FACT_CONTENT_CONFLICT"] : []),
          ...(terminalConflicts ? ["SMPP_PROVIDER_TERMINAL_MISMATCH"] : []),
        ]),
      ],
    };
  }

  const hasTaskRelation = input.relations.some(
    (relation) => relation.source_entity_type === "task" || relation.target_entity_type === "task",
  );
  const hasTerminalTask = input.facts.some(
    (fact) =>
      fact.fact_type === "provider.task.lifecycle" &&
      terminalStatuses.has((fact.lifecycle_status ?? "").toLowerCase()),
  );
  if (input.facts.length === 0 || !hasTaskRelation || !hasTerminalTask) {
    return {
      ...base,
      status: "not_ready",
      reasonCodes: [
        ...(input.facts.length === 0 ? ["SMPP_PROVIDER_TELEMETRY_MISSING"] : []),
        ...(!hasTaskRelation ? ["SMPP_RELATION_AMBIGUOUS"] : []),
        ...(!hasTerminalTask ? ["SMPP_PROVIDER_TERMINAL_MISSING"] : []),
      ],
    };
  }

  const supportingTypes = new Set(input.facts.map((fact) => fact.fact_type));
  const supportingComplete =
    supportingTypes.has("provider.command.lifecycle") &&
    (supportingTypes.has("provider.execution.progress") ||
      supportingTypes.has("provider.resource.health"));
  if (!supportingComplete) {
    return {...base, status: "degraded", reasonCodes: ["SMPP_SUPPORTING_TELEMETRY_INCOMPLETE"]};
  }
  return {...base, status: "ready", reasonCodes: []};
}

export function reconcileMcpProviderTelemetry(input: {
  readonly runtimeBindings: readonly {
    readonly externalTaskId: string;
    readonly runtimeStatus: string;
    readonly runtimeRevision?: string;
  }[];
  readonly facts: readonly SmppProviderFact[];
  readonly relations: readonly SmppEntityRelation[];
}): readonly McpProviderReconciliationIssue[] {
  const issues: McpProviderReconciliationIssue[] = [];
  for (const binding of input.runtimeBindings) {
    const taskFacts = input.facts.filter((fact) => fact.external_task_id === binding.externalTaskId);
    const taskRelations = input.relations.filter(
      (relation) =>
        relation.source_entity_id === binding.externalTaskId ||
        relation.target_entity_id === binding.externalTaskId,
    );
    if (taskFacts.length === 0) {
      issues.push({code: "SMPP_PROVIDER_TELEMETRY_MISSING", blocking: false, identity: binding.externalTaskId});
      continue;
    }
    if (taskRelations.length === 0) {
      issues.push({code: "SMPP_RELATION_AMBIGUOUS", blocking: false, identity: binding.externalTaskId});
    }
    const latestFact = [...taskFacts].sort((left, right) =>
      left.occurred_at.localeCompare(right.occurred_at),
    ).at(-1)!;
    if (
      terminalStatuses.has(binding.runtimeStatus.toLowerCase()) &&
      terminalStatuses.has((latestFact.lifecycle_status ?? "").toLowerCase()) &&
      binding.runtimeStatus.toLowerCase() !== latestFact.lifecycle_status!.toLowerCase()
    ) {
      issues.push({code: "SMPP_PROVIDER_TERMINAL_MISMATCH", blocking: true, identity: binding.externalTaskId});
    }
    if (
      binding.runtimeRevision !== undefined &&
      latestFact.runtime_revision !== undefined &&
      binding.runtimeRevision !== latestFact.runtime_revision
    ) {
      issues.push({code: "SMPP_REVISION_MISMATCH", blocking: false, identity: binding.externalTaskId});
    }
  }
  return Object.freeze(issues);
}

function conflictingFacts(facts: readonly SmppProviderFact[]): boolean {
  const hashes = new Map<string, string>();
  for (const fact of facts) {
    const previous = hashes.get(fact.fact_id);
    if (previous !== undefined && previous !== fact.fact_hash) return true;
    hashes.set(fact.fact_id, fact.fact_hash);
  }
  return false;
}

function conflictingTaskTerminals(facts: readonly SmppProviderFact[]): boolean {
  const statuses = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (fact.fact_type !== "provider.task.lifecycle" || fact.external_task_id === undefined) continue;
    const status = (fact.lifecycle_status ?? "").toLowerCase();
    if (!terminalStatuses.has(status)) continue;
    const current = statuses.get(fact.external_task_id) ?? new Set<string>();
    current.add(status);
    statuses.set(fact.external_task_id, current);
    if (current.size > 1) return true;
  }
  return false;
}

function latest(values: readonly string[]): string | null {
  return values.length === 0 ? null : [...values].sort().at(-1)!;
}
