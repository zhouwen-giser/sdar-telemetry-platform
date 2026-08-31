import {randomBytes} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import type {Server} from "node:http";
import os from "node:os";
import path from "node:path";
import {Pool} from "pg";

import {createIngestionGateway,EVIDENCE_CONTRACT_HEADER,EVIDENCE_CONTRACT_VERSION} from "../apps/ingestion-gateway/src/server.js";
import {TelemetryWorker} from "../apps/telemetry-worker/src/worker.js";
import {ClickHouseClient,configFromEnv} from "../packages/telemetry-clickhouse/src/index.js";
import {ProviderClosureRuntime,type ProviderClosureRegistration} from "../packages/telemetry-control-postgres/src/provider-closure-runtime.js";
import {createEvidenceRecordId,hashCanonicalEvidenceJson,loadEvidenceV1Validator} from "../packages/telemetry-contracts/src/index.js";
import {ProjectionRegistry,canonicalProjection,smppProjection,v13Projection,v14Projection} from "../packages/telemetry-projection-registry/src/index.js";
import {sqlString} from "../packages/telemetry-smpp-consumer/src/canonical-closure-source.js";
import type {EvidenceV1BatchRequest,EvidenceV1JsonValue,EvidenceV1Record,EvidenceV1WalPayload} from "../packages/telemetry-types/src/index.js";
import {DurableSegmentWal,evidenceWalPartition} from "../packages/telemetry-wal/src/index.js";

