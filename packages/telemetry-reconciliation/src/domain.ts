export type DomainReconciliationIssueCode =
  | "SOURCE_WITHOUT_TERMINAL"
  | "TARGET_WITHOUT_LINEAGE"
  | "PRODUCED_LINEAGE_WITHOUT_TARGET"
  | "TARGET_CONTENT_HASH_MISMATCH"
  | "CHECKPOINT_AHEAD_OF_TERMINAL"
  | "UNRESOLVED_BLOCKING_DLQ"
  | "SCHEMA_DEFINITION_DRIFT"
  | "DUPLICATE_TARGET_IDENTITY";

export type DomainReconciliationSource = Readonly<{
  recordId: string;
  sourceRevision: string;
  contentHash: string;
}>;

export type DomainReconciliationTarget = Readonly<{
  recordId: string;
  contentHash: string;
}>;

export type DomainReconciliationLineage = Readonly<{
  sourceRecordId: string;
  sourceRevision: string;
  targetRecordId: string;
  targetContentHash: string;
  decision: "produced" | "skipped";
}>;

export type DomainReconciliationDeadLetter = Readonly<{
  sourceRecordId: string;
  sourceRevision: string;
  blocking: boolean;
  status: "open" | "retrying" | "resolved" | "ignored";
}>;

export type DomainReconciliationInput = Readonly<{
  projectionId: string;
  projectionVersion: number;
  sources: readonly DomainReconciliationSource[];
  targets: readonly DomainReconciliationTarget[];
  lineage: readonly DomainReconciliationLineage[];
  deadLetters: readonly DomainReconciliationDeadLetter[];
  checkpointedSourceKeys: readonly string[];
  schemaDefinitionDrift: boolean;
}>;

export type DomainReconciliationIssue = Readonly<{
  code: DomainReconciliationIssueCode;
  sourceKey: string;
  targetRecordId: string;
}>;

export type DomainReconciliationResult = Readonly<{
  projectionId: string;
  projectionVersion: number;
  status: "healthy" | "gap" | "empty";
  sourceCount: number;
  targetCount: number;
  lineageCount: number;
  openBlockingDeadLetterCount: number;
  issues: readonly DomainReconciliationIssue[];
}>;

export function reconcileDomainProjection(
  input: DomainReconciliationInput,
): DomainReconciliationResult {
  assertIdentity(input.projectionId, input.projectionVersion);
  const issues: DomainReconciliationIssue[] = [];
  const sourceKeys = new Set(input.sources.map((source) => sourceKey(source.recordId, source.sourceRevision)));
  const lineageBySource = new Map<string, DomainReconciliationLineage[]>();
  const lineageByTarget = new Map<string, DomainReconciliationLineage[]>();
  for (const row of input.lineage) {
    append(lineageBySource, sourceKey(row.sourceRecordId, row.sourceRevision), row);
    if (row.targetRecordId !== "") append(lineageByTarget, row.targetRecordId, row);
  }
  const terminalSources = new Set(lineageBySource.keys());
  for (const row of input.deadLetters) {
    terminalSources.add(sourceKey(row.sourceRecordId, row.sourceRevision));
  }

  for (const source of input.sources) {
    const key = sourceKey(source.recordId, source.sourceRevision);
    if (!terminalSources.has(key)) addIssue(issues, "SOURCE_WITHOUT_TERMINAL", key, "");
  }

  const targetsById = new Map<string, DomainReconciliationTarget[]>();
  for (const target of input.targets) append(targetsById, target.recordId, target);
  for (const [targetId, rows] of targetsById) {
    if (rows.length > 1) addIssue(issues, "DUPLICATE_TARGET_IDENTITY", "", targetId);
    const lineages = lineageByTarget.get(targetId) ?? [];
    if (lineages.length === 0) addIssue(issues, "TARGET_WITHOUT_LINEAGE", "", targetId);
    if (lineages.some((lineage) => lineage.targetContentHash !== rows[0]!.contentHash)) {
      addIssue(issues, "TARGET_CONTENT_HASH_MISMATCH", "", targetId);
    }
  }

  for (const row of input.lineage) {
    if (row.decision === "produced" && !targetsById.has(row.targetRecordId)) {
      addIssue(
        issues,
        "PRODUCED_LINEAGE_WITHOUT_TARGET",
        sourceKey(row.sourceRecordId, row.sourceRevision),
        row.targetRecordId,
      );
    }
  }

  for (const key of input.checkpointedSourceKeys) {
    if (!sourceKeys.has(key) || !terminalSources.has(key)) {
      addIssue(issues, "CHECKPOINT_AHEAD_OF_TERMINAL", key, "");
    }
  }

  for (const row of input.deadLetters) {
    if (row.blocking && (row.status === "open" || row.status === "retrying")) {
      addIssue(
        issues,
        "UNRESOLVED_BLOCKING_DLQ",
        sourceKey(row.sourceRecordId, row.sourceRevision),
        "",
      );
    }
  }
  if (input.schemaDefinitionDrift) addIssue(issues, "SCHEMA_DEFINITION_DRIFT", "", "");

  issues.sort((left, right) =>
    `${left.code}\u001f${left.sourceKey}\u001f${left.targetRecordId}`.localeCompare(
      `${right.code}\u001f${right.sourceKey}\u001f${right.targetRecordId}`,
    ),
  );
  return Object.freeze({
    projectionId: input.projectionId,
    projectionVersion: input.projectionVersion,
    status: input.sources.length === 0 ? "empty" : issues.length === 0 ? "healthy" : "gap",
    sourceCount: input.sources.length,
    targetCount: input.targets.length,
    lineageCount: input.lineage.length,
    openBlockingDeadLetterCount: input.deadLetters.filter(
      (row) => row.blocking && (row.status === "open" || row.status === "retrying"),
    ).length,
    issues: Object.freeze(issues),
  });
}

export function domainReconciliationSourceKey(recordId: string, sourceRevision: string): string {
  return sourceKey(recordId, sourceRevision);
}

function sourceKey(recordId: string, sourceRevision: string): string {
  if (recordId === "" || sourceRevision === "" || recordId.includes("\u001f") || sourceRevision.includes("\u001f")) {
    throw reconciliationError("DOMAIN_RECONCILIATION_IDENTITY_INVALID");
  }
  return `${recordId}\u001f${sourceRevision}`;
}

function assertIdentity(projectionId: string, projectionVersion: number): void {
  if (projectionId.trim() === "" || !Number.isSafeInteger(projectionVersion) || projectionVersion < 1) {
    throw reconciliationError("DOMAIN_RECONCILIATION_SCOPE_INVALID");
  }
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}

function addIssue(
  issues: DomainReconciliationIssue[],
  code: DomainReconciliationIssueCode,
  sourceKeyValue: string,
  targetRecordId: string,
): void {
  issues.push(Object.freeze({ code, sourceKey: sourceKeyValue, targetRecordId }));
}

function reconciliationError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
