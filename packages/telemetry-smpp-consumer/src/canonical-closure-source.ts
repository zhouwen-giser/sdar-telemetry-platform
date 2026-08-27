import { hashCanonicalDomainProjectionJson as hash } from "../../telemetry-contracts/src/index.js";
import type { ProviderClosureCapture, ProviderClosureScope, ProviderClosureFact, ProviderEpisodeClosureDataSource,
  ProviderEvidencePage, ProviderReconciliationHint, ProviderRemoteTaskBinding } from "./closure-v2.js";

export interface ClosureWarehouse {
  query(sql: string): Promise<string>;
  insert(table: string, rows: Record<string, unknown>[], options?: {deduplicationToken?: string}): Promise<void>;
}
export interface CanonicalClosureOrigin {
  readonly tenantId: string; readonly projectId: string; readonly environment: string;
  readonly exportId: string; readonly sourceId: string; readonly nodeId: string; readonly notBefore: string;
}
type Row = Record<string, unknown>;
type Material = {bindings: ProviderRemoteTaskBinding[]; facts: ProviderClosureFact[]; hints: ProviderReconciliationHint[]};
const MAX_ROWS = 100_000;

/** Reads real Canonical Evidence and ProviderOps; no legacy Run/Segment fabrication. */
export class CanonicalProviderClosureSource implements ProviderEpisodeClosureDataSource {
  readonly bindingAuthorityRef = "sdar_core.sdar_evidence_v1_record:mcp_task.remote_binding" as const;
  private material: Material | undefined;
  private selectedScope: string | undefined;
  constructor(private readonly warehouse: ClosureWarehouse, readonly origin: CanonicalClosureOrigin) {
    for (const value of Object.values(origin)) if (!value || value.length > 512) throw failure("PROVIDER_ORIGIN_INVALID");
    timestamp(origin.notBefore);
  }

  async discover(after: {projectedAt: string; rowId: string}, limit = 500): Promise<Row[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw failure("PROVIDER_SCAN_LIMIT_INVALID");
    return this.rows(`SELECT row_id, episode_id, toString(projected_at) AS projected_at FROM sdar_core.sdar_evidence_v1_record FINAL
      WHERE ${this.canonicalPredicate()} AND record_type='mcp_task.remote_binding' AND episode_id IS NOT NULL
      AND (projected_at,row_id) > (parseDateTime64BestEffort(${sqlString(timestamp(after.projectedAt))},3,'UTC'),${sqlString(after.rowId)})
      ORDER BY projected_at,row_id LIMIT ${limit}`);
  }

  async capture(scope: ProviderClosureScope, asOfProjectedAt = new Date().toISOString()): Promise<ProviderClosureCapture> {
    this.checkScope(scope);
    const asOf = timestamp(asOfProjectedAt);
    const boundRows = await this.all(`SELECT row_id AS identity, record_json FROM sdar_core.sdar_evidence_v1_record FINAL
      WHERE ${this.canonicalPredicate()} AND episode_id=${sqlString(scope.episodeId)} AND record_type='mcp_task.remote_binding'
      AND projected_at<=parseDateTime64BestEffort(${sqlString(asOf)},3,'UTC')`, "identity");
    const versions = new Map<string, ProviderRemoteTaskBinding>();
    for (const row of boundRows) {
      const binding = canonicalBinding(row, scope);
      const prior = versions.get(binding.bindingId);
      if (prior && prior.revision === binding.revision && hash(prior) !== hash(binding)) throw failure("PROVIDER_BINDING_CONFLICT");
      if (!prior || BigInt(binding.revision) > BigInt(prior.revision)) versions.set(binding.bindingId, binding);
    }
    const bindings = [...versions.values()].sort((a,b)=>a.bindingId.localeCompare(b.bindingId));
    // A fact needs the complete authoritative tuple; origin/trace hints never choose it.
    const tuples = bindings.map(binding => `(external_task_id=${sqlString(binding.remoteTaskId)} AND smpp_source_id=${sqlString(binding.providerOriginSourceId)} AND provider_id=${sqlString(binding.externalProviderId)})`);
    const factRows = tuples.length === 0 ? [] : await this.all(`SELECT toString(fact_id) AS identity, * FROM sdar_core.external_provider_fact FINAL
      WHERE ${this.scopePredicate()} AND (${tuples.join(" OR ")})
      AND projected_at>=parseDateTime64BestEffort(${sqlString(this.origin.notBefore)},3,'UTC')
      AND projected_at<=parseDateTime64BestEffort(${sqlString(asOf)},3,'UTC')`, "identity");
    const facts = factRows.map(row => providerFact(row, scope));
    const selectedIds = facts.map(fact=>sqlString(fact.factId));
    const hintRows = selectedIds.length === 0 ? [] : await this.all(`SELECT toString(relation_id) AS identity, * FROM sdar_core.external_entity_relation_fact FINAL
      WHERE ${this.scopePredicate()} AND hasAny(arrayMap(x->toString(x),evidence_fact_ids),[${selectedIds.join(",")}])
      AND projected_at>=parseDateTime64BestEffort(${sqlString(this.origin.notBefore)},3,'UTC')
      AND projected_at<=parseDateTime64BestEffort(${sqlString(asOf)},3,'UTC')`, "identity");
    const hints = hintRows.map(row=>({relationId: text(row,"identity"),relationType:text(row,"relation_type"),
      producerSystem:text(row,"source_system"),projectionId:text(row,"projection_id"),confidenceClass:text(row,"confidence_class"),
      bindingSource:text(row,"binding_source"),evidenceFactIds:strings(row["evidence_fact_ids"]),sourceRecordHash:digest(text(row,"source_record_hash")),
      projectedAt:timestamp(text(row,"projected_at")),authority:false,maySelectFacts:false,mayOverrideBinding:false} as const));
    this.material = {bindings, facts, hints};
    this.selectedScope = hash({scope:{tenantId:scope.tenantId,projectId:scope.projectId,environment:scope.environment,episodeId:scope.episodeId},asOf});
    return {asOfProjectedAt:asOf,effectiveWatermark:[this.origin.notBefore,...bindings.map(x=>x.updatedAt),...facts.map(x=>x.projectedAt)].sort().at(-1)!,
      bindingCount:bindings.length,expectedFactCount:facts.length,identityHash:hash(this.material)};
  }

