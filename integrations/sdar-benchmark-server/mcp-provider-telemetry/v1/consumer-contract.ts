export const SMPP_BENCHMARK_HANDOFF_CONTRACT =
  "sdar.telemetry-smpp-providerops-handoff/v1" as const;

export const MCP_PROVIDER_READINESS_STATUSES = [
  "not_required",
  "not_ready",
  "degraded",
  "ready",
  "conflict",
] as const;

export type McpProviderReadinessStatus =
  (typeof MCP_PROVIDER_READINESS_STATUSES)[number];

export interface SmppProviderFact {
  readonly factId: string;
  readonly factHash: string;
  readonly factType: string;
  readonly sourceRelease: "1.1.0";
  readonly smppSourceId: string;
  readonly projectionId: "smpp_provider_ops_to_sdar_core";
  readonly projectionVersion: 1;
  readonly occurredAt: string;
  readonly projectedAt: string;
}

export interface SmppEntityRelation {
  readonly relationId: string;
  readonly relationType: string;
  readonly sourceEntityUrn: string;
  readonly targetEntityUrn: string;
  readonly evidenceFactIds: readonly string[];
  readonly sourceRecordHash: string;
  readonly projectionId: "smpp_relations_to_sdar_core";
  readonly projectionVersion: 1;
}

export interface McpProviderReconciliationIssue {
  readonly reasonCode: string;
  readonly blocking: boolean;
  readonly identity: string;
}

export interface McpProviderReadiness {
  readonly status: McpProviderReadinessStatus;
  readonly reasonCodes: readonly string[];
  readonly watermark: string | null;
  readonly goalSuccessProven: false;
  readonly physicalSuccessProven: false;
}

export interface McpProviderTelemetrySnapshot {
  readonly episodeId: string;
  readonly facts: readonly SmppProviderFact[];
  readonly relations: readonly SmppEntityRelation[];
  readonly reconciliationIssues: readonly McpProviderReconciliationIssue[];
  readonly readiness: McpProviderReadiness;
  readonly sourceRelease: "1.1.0";
  readonly sourceMappingVersion: 4;
  readonly schemaContractHash: string;
  readonly watermark: string | null;
}

export interface McpProviderConsumerDecision {
  readonly mayProceed: boolean;
  readonly maySnapshotProviderInput: boolean;
  readonly resultDisposition:
    | "provider_not_required"
    | "provider_evidence_ready"
    | "provider_evidence_degraded"
    | "not_rated"
    | "blocked_conflict";
}

export function decideMcpProviderConsumption(
  required: boolean,
  status: McpProviderReadinessStatus,
): McpProviderConsumerDecision {
  if (!required || status === "not_required") {
    return Object.freeze({
      mayProceed: true,
      maySnapshotProviderInput: false,
      resultDisposition: "provider_not_required",
    });
  }
  if (status === "ready" || status === "degraded") {
    return Object.freeze({
      mayProceed: true,
      maySnapshotProviderInput: true,
      resultDisposition:
        status === "ready" ? "provider_evidence_ready" : "provider_evidence_degraded",
    });
  }
  if (status === "conflict") {
    return Object.freeze({
      mayProceed: false,
      maySnapshotProviderInput: false,
      resultDisposition: "blocked_conflict",
    });
  }
  return Object.freeze({
    mayProceed: false,
    maySnapshotProviderInput: false,
    resultDisposition: "not_rated",
  });
}
