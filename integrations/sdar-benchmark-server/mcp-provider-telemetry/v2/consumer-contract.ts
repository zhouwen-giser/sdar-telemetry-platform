export const PROVIDER_HANDOFF_V2 =
  "sdar.telemetry-smpp-providerops-handoff/v2" as const;

export interface ProviderEpisodeClosureRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly environment: string;
  readonly episodeId: string;
  readonly asOfProjectedAt?: string;
  readonly cursor?: string;
  readonly limit: number;
}

export interface ProviderEvidencePage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly pageHash: `sha256:${string}`;
}

export interface ProviderClosureManifest {
  readonly contractId: typeof PROVIDER_HANDOFF_V2;
  readonly asOfProjectedAt: string;
  readonly effectiveWatermark: string;
  readonly bindingCount: number;
  readonly remoteTaskCount: number;
  readonly providerSourceCount: number;
  readonly expectedFactCount: number;
  readonly selectedFactCount: number;
  readonly bindingDerivedRelationCount: number;
  readonly originClaimCount: number;
  readonly relationHintCount: number;
  readonly matchedClaimCount: number;
  readonly missingClaimCount: number;
  readonly unverifiableClaimCount: number;
  readonly ambiguousClaimCount: number;
  readonly conflictingClaimCount: number;
  readonly unresolvedBindingCount: number;
  readonly foreignFactCount: number;
  readonly pageCount: number;
  readonly truncated: boolean;
  readonly hintsUsedForAuthority: false;
  readonly bindingAuthorityHash: `sha256:${string}`;
  readonly selectionPredicateHash: `sha256:${string}`;
  readonly reconciliationHash: `sha256:${string}`;
  readonly closureContentHash: `sha256:${string}`;
  readonly status:
    | "not_required"
    | "not_ready"
    | "degraded"
    | "ready"
    | "conflict"
    | "blocked_drift";
  readonly reasonCodes: readonly string[];
  readonly goalSuccessProven: false;
  readonly physicalSuccessProven: false;
}

export function mayFormallyConsumeProviderClosure(manifest: ProviderClosureManifest): boolean {
  return manifest.status === "ready" &&
    manifest.expectedFactCount === manifest.selectedFactCount &&
    manifest.foreignFactCount === 0 &&
    manifest.unresolvedBindingCount === 0 &&
    manifest.truncated === false &&
    manifest.hintsUsedForAuthority === false;
}