  async listBindings(input: Parameters<ProviderEpisodeClosureDataSource["listBindings"]>[0]): Promise<ProviderEvidencePage<ProviderRemoteTaskBinding>> {
    return this.page(this.current(input).bindings,input.cursor,input.limit);
  }
  async listFacts(input: Parameters<ProviderEpisodeClosureDataSource["listFacts"]>[0]): Promise<ProviderEvidencePage<ProviderClosureFact>> {
    return this.page(this.current(input).facts,input.cursor,input.limit);
  }
  async listRelationHints(input: Parameters<ProviderEpisodeClosureDataSource["listRelationHints"]>[0]): Promise<ProviderEvidencePage<ProviderReconciliationHint>> {
    return this.page(this.current(input).hints,input.cursor,input.limit);
  }
  private current(input: {scope: ProviderClosureScope;asOfProjectedAt: string}): Material {
    if (!this.material || this.selectedScope !== hash({scope:{tenantId:input.scope.tenantId,projectId:input.scope.projectId,environment:input.scope.environment,episodeId:input.scope.episodeId},asOf:timestamp(input.asOfProjectedAt)})) throw failure("PROVIDER_CAPTURE_REQUIRED");
    return this.material;
  }
  private page<T>(all: readonly T[], cursor: string|null, limit: number): ProviderEvidencePage<T> {
    const offset=cursor===null?0:Number(cursor);
    if (!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>10000) throw failure("PROVIDER_CURSOR_INVALID");
    const items=all.slice(offset,offset+limit); const hasMore=offset+items.length<all.length;
    return {items,nextCursor:hasMore?String(offset+items.length):null,hasMore,pageHash:hash({offset,items})};
  }
  private checkScope(scope: ProviderClosureScope): void {
    if(scope.tenantId!==this.origin.tenantId||scope.projectId!==this.origin.projectId||scope.environment!==this.origin.environment||!scope.episodeId)throw failure("PROVIDER_SCOPE_CONFLICT");
  }
  private scopePredicate(): string {
    return `tenant_id=${sqlString(this.origin.tenantId)} AND project_id=${sqlString(this.origin.projectId)} AND environment=${sqlString(this.origin.environment)}`;
  }
  private canonicalPredicate(): string {
    return `${this.scopePredicate()} AND export_id=${sqlString(this.origin.exportId)} AND source_id=${sqlString(this.origin.sourceId)} AND batch_node_id=${sqlString(this.origin.nodeId)}
      AND ingested_at>=parseDateTime64BestEffort(${sqlString(this.origin.notBefore)},3,'UTC')`;
  }
  private async rows(sql: string): Promise<Row[]> {
    const result=await this.warehouse.query(`${sql} FORMAT JSONEachRow`);
    return result.trim()===""?[]:result.trim().split("\n").map(line=>object(JSON.parse(line)));
  }
  private async all(base: string, identity: string): Promise<Row[]> {
    const result: Row[]=[];let cursor="";
    for(;;){
      const page=await this.rows(`SELECT * FROM (${base}) WHERE ${identity}>${sqlString(cursor)} ORDER BY ${identity} LIMIT 1000`);
      result.push(...page);
      if(result.length>MAX_ROWS)throw failure("PROVIDER_EVIDENCE_VOLUME_LIMIT_EXCEEDED");
      if(page.length<1000)return result;
      const next=text(page[page.length-1],identity);if(next<=cursor)throw failure("PROVIDER_CURSOR_INVALID");cursor=next;
    }
  }
}

