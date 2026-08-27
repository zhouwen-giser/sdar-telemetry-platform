import { createHash } from "node:crypto";

export const PROVIDER_EPISODE_CLOSURE_CONTRACT =
  "sdar.telemetry-smpp-providerops-handoff/v2" as const;
export const PROVIDER_ORIGIN_CLAIM_POLICY =
  "sdar.provider-origin-claim-reconciliation/v1.1" as const;

export type ProviderBindingAuthorityRef = "sdar_core.remote_task_binding" | "sdar_core.sdar_evidence_v1_record:mcp_task.remote_binding";

export type ProviderClosureReadinessStatus =
  | "not_required"
  | "not_ready"
  | "degraded"
  | "ready"
  | "conflict"
  | "blocked_drift";

export type ProviderOriginClaimStatus =
  | "matched"
  | "missing"
  | "unverifiable"
  | "ambiguous"
  | "conflict"
  | "out_of_scope";

export interface ProviderClosureScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly environment: string;
  readonly episodeId: string;
}

export interface ProviderEpisodeClosureRequest extends ProviderClosureScope {
  readonly required: boolean;
  readonly asOfProjectedAt?: string;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly maxAttempts?: number;
}

export interface ProviderRemoteTaskBinding {
  readonly bindingId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly environment: string;
  readonly episodeId: string;
  readonly a2aTaskId: string;
  readonly remoteTaskId: string;
  readonly providerOriginSourceId: string;
  readonly externalProviderId: string;
  readonly externalProviderInstanceId?: string;
  readonly revision: string;
  readonly status: string;
  readonly updatedAt: string;
  /** Values are populated only from an explicit Runtime identity mapping contract. */
  readonly authoritativeOriginRuntimeIds?: readonly string[];
  readonly authoritativeOriginTaskIds?: readonly string[];
  readonly authoritativeOriginInvocationIds?: readonly string[];
}

export interface ProviderClosureFact {
  readonly factId: string;
  readonly factHash: string;
  readonly factType: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly environment: string;
  readonly smppSourceId: string;
  readonly providerId: string;
  readonly providerInstanceId?: string;
  readonly externalTaskId: string;
  readonly occurredAt: string;
  readonly projectedAt: string;
  readonly sourceRecordId: string;
  readonly sourceRecordHash: string;
  readonly originSystem?: string;
  readonly originDeploymentId?: string;
  readonly originRuntimeInstanceIds?: readonly string[];
  readonly originTaskIds?: readonly string[];
  readonly originInvocationIds?: readonly string[];
}

export interface ProviderReconciliationHint {
  readonly relationId: string;
  readonly relationType: string;
  readonly producerSystem: string;
  readonly projectionId: string;
  readonly confidenceClass: string;
  readonly bindingSource: string;
  readonly evidenceFactIds: readonly string[];
  readonly sourceRecordHash: string;
  readonly projectedAt: string;
  readonly authority: boolean;
  readonly maySelectFacts: false;
  readonly mayOverrideBinding: false;
}

export interface ProviderBindingDerivedRelation {
  readonly relationId: string;
  readonly relationType: "binds_provider_remote_task";
  readonly bindingId: string;
  readonly episodeId: string;
  readonly remoteTaskId: string;
  readonly authoritySource: ProviderBindingAuthorityRef;
  readonly contentHash: `sha256:${string}`;
}

export interface ProviderOriginReconciliationResult {
  readonly claimId: string;
  readonly claimType: "runtime" | "task" | "invocation" | "relation";
  readonly claimValues: readonly string[];
  readonly authoritativeRefs: readonly string[];
  readonly status: ProviderOriginClaimStatus;
  readonly blocking: boolean;
  readonly reasonCodes: readonly string[];
  readonly evidenceFactIds: readonly string[];
  readonly relationHintIds: readonly string[];
  readonly policyRef: {
    readonly id: typeof PROVIDER_ORIGIN_CLAIM_POLICY;
    readonly version: 1;
    readonly contentHash: `sha256:${string}`;
  };
}

