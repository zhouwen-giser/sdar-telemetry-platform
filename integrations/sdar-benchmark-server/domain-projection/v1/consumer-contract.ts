export const DOMAIN_HANDOFF_CONTRACT = "sdar.telemetry-domain-handoff/v1" as const;
export const DOMAIN_READINESS_STATUSES = [
  "not_required",
  "not_ready",
  "degraded",
  "ready",
  "blocked_drift",
] as const;

export type DomainReadinessStatus = (typeof DOMAIN_READINESS_STATUSES)[number];
export type BenchmarkProfile = "general" | "domain_formal";
export type DomainConsumerDecision = Readonly<{
  mayProceed: boolean;
  maySnapshotDomainInput: boolean;
  resultDisposition: "proceed_without_domain" | "formal_domain_ready" | "not_rated" | "blocked";
}>;

export function decideDomainConsumption(
  profile: BenchmarkProfile,
  status: DomainReadinessStatus,
): DomainConsumerDecision {
  if (profile === "general") {
    return Object.freeze({
      mayProceed: true,
      maySnapshotDomainInput: false,
      resultDisposition: "proceed_without_domain",
    });
  }
  if (status === "ready") {
    return Object.freeze({
      mayProceed: true,
      maySnapshotDomainInput: true,
      resultDisposition: "formal_domain_ready",
    });
  }
  if (status === "blocked_drift") {
    return Object.freeze({
      mayProceed: false,
      maySnapshotDomainInput: false,
      resultDisposition: "blocked",
    });
  }
  return Object.freeze({
    mayProceed: false,
    maySnapshotDomainInput: false,
    resultDisposition: "not_rated",
  });
}
