import { createHash } from "node:crypto";

import { ClickHouseClient, configFromEnv } from "../packages/telemetry-clickhouse/src/index.js";
import { sqlString } from "../packages/telemetry-smpp-consumer/src/canonical-closure-source.js";
import { publishClosureDetails, closurePublication } from "../packages/telemetry-smpp-consumer/src/closure-publisher.js";
import {
  assembleProviderEpisodeClosure,
  type ProviderClosureCapture,
  type ProviderClosureFact,
  type ProviderClosureScope,
  type ProviderEpisodeClosureDataSource,
  type ProviderEvidencePage,
  type ProviderReconciliationHint,
  type ProviderRemoteTaskBinding,
  type ProviderRuntimeEvidence,
} from "../packages/telemetry-smpp-consumer/src/closure-v2.js";

const runId=process.env["PROVIDER_CLOSURE_QUALIFICATION_RUN_ID"];
if(!runId||!/^[a-z0-9][a-z0-9-]{7,63}$/u.test(runId))throw new Error("PROVIDER_CLOSURE_QUALIFICATION_RUN_ID_INVALID");
const at="2026-08-31T08:00:00.000Z";
const scope={tenantId:"contract-e2e",projectId:"provider-closure",environment:"qualification",episodeId:`episode-${runId}`} as const;
const binding:ProviderRemoteTaskBinding={...scope,bindingId:`binding-${runId}`,a2aTaskId:`task-${runId}`,remoteTaskId:`remote-${runId}`,
  providerOriginSourceId:"smpp-runtime-sync",externalProviderId:"provider-a",externalProviderInstanceId:"smpp-runtime-postgres-authority",revision:"1",status:"active",updatedAt:at};
const executionId=`execution-${runId}`;
const fact=(suffix:string,semantics:NonNullable<ProviderClosureFact["providerOpsSemantics"]>):ProviderClosureFact=>({
  ...scope,factId:`fact-${suffix}-${runId}`,factHash:sha({suffix,semantics}),factType:suffix==="terminal"?"provider.task.lifecycle":"provider.recovery.lifecycle",
  smppSourceId:binding.providerOriginSourceId,providerId:binding.externalProviderId,providerInstanceId:binding.externalProviderInstanceId,
  externalTaskId:binding.remoteTaskId,externalExecutionId:executionId,occurredAt:at,observedAt:at,projectedAt:at,
  sourceRecordId:`record-${suffix}-${runId}`,sourceRecordHash:sha(`record-${suffix}-${runId}`),providerOpsSemantics:semantics,
});
const common={contractId:"smpp.runtime-providerops-semantics/v1" as const,capabilityIds:[] as string[]};
const facts=[
  fact("uncertain",{...common,uncertainty:{taskId:binding.remoteTaskId,uncertaintyClass:"response_lost_after_adapter_success",redispatchAllowed:false,occurredAt:at}}),
  fact("reconcile",{...common,reconciliation:{taskId:binding.remoteTaskId,attempt:1,status:"found",externalExecutionId:executionId,identityValidated:true,occurredAt:at}}),
  fact("terminal",{...common,businessTerminal:{taskId:binding.remoteTaskId,mcpTaskStatus:"failed",transportStatus:"completed",providerExecutionStatus:"terminal_failed",businessStatus:"failed",isError:true}}),
];
const runtime=(suffix:string,recordType:ProviderRuntimeEvidence["recordType"],payload:Record<string,unknown>):ProviderRuntimeEvidence=>({
  rowId:`runtime-${suffix}-${runId}`,sourceRecordId:`runtime-source-${suffix}-${runId}`,recordType,payload,payloadHash:sha(payload),recordedAt:at,projectedAt:at,
});
const runtimeEvidence=[
  runtime("admission","mcp_task.admission",{intentId:`intent-${runId}`,bindingId:binding.bindingId,status:"uncertain",redispatchAllowed:false}),
  runtime("uncertain","mcp_task.dispatch_uncertain",{intentId:`intent-${runId}`,reasonCode:"REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN",redispatchAllowed:false}),
  runtime("reconcile","mcp_task.dispatch_reconciliation",{intentId:`intent-${runId}`,status:"found_exact",identityValidated:true,externalExecutionId:executionId,redispatchAllowed:false}),
  runtime("link","mcp_task.provider_execution_link",{bindingId:binding.bindingId,remoteTaskId:binding.remoteTaskId,providerId:binding.externalProviderId,
    smppSourceId:binding.providerOriginSourceId,externalServerId:binding.externalProviderInstanceId,
    executionStatus:"exact",externalExecutionId:executionId,missionStatus:"unresolved",contentHash:sha(executionId)}),
  runtime("control","mcp_task.control_event",{bindingId:binding.bindingId,eventType:"task.failed",status:"processed"}),
];
class QualificationSource implements ProviderEpisodeClosureDataSource{
  constructor(private readonly binding:ProviderRemoteTaskBinding,private readonly facts:readonly ProviderClosureFact[],private readonly runtime:readonly ProviderRuntimeEvidence[]){}
  capture(_scope:ProviderClosureScope,asOfProjectedAt?:string):Promise<ProviderClosureCapture>{return Promise.resolve({asOfProjectedAt:asOfProjectedAt??at,effectiveWatermark:at,bindingCount:1,expectedFactCount:this.facts.length,identityHash:sha({binding:this.binding,facts:this.facts,runtime:this.runtime})});}
  listBindings(input:{cursor:string|null;limit:number}):Promise<ProviderEvidencePage<ProviderRemoteTaskBinding>>{return Promise.resolve(page([this.binding],input.cursor,input.limit));}
  listFacts(input:{cursor:string|null;limit:number}):Promise<ProviderEvidencePage<ProviderClosureFact>>{return Promise.resolve(page(this.facts,input.cursor,input.limit));}
  listRelationHints(input:{cursor:string|null;limit:number}):Promise<ProviderEvidencePage<ProviderReconciliationHint>>{return Promise.resolve(page([],input.cursor,input.limit));}
  listRuntimeEvidence(input:{cursor:string|null;limit:number}):Promise<ProviderEvidencePage<ProviderRuntimeEvidence>>{return Promise.resolve(page(this.runtime,input.cursor,input.limit));}
}
const source=new QualificationSource(binding,facts,runtimeEvidence);
const request={...scope,required:true,asOfProjectedAt:at};
const first=await assembleProviderEpisodeClosure(source,request);
const replay=await assembleProviderEpisodeClosure(source,request);
if(first.readiness.status!=="ready"||first.readiness.goalSuccessProven||first.readiness.physicalSuccessProven)throw new Error("PROVIDER_CLOSURE_QUALIFICATION_NOT_READY");
if(closurePublication(first).snapshotId!==closurePublication(replay).snapshotId)throw new Error("PROVIDER_CLOSURE_QUALIFICATION_NONDETERMINISTIC");
const client=new ClickHouseClient(configFromEnv());const commit=await publishClosureDetails(client,first);await commit();
const snapshotId=closurePublication(first).snapshotId;
const selected=JSON.parse(await client.query(`SELECT status,unresolved_execution_count,conflicting_execution_count,unresolved_reconciliation_count,terminal_conflict_count,goal_success_proven,physical_success_proven
  FROM sdar_mart.v_episode_smpp_provider_readiness WHERE closure_snapshot_id=${sqlString(snapshotId)} FORMAT JSON`,{readonly:2,maxResultRows:1})) as {data?:Record<string,unknown>[]};