export interface ProviderEvidencePage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly pageHash: `sha256:${string}`;
}

export interface ProviderClosureCapture {
  readonly asOfProjectedAt: string;
  readonly effectiveWatermark: string;
  readonly bindingCount: number;
  readonly expectedFactCount: number;
  readonly identityHash: `sha256:${string}`;
}

export interface ProviderEpisodeClosureDataSource {
  readonly bindingAuthorityRef?: ProviderBindingAuthorityRef;
  capture(
    scope: ProviderClosureScope,
    asOfProjectedAt?: string,
  ): Promise<ProviderClosureCapture>;
  listBindings(input: {
    readonly scope: ProviderClosureScope;
    readonly asOfProjectedAt: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<ProviderEvidencePage<ProviderRemoteTaskBinding>>;
  listFacts(input: {
    readonly scope: ProviderClosureScope;
    readonly asOfProjectedAt: string;
    readonly bindings: readonly ProviderRemoteTaskBinding[];
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<ProviderEvidencePage<ProviderClosureFact>>;
  listRelationHints(input: {
    readonly scope: ProviderClosureScope;
    readonly asOfProjectedAt: string;
    readonly selectedFactIds: readonly string[];
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<ProviderEvidencePage<ProviderReconciliationHint>>;
}

export interface ProviderClosurePaginationProof {
  readonly bindingPageCount: number;
  readonly factPageCount: number;
  readonly relationHintPageCount: number;
  readonly pageCount: number;
  readonly pageHashes: readonly `sha256:${string}`[];
  readonly firstCursor: string | null;
  readonly lastCursor: string | null;
  readonly hasMore: false;
}

export interface ProviderEpisodeClosure {
  readonly contractId: typeof PROVIDER_EPISODE_CLOSURE_CONTRACT;
  readonly scope: Readonly<ProviderClosureScope>;
  readonly snapshot: {
    readonly asOfProjectedAt: string;
    readonly effectiveWatermark: string;
    readonly selectionPredicateHash: `sha256:${string}`;
  };
  readonly closure: {
    readonly authoritativeBindings: readonly ProviderRemoteTaskBinding[];
    readonly providerFacts: readonly ProviderClosureFact[];
    readonly bindingDerivedRelations: readonly ProviderBindingDerivedRelation[];
    readonly bindingCount: number;
    readonly remoteTaskCount: number;
    readonly providerSourceCount: number;
    readonly expectedFactCount: number;
    readonly selectedFactCount: number;
    readonly bindingDerivedRelationCount: number;
    readonly foreignFactCount: number;
    readonly unresolvedBindingCount: number;
    readonly truncated: boolean;
    readonly closureContentHash: `sha256:${string}`;
  };
  readonly reconciliation: {
    readonly originClaims: readonly ProviderOriginReconciliationResult[];
    readonly relationHints: readonly ProviderReconciliationHint[];
    readonly results: readonly ProviderOriginReconciliationResult[];
    readonly originClaimCount: number;
    readonly relationHintCount: number;
    readonly matchedCount: number;
    readonly missingCount: number;
    readonly unverifiableCount: number;
    readonly ambiguousCount: number;
    readonly conflictingCount: number;
    readonly outOfScopeCount: number;
    readonly reconciliationHash: `sha256:${string}`;
    readonly hintsUsedForAuthority: false;
  };
  readonly pagination: ProviderClosurePaginationProof;
  readonly readiness: {
    readonly status: ProviderClosureReadinessStatus;
    readonly reasonCodes: readonly string[];
    readonly goalSuccessProven: false;
    readonly physicalSuccessProven: false;
  };
  readonly provenance: {
    readonly bindingAuthorityRef: ProviderBindingAuthorityRef;
    readonly bindingAuthorityHash: `sha256:${string}`;
    readonly originClaimPolicyRef: typeof PROVIDER_ORIGIN_CLAIM_POLICY;
    readonly originClaimPolicyHash: `sha256:${string}`;
  };
}

const POLICY_HASH = hash({
  id: PROVIDER_ORIGIN_CLAIM_POLICY,
  missing: "non_blocking",
  unverifiable: "degraded",
  ambiguous: "blocking",
  conflict: "blocking",
  hintsUsedForAuthority: false,
});

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_ITEMS = 100_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export async function assembleProviderEpisodeClosure(
  source: ProviderEpisodeClosureDataSource,
  request: ProviderEpisodeClosureRequest,
): Promise<ProviderEpisodeClosure> {
  validateRequest(request);
  if (!request.required) return emptyClosure(request);
  const maxAttempts = request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const captured = await source.capture(request, request.asOfProjectedAt);
    validateCapture(captured);
    const loaded = await loadClosurePages(source, request, captured.asOfProjectedAt);
    const observed = await source.capture(request, captured.asOfProjectedAt);
    validateCapture(observed);
    if (sameCapture(captured, observed)) {
      return buildClosure(request, captured, loaded, source.bindingAuthorityRef);
    }
  }
  return blockedDriftClosure(request);
}

interface LoadedClosurePages {
  readonly bindings: readonly ProviderRemoteTaskBinding[];
  readonly facts: readonly ProviderClosureFact[];
  readonly hints: readonly ProviderReconciliationHint[];
  readonly pageHashes: readonly `sha256:${string}`[];
  readonly bindingPageCount: number;
  readonly factPageCount: number;
  readonly relationHintPageCount: number;
  readonly firstCursor: string | null;
  readonly lastCursor: string | null;
  readonly volumeExceeded: boolean;
}

async function loadClosurePages(
  source: ProviderEpisodeClosureDataSource,
  request: ProviderEpisodeClosureRequest,
  asOfProjectedAt: string,
): Promise<LoadedClosurePages> {
  const limit = request.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
  const maxItems = request.maxItems ?? DEFAULT_MAX_ITEMS;
  const bindingPages = await readPages(
    (cursor) => source.listBindings({ scope: request, asOfProjectedAt, cursor, limit }),
    maxPages,
    maxItems,
  );
  const factPages = await readPages(
    (cursor) =>
      source.listFacts({
        scope: request,
        asOfProjectedAt,
        bindings: bindingPages.items,
        cursor,
        limit,
      }),
    maxPages,
    maxItems,
  );
  const hintPages = await readPages(
    (cursor) =>
      source.listRelationHints({
        scope: request,
        asOfProjectedAt,
        selectedFactIds: factPages.items.map((fact) => fact.factId),
        cursor,
        limit,
      }),
    maxPages,
    maxItems,
  );
  const cursors = [bindingPages.firstCursor, factPages.firstCursor, hintPages.firstCursor].filter(
    (value): value is string => value !== null,
  );
  const lastCursors = [bindingPages.lastCursor, factPages.lastCursor, hintPages.lastCursor].filter(
    (value): value is string => value !== null,
  );
  return {
    bindings: bindingPages.items,
    facts: factPages.items,
    hints: hintPages.items,
    pageHashes: Object.freeze([
      ...bindingPages.pageHashes,
      ...factPages.pageHashes,
      ...hintPages.pageHashes,
    ]),
    bindingPageCount: bindingPages.pageCount,
    factPageCount: factPages.pageCount,
    relationHintPageCount: hintPages.pageCount,
    firstCursor: cursors[0] ?? null,
    lastCursor: lastCursors.at(-1) ?? null,
    volumeExceeded:
      bindingPages.volumeExceeded || factPages.volumeExceeded || hintPages.volumeExceeded,
  };
}

async function readPages<T>(
  load: (cursor: string | null) => Promise<ProviderEvidencePage<T>>,
  maxPages: number,
  maxItems: number,
): Promise<{
  readonly items: readonly T[];
  readonly pageHashes: readonly `sha256:${string}`[];
  readonly pageCount: number;
  readonly firstCursor: string | null;
  readonly lastCursor: string | null;
  readonly volumeExceeded: boolean;
}> {
  const items: T[] = [];
  const pageHashes: `sha256:${string}`[] = [];
  let cursor: string | null = null;
  let firstCursor: string | null = null;
  let lastCursor: string | null = null;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await load(cursor);
    validatePage(page, cursor);
    if (firstCursor === null) firstCursor = cursor;
    items.push(...page.items);
    pageHashes.push(page.pageHash);
    lastCursor = page.nextCursor;
    if (items.length > maxItems) {
      return {
        items: Object.freeze(items.slice(0, maxItems)),
        pageHashes: Object.freeze(pageHashes),
        pageCount: pageNumber,
        firstCursor,
        lastCursor,
        volumeExceeded: true,
      };
    }
    if (!page.hasMore) {
      return {
        items: Object.freeze(items),
        pageHashes: Object.freeze(pageHashes),
        pageCount: pageNumber,
        firstCursor,
        lastCursor,
        volumeExceeded: false,
      };
    }
    cursor = page.nextCursor;
  }
  return {
    items: Object.freeze(items),
    pageHashes: Object.freeze(pageHashes),
    pageCount: maxPages,
    firstCursor,
    lastCursor,
    volumeExceeded: true,
  };
}

function buildClosure(
  request: ProviderEpisodeClosureRequest,
  capture: ProviderClosureCapture,
  loaded: LoadedClosurePages,
  authoritySource: ProviderBindingAuthorityRef = "sdar_core.remote_task_binding",
): ProviderEpisodeClosure {
  const bindings = uniqueBy(loaded.bindings, (binding) => binding.bindingId).sort(byBinding);
  const bindingAuthorityHash = hash(bindings);
  const selectionPredicateHash = hash({
    contract: PROVIDER_EPISODE_CLOSURE_CONTRACT,
    scope: scopeOf(request),
    asOfProjectedAt: capture.asOfProjectedAt,
    keys: [
      "tenantId",
      "projectId",
      "environment",
      "remoteTaskId=externalTaskId",
      "providerOriginSourceId=smppSourceId",
      "externalProviderId=providerId",
      "externalProviderInstanceId=providerInstanceId_when_present",
    ],
    bindingAuthorityHash,
  });
  const selectedFacts: ProviderClosureFact[] = [];
  let foreignFactCount = 0;
  for (const fact of uniqueBy(loaded.facts, (item) => item.factId).sort(byFact)) {
    if (matchingBindings(fact, bindings, request).length === 1) selectedFacts.push(fact);
    else foreignFactCount += 1;
  }
  const selectedFactIds = new Set(selectedFacts.map((fact) => fact.factId));
  const hints = uniqueBy(loaded.hints, (hint) => hint.relationId)
    .filter((hint) => hint.evidenceFactIds.some((factId) => selectedFactIds.has(factId)))
    .map(normalizeHint)
    .sort((left, right) => left.relationId.localeCompare(right.relationId));
  const bindingDerivedRelations = bindings.map(binding => bindingRelation(binding, authoritySource));
  const results = reconcileClaims(selectedFacts, bindings, hints);
  const counts = countStatuses(results);
  const unresolvedBindingCount = bindings.filter(
    (binding) => !selectedFacts.some((fact) => matchingBindings(fact, [binding], request).length === 1),
  ).length;
  const countMismatch =
    capture.bindingCount !== bindings.length || capture.expectedFactCount !== selectedFacts.length;
  const truncated = loaded.volumeExceeded || countMismatch;
  const closureContentHash = hash({
    bindings,
    selectedFacts,
    bindingDerivedRelations,
    asOfProjectedAt: capture.asOfProjectedAt,
    selectionPredicateHash,
  });
  const reconciliationHash = hash({
    hints,
    results,
    policyHash: POLICY_HASH,
    hintsUsedForAuthority: false,
  });
  const reasonCodes = new Set<string>();
  if (bindings.length === 0) reasonCodes.add("SMPP_BINDING_MISSING");
  if (unresolvedBindingCount > 0) reasonCodes.add("SMPP_PROVIDER_FACT_MISSING");
  if (foreignFactCount > 0) reasonCodes.add("SMPP_PROVIDER_FACT_FOREIGN");
  if (truncated) reasonCodes.add(
    loaded.volumeExceeded ? "SMPP_PROVIDER_VOLUME_LIMIT_EXCEEDED" : "SMPP_PROVIDER_FACT_TRUNCATED",
  );
  if (counts.conflict > 0) reasonCodes.add("SMPP_ORIGIN_CLAIM_CONFLICT");
  if (counts.ambiguous > 0) reasonCodes.add("SMPP_ORIGIN_CLAIM_AMBIGUOUS");
  if (counts.unverifiable > 0) reasonCodes.add("SMPP_ORIGIN_CLAIM_UNVERIFIABLE");
  if (counts.missing > 0) reasonCodes.add("SMPP_ORIGIN_CLAIM_MISSING");
  if (hints.some((hint) => hint.confidenceClass === "invalid_authoritative_reconciliation_hint")) {
    reasonCodes.add("SMPP_RECONCILIATION_HINT_INVALID");
  }
  const blocking = foreignFactCount > 0 || truncated || counts.conflict > 0 || counts.ambiguous > 0;
  const status: ProviderClosureReadinessStatus = blocking
    ? "conflict"
    : bindings.length === 0 || unresolvedBindingCount > 0
      ? "not_ready"
      : counts.unverifiable > 0
        ? "degraded"
        : "ready";
  const pageCount =
    loaded.bindingPageCount + loaded.factPageCount + loaded.relationHintPageCount;
  return Object.freeze({
    contractId: PROVIDER_EPISODE_CLOSURE_CONTRACT,
    scope: Object.freeze(scopeOf(request)),
    snapshot: Object.freeze({
      asOfProjectedAt: capture.asOfProjectedAt,
      effectiveWatermark: capture.effectiveWatermark,
      selectionPredicateHash,
    }),
    closure: Object.freeze({
      authoritativeBindings: Object.freeze(bindings),
      providerFacts: Object.freeze(selectedFacts),
      bindingDerivedRelations: Object.freeze(bindingDerivedRelations),
      bindingCount: bindings.length,
      remoteTaskCount: new Set(bindings.map((binding) => binding.remoteTaskId)).size,
      providerSourceCount: new Set(bindings.map((binding) => binding.providerOriginSourceId)).size,
      expectedFactCount: capture.expectedFactCount,
      selectedFactCount: selectedFacts.length,
      bindingDerivedRelationCount: bindingDerivedRelations.length,
      foreignFactCount,
      unresolvedBindingCount,
      truncated,
      closureContentHash,
    }),
    reconciliation: Object.freeze({
      originClaims: Object.freeze(results.filter((result) => result.claimType !== "relation")),
      relationHints: Object.freeze(hints),
      results: Object.freeze(results),
      originClaimCount: results.filter((result) => result.claimType !== "relation").length,
      relationHintCount: hints.length,
      matchedCount: counts.matched,
      missingCount: counts.missing,
      unverifiableCount: counts.unverifiable,
      ambiguousCount: counts.ambiguous,
      conflictingCount: counts.conflict,
      outOfScopeCount: counts.out_of_scope,
      reconciliationHash,
      hintsUsedForAuthority: false,
    }),
    pagination: Object.freeze({
      bindingPageCount: loaded.bindingPageCount,
      factPageCount: loaded.factPageCount,
      relationHintPageCount: loaded.relationHintPageCount,
      pageCount,
      pageHashes: loaded.pageHashes,
      firstCursor: loaded.firstCursor,
      lastCursor: loaded.lastCursor,
      hasMore: false,
    }),
    readiness: Object.freeze({
      status,
      reasonCodes: Object.freeze([...reasonCodes].sort()),
      goalSuccessProven: false,
      physicalSuccessProven: false,
    }),
    provenance: Object.freeze({
      bindingAuthorityRef: authoritySource,
      bindingAuthorityHash,
      originClaimPolicyRef: PROVIDER_ORIGIN_CLAIM_POLICY,
      originClaimPolicyHash: POLICY_HASH,
    }),
  });
}

function reconcileClaims(
  facts: readonly ProviderClosureFact[],
  bindings: readonly ProviderRemoteTaskBinding[],
  hints: readonly ProviderReconciliationHint[],
): ProviderOriginReconciliationResult[] {
  const results: ProviderOriginReconciliationResult[] = [];
  for (const fact of facts) {
    const binding = matchingBindings(fact, bindings, fact)[0];
    if (binding === undefined) continue;
    if (fact.originSystem !== undefined && fact.originSystem.toLowerCase() !== "sdar") {
      results.push(claimResult(fact, "task", allClaimValues(fact), [], "out_of_scope"));
      continue;
    }
    results.push(
      compareClaim(fact, "runtime", fact.originRuntimeInstanceIds, binding.authoritativeOriginRuntimeIds),
      compareClaim(fact, "task", fact.originTaskIds, binding.authoritativeOriginTaskIds),
      compareClaim(fact, "invocation", fact.originInvocationIds, binding.authoritativeOriginInvocationIds),
    );
  }
  for (const hint of hints) {
    const invalidAuthority =
      hint.confidenceClass === "invalid_authoritative_reconciliation_hint";
    results.push({
      claimId: hash({ relationId: hint.relationId, type: "relation" }),
      claimType: "relation",
      claimValues: Object.freeze([hint.relationId]),
      authoritativeRefs: Object.freeze([]),
      status: invalidAuthority ? "conflict" : "unverifiable",
      blocking: invalidAuthority,
      reasonCodes: Object.freeze([
        invalidAuthority
          ? "SMPP_RECONCILIATION_HINT_INVALID"
          : "SMPP_ORIGIN_CLAIM_UNVERIFIABLE",
      ]),
      evidenceFactIds: Object.freeze([...hint.evidenceFactIds].sort()),
      relationHintIds: Object.freeze([hint.relationId]),
      policyRef: policyRef(),
    });
  }
  return results.sort((left, right) => left.claimId.localeCompare(right.claimId));
}

function compareClaim(
  fact: ProviderClosureFact,
  type: "runtime" | "task" | "invocation",
  claims: readonly string[] | undefined,
  refs: readonly string[] | undefined,
): ProviderOriginReconciliationResult {
  const claimValues = normalizedStrings(claims ?? []);
  const authoritativeRefs = normalizedStrings(refs ?? []);
  if (claimValues.length === 0) return claimResult(fact, type, [], authoritativeRefs, "missing");
  if (authoritativeRefs.length === 0) {
    return claimResult(fact, type, claimValues, [], "unverifiable");
  }
  const matches = claimValues.filter((value) => authoritativeRefs.includes(value));
  const status: ProviderOriginClaimStatus =
    matches.length === claimValues.length && matches.length === authoritativeRefs.length
      ? "matched"
      : matches.length > 0
        ? "ambiguous"
        : "conflict";
  return claimResult(fact, type, claimValues, authoritativeRefs, status);
}

function claimResult(
  fact: ProviderClosureFact,
  type: "runtime" | "task" | "invocation",
  claimValues: readonly string[],
  authoritativeRefs: readonly string[],
  status: ProviderOriginClaimStatus,
): ProviderOriginReconciliationResult {
  return Object.freeze({
    claimId: hash({ factId: fact.factId, type, claimValues }),
    claimType: type,
    claimValues: Object.freeze([...claimValues]),
    authoritativeRefs: Object.freeze([...authoritativeRefs]),
    status,
    blocking: status === "ambiguous" || status === "conflict",
    reasonCodes: Object.freeze([reasonCode(status)]),
    evidenceFactIds: Object.freeze([fact.factId]),
    relationHintIds: Object.freeze([]),
    policyRef: policyRef(),
  });
}

function normalizeHint(hint: ProviderReconciliationHint): ProviderReconciliationHint {
  const smppProduced =
    hint.producerSystem.toLowerCase() === "smpp" || hint.projectionId.toLowerCase().includes("smpp");
  const legacy = smppProduced && hint.confidenceClass.toLowerCase() === "authoritative";
  return Object.freeze({
    ...hint,
    confidenceClass: legacy
      ? "invalid_authoritative_reconciliation_hint"
      : hint.confidenceClass,
    authority: false,
    maySelectFacts: false,
    mayOverrideBinding: false,
    evidenceFactIds: Object.freeze(normalizedStrings(hint.evidenceFactIds)),
  });
}

function matchingBindings(
  fact: ProviderClosureFact,
  bindings: readonly ProviderRemoteTaskBinding[],
  scope: Pick<ProviderClosureScope, "tenantId" | "projectId" | "environment">,
): ProviderRemoteTaskBinding[] {
  return bindings.filter(
    (binding) =>
      binding.tenantId === scope.tenantId &&
      binding.projectId === scope.projectId &&
      binding.environment === scope.environment &&
      fact.tenantId === binding.tenantId &&
      fact.projectId === binding.projectId &&
      fact.environment === binding.environment &&
      fact.externalTaskId === binding.remoteTaskId &&
      fact.smppSourceId === binding.providerOriginSourceId &&
      fact.providerId === binding.externalProviderId &&
      (binding.externalProviderInstanceId === undefined ||
        fact.providerInstanceId === binding.externalProviderInstanceId),
  );
}

function bindingRelation(binding: ProviderRemoteTaskBinding, authoritySource: ProviderBindingAuthorityRef): ProviderBindingDerivedRelation {
  const identity = {
    relationType: "binds_provider_remote_task" as const,
    bindingId: binding.bindingId,
    episodeId: binding.episodeId,
    remoteTaskId: binding.remoteTaskId,
    authoritySource,
  };
  const contentHash = hash(identity);
  return Object.freeze({ ...identity, relationId: contentHash, contentHash });
}

function validateRequest(request: ProviderEpisodeClosureRequest): void {
  for (const [field, value] of Object.entries(scopeOf(request))) {
    if (value.trim() === "") throw closureError("SMPP_CLOSURE_SCOPE_INVALID", field);
  }
  for (const [field, value] of [
    ["pageSize", request.pageSize ?? DEFAULT_PAGE_SIZE],
    ["maxPages", request.maxPages ?? DEFAULT_MAX_PAGES],
    ["maxItems", request.maxItems ?? DEFAULT_MAX_ITEMS],
    ["maxAttempts", request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw closureError("SMPP_CLOSURE_LIMIT_INVALID", field);
  }
  if (request.asOfProjectedAt !== undefined) assertDate(request.asOfProjectedAt);
}

function validateCapture(capture: ProviderClosureCapture): void {
  assertDate(capture.asOfProjectedAt);
  assertDate(capture.effectiveWatermark);
  if (!Number.isSafeInteger(capture.bindingCount) || capture.bindingCount < 0) {
    throw closureError("SMPP_CLOSURE_CAPTURE_INVALID", "bindingCount");
  }
  if (!Number.isSafeInteger(capture.expectedFactCount) || capture.expectedFactCount < 0) {
    throw closureError("SMPP_CLOSURE_CAPTURE_INVALID", "expectedFactCount");
  }
  assertHash(capture.identityHash);
}

function validatePage<T>(page: ProviderEvidencePage<T>, cursor: string | null): void {
  assertHash(page.pageHash);
  if (page.hasMore && (page.nextCursor === null || page.nextCursor === cursor)) {
    throw closureError("SMPP_CLOSURE_CURSOR_INVALID", page.nextCursor ?? "null");
  }
  if (!page.hasMore && page.nextCursor !== null) {
    throw closureError("SMPP_CLOSURE_CURSOR_INVALID", page.nextCursor);
  }
}

function sameCapture(left: ProviderClosureCapture, right: ProviderClosureCapture): boolean {
  return (
    left.asOfProjectedAt === right.asOfProjectedAt &&
    left.effectiveWatermark === right.effectiveWatermark &&
    left.bindingCount === right.bindingCount &&
    left.expectedFactCount === right.expectedFactCount &&
    left.identityHash === right.identityHash
  );
}

function emptyClosure(request: ProviderEpisodeClosureRequest): ProviderEpisodeClosure {
  const now = request.asOfProjectedAt ?? "1970-01-01T00:00:00.000Z";
  const capture = {
    asOfProjectedAt: now,
    effectiveWatermark: now,
    bindingCount: 0,
    expectedFactCount: 0,
    identityHash: hash([]),
  };
  return buildClosure(request, capture, {
    bindings: [],
    facts: [],
    hints: [],
    pageHashes: [],
    bindingPageCount: 0,
    factPageCount: 0,
    relationHintPageCount: 0,
    firstCursor: null,
    lastCursor: null,
    volumeExceeded: false,
  });
}

function blockedDriftClosure(request: ProviderEpisodeClosureRequest): ProviderEpisodeClosure {
  const closure = emptyClosure({ ...request, required: false });
  return Object.freeze({
    ...closure,
    readiness: Object.freeze({
      status: "blocked_drift",
      reasonCodes: Object.freeze(["SMPP_SOURCE_MOVED_DURING_SNAPSHOT"]),
      goalSuccessProven: false,
      physicalSuccessProven: false,
    }),
  });
}

function scopeOf(scope: ProviderClosureScope): ProviderClosureScope {
  return {
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    environment: scope.environment,
    episodeId: scope.episodeId,
  };
}

function policyRef(): ProviderOriginReconciliationResult["policyRef"] {
  return Object.freeze({
    id: PROVIDER_ORIGIN_CLAIM_POLICY,
    version: 1,
    contentHash: POLICY_HASH,
  });
}

function reasonCode(status: ProviderOriginClaimStatus): string {
  return `SMPP_ORIGIN_CLAIM_${status.toUpperCase()}`;
}

function countStatuses(results: readonly ProviderOriginReconciliationResult[]): Record<ProviderOriginClaimStatus, number> {
  const counts: Record<ProviderOriginClaimStatus, number> = {
    matched: 0,
    missing: 0,
    unverifiable: 0,
    ambiguous: 0,
    conflict: 0,
    out_of_scope: 0,
  };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

function allClaimValues(fact: ProviderClosureFact): string[] {
  return normalizedStrings([
    ...(fact.originRuntimeInstanceIds ?? []),
    ...(fact.originTaskIds ?? []),
    ...(fact.originInvocationIds ?? []),
  ]);
}

function normalizedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))].sort();
}

function uniqueBy<T>(values: readonly T[], identity: (value: T) => string): T[] {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = identity(value);
    const existing = result.get(key);
    if (existing !== undefined && hash(existing) !== hash(value)) {
      throw closureError("SMPP_CLOSURE_CONTENT_CONFLICT", key);
    }
    result.set(key, value);
  }
  return [...result.values()];
}

function byBinding(left: ProviderRemoteTaskBinding, right: ProviderRemoteTaskBinding): number {
  return `${left.updatedAt}\u001f${left.bindingId}`.localeCompare(`${right.updatedAt}\u001f${right.bindingId}`);
}

function byFact(left: ProviderClosureFact, right: ProviderClosureFact): number {
  return `${left.occurredAt}\u001f${left.factId}`.localeCompare(`${right.occurredAt}\u001f${right.factId}`);
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function assertHash(value: string): asserts value is `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw closureError("SMPP_CLOSURE_HASH_INVALID", value);
}

function assertDate(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw closureError("SMPP_CLOSURE_TIME_INVALID", value);
}

function closureError(code: string, detail: string): Error & { readonly code: string } {
  return Object.assign(new Error(`${code}: ${detail}`), { code });
}
