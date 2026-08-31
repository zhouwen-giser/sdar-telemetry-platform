import { hashCanonicalDomainProjectionJson as hash } from "../../telemetry-contracts/src/index.js";
import type { ProviderEpisodeClosure } from "./closure-v2.js";
import { failure, type ClosureWarehouse } from "./canonical-closure-source.js";

export const PROVIDER_CLOSURE_TABLES = ["provider_closure_binding_v2","provider_closure_fact_v2","provider_closure_relation_v2","provider_closure_reconciliation_v2","provider_closure_task_semantic_v2","provider_closure_manifest_v2"] as const;

export function closurePublication(closure: ProviderEpisodeClosure): {snapshotId: string; rows: Readonly<Record<typeof PROVIDER_CLOSURE_TABLES[number], Record<string,unknown>[]>>} {
  const snapshotId=hash(closure); const {scope,snapshot}=closure;
  const base={tenant_id:scope.tenantId,project_id:scope.projectId,environment:scope.environment,episode_id:scope.episodeId,
    closure_snapshot_id:snapshotId,projected_at:snapshot.asOfProjectedAt};
  const bindings=closure.closure.authoritativeBindings;
  return {snapshotId,rows:{
    provider_closure_binding_v2:bindings.map(b=>({...base,binding_id:b.bindingId,a2a_task_id:b.a2aTaskId,remote_task_id:b.remoteTaskId,
      provider_origin_source_id:b.providerOriginSourceId,external_provider_id:b.externalProviderId,external_provider_instance_id:b.externalProviderInstanceId??null,
      binding_revision:b.revision,updated_at:b.updatedAt})),
    provider_closure_fact_v2:closure.closure.providerFacts.map(f=>{
      const matches=bindings.filter(b=>b.remoteTaskId===f.externalTaskId&&b.providerOriginSourceId===f.smppSourceId&&b.externalProviderId===f.providerId&&(!b.externalProviderInstanceId||b.externalProviderInstanceId===f.providerInstanceId));
      const b=matches[0];if(matches.length!==1||!b)throw failure("PROVIDER_PUBLICATION_BINDING_CONFLICT");
      return {...base,binding_id:b.bindingId,remote_task_id:b.remoteTaskId,provider_origin_source_id:f.smppSourceId,
        external_provider_id:f.providerId,external_provider_instance_id:f.providerInstanceId??null,fact_id:f.factId,fact_hash:f.factHash,fact_type:f.factType,
        source_record_id:f.sourceRecordId,source_record_hash:f.sourceRecordHash,external_task_id:f.externalTaskId,
        external_execution_id:f.externalExecutionId??null,occurred_at:f.occurredAt,observed_at:f.observedAt??null};}),
    provider_closure_relation_v2:closure.closure.bindingDerivedRelations.map(r=>({...base,binding_id:r.bindingId,relation_id:r.relationId,authority_source:r.authoritySource,content_hash:r.contentHash})),
    provider_closure_reconciliation_v2:closure.reconciliation.results.map(r=>({...base,claim_id:r.claimId,claim_type:r.claimType,claim_values:r.claimValues,
      authoritative_refs:r.authoritativeRefs,status:r.status,blocking:r.blocking,reason_codes:r.reasonCodes,evidence_fact_ids:r.evidenceFactIds,
      relation_hint_ids:r.relationHintIds,policy_id:r.policyRef.id,policy_version:String(r.policyRef.version)})),
    provider_closure_task_semantic_v2:closure.closure.taskSemantics.map(item=>({...base,binding_id:item.bindingId,
      remote_task_id:item.taskExecution.remoteTaskId,provider_source_id:item.taskExecution.providerSourceId,provider_id:item.taskExecution.providerId,
      provider_instance_id:item.taskExecution.providerInstanceId??null,execution_status:item.taskExecution.status,
      candidate_execution_ids:item.taskExecution.candidateExecutionIds,selected_execution_id:item.taskExecution.selectedExecutionId??null,
      execution_source_fact_ids:item.taskExecution.sourceFactIds,execution_source_relation_ids:item.taskExecution.sourceRelationIds,
      identity_conflict:item.taskExecution.identityConflict,dispatch_status:item.dispatch.status,reconciliation_status:item.dispatch.reconciliationStatus,
      uncertainty_fact_ids:item.dispatch.uncertaintyFactIds,reconciliation_fact_ids:item.dispatch.reconciliationFactIds,
      mcp_task_control_state:item.terminal.mcpTaskControlState,provider_execution_state:item.terminal.providerExecutionState,
      provider_business_outcome:item.terminal.providerBusinessOutcome,terminal_fact_ids:item.terminal.terminalFactIds,
      terminal_conflict:item.terminal.conflict,mission_status:item.mission.status,device_mission_ids:item.mission.deviceMissionIds,
      mission_source_fact_ids:item.mission.sourceFactIds,mission_source_relation_ids:item.mission.sourceRelationIds,
      reason_codes:item.reasonCodes,content_hash:item.contentHash})),
    provider_closure_manifest_v2:[{...base,binding_count:closure.closure.bindingCount,binding_derived_relation_count:closure.closure.bindingDerivedRelationCount,
      expected_fact_count:closure.closure.expectedFactCount,selected_fact_count:closure.closure.selectedFactCount,foreign_fact_count:closure.closure.foreignFactCount,
      unresolved_binding_count:closure.closure.unresolvedBindingCount,unresolved_execution_count:closure.closure.unresolvedExecutionCount,
      conflicting_execution_count:closure.closure.conflictingExecutionCount,uncertain_dispatch_count:closure.closure.uncertainDispatchCount,
      unresolved_reconciliation_count:closure.closure.unresolvedReconciliationCount,terminal_conflict_count:closure.closure.terminalConflictCount,
      identity_hash_conflict_count:closure.closure.identityHashConflictCount,page_count:closure.pagination.pageCount,truncated:closure.closure.truncated,hints_used_for_authority:false,
      binding_authority_hash:closure.provenance.bindingAuthorityHash,binding_authority_ref:closure.provenance.bindingAuthorityRef,
      as_of_projected_at:snapshot.asOfProjectedAt,effective_watermark:snapshot.effectiveWatermark,selection_predicate_hash:snapshot.selectionPredicateHash,
      reconciliation_hash:closure.reconciliation.reconciliationHash,closure_content_hash:closure.closure.closureContentHash,status:closure.readiness.status,
      reason_codes:closure.readiness.reasonCodes,origin_claim_count:closure.reconciliation.originClaimCount,relation_hint_count:closure.reconciliation.relationHintCount,
      matched_claim_count:closure.reconciliation.matchedCount,missing_claim_count:closure.reconciliation.missingCount,unverifiable_claim_count:closure.reconciliation.unverifiableCount,
      ambiguous_claim_count:closure.reconciliation.ambiguousCount,conflicting_claim_count:closure.reconciliation.conflictingCount,
      goal_success_proven:false,physical_success_proven:false,provenance_json:JSON.stringify(closure.provenance)}]
  }};
}

/** The caller fences its PostgreSQL lease around commitManifest, not around detail retries. */
export async function publishClosureDetails(warehouse: ClosureWarehouse, closure: ProviderEpisodeClosure): Promise<() => Promise<void>> {
  const publication=closurePublication(closure);
  const insert=async (table:typeof PROVIDER_CLOSURE_TABLES[number]):Promise<void>=>{
    const rows=publication.rows[table];
    for(let offset=0;offset<rows.length;offset+=1000)await warehouse.insert(`sdar_mart.${table}`,rows.slice(offset,offset+1000),
      {deduplicationToken:hash({snapshotId:publication.snapshotId,table,offset}).slice(7)});
  };
  for(const table of PROVIDER_CLOSURE_TABLES.slice(0,-1))await insert(table);
  return ()=>insert("provider_closure_manifest_v2");
}