const semantic=JSON.parse(await client.query(`SELECT execution_status,dispatch_status,reconciliation_status,mcp_task_control_state,provider_execution_state,provider_business_outcome,mission_status
  FROM sdar_mart.v_episode_smpp_provider_task_semantic_closure WHERE closure_snapshot_id=${sqlString(snapshotId)} FORMAT JSON`,{readonly:2,maxResultRows:1})) as {data?:Record<string,unknown>[]};
if(selected.data?.length!==1||semantic.data?.length!==1||selected.data[0]?.["status"]!=="ready"||semantic.data[0]?.["dispatch_status"]!=="recovered")throw new Error("PROVIDER_CLOSURE_QUALIFICATION_PUBLICATION_INVALID");
process.stdout.write(JSON.stringify({event:"provider_closure.contract_e2e",status:"passed",runId,snapshotId,readiness:first.readiness.status,
  bindingCount:first.closure.bindingCount,factCount:first.closure.selectedFactCount,executionStatus:first.closure.taskSemantics[0]?.taskExecution.status,
  dispatchStatus:first.closure.taskSemantics[0]?.dispatch.status,controlState:first.closure.taskSemantics[0]?.terminal.mcpTaskControlState,
  providerExecutionState:first.closure.taskSemantics[0]?.terminal.providerExecutionState,businessOutcome:first.closure.taskSemantics[0]?.terminal.providerBusinessOutcome,
  missionStatus:first.closure.taskSemantics[0]?.mission.status,deterministicReplay:true,goalSuccessProven:false,physicalSuccessProven:false})+"\n");

function page<T>(all:readonly T[],cursor:string|null,limit:number):ProviderEvidencePage<T>{const offset=cursor===null?0:Number(cursor),items=all.slice(offset,offset+limit),hasMore=offset+items.length<all.length;return {items,nextCursor:hasMore?String(offset+items.length):null,hasMore,pageHash:sha({offset,items})};}
function sha(value:unknown):`sha256:${string}`{return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;}