const runId=required("PROVIDER_CLOSURE_NORMAL_RUN_ID",/^[a-z0-9][a-z0-9-]{7,63}$/u);
const remoteTaskId=required("PROVIDER_CLOSURE_REMOTE_TASK_ID",/^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/u);
const externalExecutionId=required("PROVIDER_CLOSURE_EXTERNAL_EXECUTION_ID",/^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/u);
const controlPostgresUrl=required("SDAR_TEST_CONTROL_POSTGRES_URL",/^postgres(?:ql)?:\/\//u);
const providerInstanceId=process.env["PROVIDER_CLOSURE_PROVIDER_INSTANCE_ID"]??"smpp-runtime-postgres-authority";
const at=new Date().toISOString();
const episodeId=`episode-${runId}`;
const bindingId=`binding-${runId}`;
const intentId=`intent-${runId}`;
const attemptId=`attempt-${runId}`;
const logicalInvocationId=`logical-${runId}`;
const runtimeServerId=`sdar-runtime-${runId}`;
const scope={tenantId:"qualification",projectId:"smpp-runtime-sync-v0.1",environment:"qualification",episodeId};
const registration:ProviderClosureRegistration={originId:"provider-closure-normal-e2e-20260831",tenantId:scope.tenantId,projectId:scope.projectId,
  environment:scope.environment,exportId:"provider-closure-normal-e2e-export",sourceId:"provider-closure-normal-e2e-source",nodeId:"provider-closure-normal-e2e-node"};
const authority={schemaVersion:"runtime.remote-task-provider-authority/v1",authoritySource:"remote_task_binding.authority_snapshot_json",
  providerBindingId:`provider-binding-${runId}`,providerBindingRevision:1,providerOriginType:"smpp_registry",providerId:"provider-a",
  providerSourceId:"smpp.qualification.runtime-sync",externalServerId:providerInstanceId,runtimeServerId,
  runtimeToolRevision:1,protocolSnapshotId:`protocol-${runId}`,catalogRevision:"runtime-sync-v0.1",catalogChecksum:hashCanonicalEvidenceJson(runId),capturedAt:at};
const providerLinkIdentity={bindingId,logicalInvocationId,remoteTaskId};
const providerLinkDomain={schemaVersion:"sdar.remote-task-provider-execution-link/v1",bindingId,logicalInvocationId,remoteTaskId,
  providerId:"provider-a",runtimeServerId,providerBindingId:`provider-binding-${runId}`,providerOriginType:"smpp_registry",
  smppSourceId:"smpp.qualification.runtime-sync",externalServerId:providerInstanceId,operationName:"navigate",executionStatus:"exact",
  externalExecutionId,missionStatus:"unresolved",provenance:"reconcile_found_exact",sourceContract:"sdar.node-control-provider-binding/v1+frozen-mcp-v1",
  sourceRevision:"1",observedAt:at};
const providerLink={linkId:`remote-provider-link-${hashCanonicalEvidenceJson(providerLinkIdentity).slice("sha256:".length)}`,...providerLinkDomain,
  contentHash:hashCanonicalEvidenceJson(providerLinkDomain)};
const definitions=[
  ["mcp_task.remote_binding","remote_task_binding",bindingId,{bindingId,remoteTaskId,version:1,protocolStatus:"completed",localState:"completed",taskHandleReturned:true,providerAuthority:authority,providerAuthorityHash:hashCanonicalEvidenceJson(authority)}],
  ["mcp_task.admission","remote_task_admission_intent",intentId,{intentId,invocationId:`invocation-${runId}`,bindingId,status:"uncertain",dispatchHash:hashCanonicalEvidenceJson(remoteTaskId),dispatchedAt:at,reasonCode:"REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN",redispatchAllowed:false}],
  ["mcp_task.dispatch_uncertain","remote_task_reconciliation_attempt[dispatch_outcome=uncertain]",attemptId,{intentId,logicalInvocationId,reasonCode:"REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN",redispatchAllowed:false}],
  ["mcp_task.dispatch_reconciliation","remote_task_reconciliation_attempt",attemptId,{attemptId,intentId,logicalInvocationId,status:"found_exact",identityValidated:true,remoteTaskId,externalExecutionId,safeErrorCode:null,sourceContract:"sdar.smpp-diagnostics/v1+frozen-mcp-v1",requestHash:hashCanonicalEvidenceJson(intentId),resultHash:hashCanonicalEvidenceJson(externalExecutionId),redispatchAllowed:false}],
  ["mcp_task.provider_execution_link","remote_task_provider_execution_link",providerLink.linkId,{linkId:providerLink.linkId,bindingId,logicalInvocationId,remoteTaskId,providerId:providerLink.providerId,runtimeServerId,
    providerBindingId:providerLink.providerBindingId,providerOriginType:providerLink.providerOriginType,smppSourceId:providerLink.smppSourceId,externalServerId:providerInstanceId,
    operationName:providerLink.operationName,executionStatus:providerLink.executionStatus,externalExecutionId,missionStatus:providerLink.missionStatus,deviceMissionId:null,
    provenance:providerLink.provenance,sourceContract:providerLink.sourceContract,sourceRevision:providerLink.sourceRevision,contentHash:providerLink.contentHash}],
  ["mcp_task.control_event","remote_task_control_event",`control-${runId}`,{eventId:`control-${runId}`,bindingId,eventType:"task.completed",status:"processed",persistedBeforeContinue:true,payload:{source:"contract-e2e"}}],
] as const;
const records=definitions.map(([recordType,sourceTable,sourceRecordId,payload],index)=>record(recordType,sourceTable,sourceRecordId,payload,index+1));
const unsigned={contractVersion:"sdar.evidence/v1",exportId:registration.exportId,sourceId:registration.sourceId,nodeId:registration.nodeId,revision:1,
  firstSequence:"1",lastSequence:String(records.length),records} satisfies Omit<EvidenceV1BatchRequest,"batchHash">;
const batch={...unsigned,batchHash:hashCanonicalEvidenceJson(unsigned)} satisfies EvidenceV1BatchRequest;
const validator=await loadEvidenceV1Validator();validator.assertBatch(batch);
const root=await mkdtemp(path.join(os.tmpdir(),`provider-closure-normal-${runId}-`));
const wal=new DurableSegmentWal<EvidenceV1WalPayload>(path.join(root,"wal"));
const token=randomBytes(32).toString("base64url");let gateway:Server|undefined;
const clickhouse=new ClickHouseClient(configFromEnv());const pool=new Pool({connectionString:controlPostgresUrl,max:2});
try{
  gateway=createIngestionGateway({validator,wal,bearerCredential:token});const endpoint=await listen(gateway);
  const first=await post(endpoint,token,batch);const duplicate=await post(endpoint,token,batch);
  const registry=new ProjectionRegistry();for(const projection of [canonicalProjection,v13Projection,v14Projection,smppProjection])registry.register(projection);
  const worker=new TelemetryWorker({wal,clickhouse,projector:registry,stateRoot:path.join(root,"state")});const cycle=await worker.processOnce();
  const partition=evidenceWalPartition({exportId:batch.exportId,sourceId:batch.sourceId,nodeId:batch.nodeId,revision:batch.revision});
  if(cycle.framesCompleted!==1||await worker.checkpoint(partition)!==0)throw new Error("PROVIDER_CLOSURE_NORMAL_WORKER_FAILED");
  const runtime=new ProviderClosureRuntime(pool,clickhouse,registration);let rows:{data?:Record<string,unknown>[]}={};
  for(let attempt=0;attempt<20;attempt+=1){
    await runtime.runOnce();
    rows=JSON.parse(await clickhouse.query(`SELECT closure_snapshot_id,status,unresolved_execution_count,conflicting_execution_count,
      unresolved_reconciliation_count,terminal_conflict_count,goal_success_proven,physical_success_proven
      FROM sdar_mart.v_episode_smpp_provider_readiness WHERE tenant_id=${sqlString(scope.tenantId)} AND project_id=${sqlString(scope.projectId)}
      AND environment=${sqlString(scope.environment)} AND episode_id=${sqlString(scope.episodeId)}
      AND as_of_projected_at>=parseDateTime64BestEffort(${sqlString(at)},3,'UTC') ORDER BY projected_at DESC LIMIT 1 FORMAT JSON`,{readonly:2,maxResultRows:1})) as {data?:Record<string,unknown>[]};
    if(rows.data?.[0]!==undefined)break;
  }
  const manifest=rows.data?.[0];const snapshotId=typeof manifest?.["closure_snapshot_id"]==="string"?manifest["closure_snapshot_id"]:"";
  const semantic=JSON.parse(await clickhouse.query(`SELECT execution_status,dispatch_status,reconciliation_status,mcp_task_control_state,
    provider_execution_state,provider_business_outcome,mission_status FROM sdar_mart.v_episode_smpp_provider_task_semantic_closure
    WHERE tenant_id=${sqlString(scope.tenantId)} AND project_id=${sqlString(scope.projectId)} AND environment=${sqlString(scope.environment)}
    AND episode_id=${sqlString(scope.episodeId)} AND closure_snapshot_id=${sqlString(snapshotId)} LIMIT 1 FORMAT JSON`,{readonly:2,maxResultRows:1})) as {data?:Record<string,unknown>[]};
  const facts=JSON.parse(await clickhouse.query(`SELECT count() AS fact_count,countIf(observed_at IS NOT NULL) AS observed_fact_count
    FROM sdar_mart.v_episode_smpp_provider_fact_closure WHERE tenant_id=${sqlString(scope.tenantId)} AND project_id=${sqlString(scope.projectId)}
    AND environment=${sqlString(scope.environment)} AND episode_id=${sqlString(scope.episodeId)}
    AND closure_snapshot_id=${sqlString(snapshotId)} FORMAT JSON`,{readonly:2,maxResultRows:1})) as {data?:Record<string,unknown>[]};
  const task=semantic.data?.[0],factTimes=facts.data?.[0];
  if(manifest?.["status"]!=="ready"||task?.["execution_status"]!=="exact"||task["dispatch_status"]!=="recovered"||
    factTimes===undefined||factTimes["fact_count"]!==factTimes["observed_fact_count"]||Number(factTimes["fact_count"])<1||
    manifest["goal_success_proven"]!==false||manifest["physical_success_proven"]!==false)throw new Error("PROVIDER_CLOSURE_NORMAL_SNAPSHOT_INVALID");
  process.stdout.write(JSON.stringify({event:"provider_closure.normal_path_contract_e2e",status:"passed",runId,episodeId,
    gateway:{firstStatus:first.status,duplicateStatus:duplicate.status},worker:cycle,manifest,semantic:task,providerFactTimes:factTimes,providerFactPath:"SMPP Producer -> Collector -> Processor -> sdar_core",
    runtimeEvidencePath:"Telemetry Gateway -> durable WAL -> Worker -> sdar_core",closurePath:"ProviderClosureRuntime -> detail-first -> manifest-last",
    directTargetFactInsert:false,deviceControl:false})+"\n");
}finally{if(gateway)await new Promise<void>((resolve,reject)=>gateway!.close(error=>error?reject(error):resolve()));await pool.end();await rm(root,{recursive:true,force:true});}

function record(recordType:string,sourceTable:string,sourceRecordId:string,payload:EvidenceV1JsonValue,index:number):EvidenceV1Record{
  const identity={sourceSystem:"runtime" as const,sourceTable,sourceRecordId,sourceRevision:"1",schemaName:`sdar.evidence.${recordType}`,schemaVersion:1 as const};
  return {contractVersion:"sdar.evidence/v1",...identity,recordFamily:"mcp_task",recordType,recordId:createEvidenceRecordId(identity),environment:scope.environment,
    tenantId:scope.tenantId,projectId:scope.projectId,taskId:`sdar-task-${runId}`,episodeId,correlationId:`correlation-${runId}`,occurredAt:at,recordedAt:at,
    deliveryGuarantee:"durable_projection",evaluationRole:"required",evidenceRefs:[],artifactRefs:[],payloadHash:hashCanonicalEvidenceJson(payload),payload,evidenceSequence:String(index)};
}
function required(name:string,pattern:RegExp):string{const value=process.env[name];if(!value||!pattern.test(value))throw new Error(`${name}_INVALID`);return value;}
async function listen(server:Server):Promise<string>{await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});const address=server.address();if(!address||typeof address==="string")throw new Error("PROVIDER_CLOSURE_GATEWAY_LISTEN_FAILED");return `http://127.0.0.1:${String(address.port)}`;}
async function post(endpoint:string,token:string,value:EvidenceV1BatchRequest):Promise<Response>{const response=await fetch(`${endpoint}/v1/evidence/batches`,{method:"POST",headers:{authorization:`Bearer ${token}`,[EVIDENCE_CONTRACT_HEADER]:EVIDENCE_CONTRACT_VERSION,"content-type":"application/json"},body:JSON.stringify(value)});if(!response.ok)throw new Error(`PROVIDER_CLOSURE_GATEWAY_${String(response.status)}`);return response;}