export function canonicalBinding(row: Row, scope: ProviderClosureScope): ProviderRemoteTaskBinding {
  const record=object(JSON.parse(text(row,"record_json"))); const payload=object(record["payload"]);
  const provider=object(payload["providerAuthority"]);
  if(record["recordType"]!=="mcp_task.remote_binding" || record["episodeId"]!==scope.episodeId || record["tenantId"]!==scope.tenantId || record["projectId"]!==scope.projectId || record["environment"]!==scope.environment ||
    provider["schemaVersion"]!=="runtime.remote-task-provider-authority/v1" || provider["authoritySource"]!=="remote_task_binding.authority_snapshot_json" ||
    payload["providerAuthorityHash"]!==hash(provider) || record["payloadHash"]!==hash(payload))throw failure("PROVIDER_CANONICAL_BINDING_INVALID");
  const revision=String(payload["version"]);if(!/^[1-9][0-9]*$/u.test(revision))throw failure("PROVIDER_BINDING_REVISION_INVALID");
  return {...scope,bindingId:text(payload,"bindingId"),a2aTaskId:text(record,"taskId"),remoteTaskId:text(payload,"remoteTaskId"),
    providerOriginSourceId:text(provider,"providerSourceId"),externalProviderId:text(provider,"providerId"),revision,
    status:text(payload,"localState"),updatedAt:timestamp(text(record,"recordedAt"))};
}
function providerFact(row: Row, scope: ProviderClosureScope): ProviderClosureFact {
  return {...scope,factId:text(row,"identity"),factHash:digest(text(row,"fact_hash")),factType:text(row,"fact_type"),
    smppSourceId:text(row,"smpp_source_id"),providerId:text(row,"provider_id"),
    ...(row["provider_instance_id"] ? {providerInstanceId:text(row,"provider_instance_id")} : {}),
    externalTaskId:text(row,"external_task_id"),occurredAt:timestamp(text(row,"occurred_at")),projectedAt:timestamp(text(row,"projected_at")),
    sourceRecordId:text(row,"source_record_id"),sourceRecordHash:digest(text(row,"source_record_hash")),
    originRuntimeInstanceIds:strings(row["origin_sdar_runtime_ids"]),originTaskIds:strings(row["origin_sdar_task_ids"]),originInvocationIds:strings(row["origin_sdar_invocation_ids"])};
}
export function object(value: unknown): Row {if(!value||typeof value!=="object"||Array.isArray(value))throw failure("PROVIDER_ROW_INVALID");return value as Row;}
export function text(row: Row,key: string): string {const value=row[key];if(typeof value!=="string"||!value)throw failure("PROVIDER_FIELD_INVALID");return value;}
export function timestamp(value: string): string {const date=new Date(value.endsWith("Z")||/[+-]\d\d:\d\d$/u.test(value)?value:value.replace(" ","T")+"Z");if(!Number.isFinite(date.getTime()))throw failure("PROVIDER_TIMESTAMP_INVALID");return date.toISOString();}
function strings(value: unknown): string[]{if(!Array.isArray(value)||!value.every(x=>typeof x==="string"))throw failure("PROVIDER_ARRAY_INVALID");return value;}
function digest(value: string): string {const normalized=value.startsWith("sha256:")?value:`sha256:${value}`;if(!/^sha256:[0-9a-f]{64}$/u.test(normalized))throw failure("PROVIDER_HASH_INVALID");return normalized;}
export function sqlString(value: string): string {return `'${value.replaceAll("\\","\\\\").replaceAll("'","\\'")}'`;}
export function failure(code: string): Error & {code: string} {return Object.assign(new Error(code),{code});}
