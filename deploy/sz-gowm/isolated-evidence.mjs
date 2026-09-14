// Run only with a disposable ClickHouse and private WAL, never the site warehouse.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createIngestionGateway} from '/app/dist/apps/ingestion-gateway/src/server.js';
import {loadEvidenceV1Validator} from '/app/dist/packages/telemetry-contracts/src/index.js';
import {DurableSegmentWal,evidenceWalPartition} from '/app/dist/packages/telemetry-wal/src/index.js';
import {TelemetryWorker} from '/app/dist/apps/telemetry-worker/src/worker.js';
import {ClickHouseClient} from '/app/dist/packages/telemetry-clickhouse/src/index.js';
import {ProjectionRegistry,canonicalProjection,v13Projection,v14Projection,smppProjection} from '/app/dist/packages/telemetry-projection-registry/src/index.js';
assert.equal(process.env.SDAR_ISOLATED_TEST,'true');
const root=await mkdtemp('/tmp/sdar-site-e2e-');
const config={url:'http://127.0.0.1:8123',expectedHost:'127.0.0.1',user:'site_test',password:'isolated-test-only',secure:false,connectTimeoutMs:1000,requestTimeoutMs:5000};
const ch=new ClickHouseClient(config);
const batch=JSON.parse(await readFile('/app/integrations/skill-driven-agent-runtime/v1.4.1/reports/v1.4.1-evidence/clickhouse-handoff/sample-batches/valid-batch.json','utf8'));
const wal=new DurableSegmentWal(root+'/wal');
const validator=await loadEvidenceV1Validator();
const headers={'content-type':'application/json','authorization':'Bearer isolated-evidence-token','x-sdar-evidence-contract':'sdar.evidence/v1'};
let server;
async function start(){server=createIngestionGateway({validator,wal,bearerCredential:'isolated-evidence-token'});await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port+'/v1/evidence/batches';}
async function close(){await new Promise(r=>server.close(r));}
try{
  let endpoint=await start();
  const unauthorized=await fetch(endpoint,{method:'HEAD',headers:{'x-sdar-evidence-contract':'sdar.evidence/v1'}});assert.equal(unauthorized.status,401);
  const first=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(batch)});assert.equal(first.status,202);const ack=await first.json();
  await close();endpoint=await start();
  const repeated=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(batch)});assert.equal(repeated.status,202);assert.deepEqual(await repeated.json(),ack);
  const registry=new ProjectionRegistry();for(const p of [canonicalProjection,v13Projection,v14Projection,smppProjection])registry.register(p);
  const partition=evidenceWalPartition(batch);
  const failing=new TelemetryWorker({wal,projector:registry,clickhouse:new ClickHouseClient({...config,url:'http://127.0.0.1:1'}),stateRoot:root+'/state'});
  await assert.rejects(failing.processOnce());assert.equal(await failing.checkpoint(partition),-1);
  const worker=new TelemetryWorker({wal,projector:registry,clickhouse:ch,stateRoot:root+'/state'});
  const initial=await worker.processOnce();assert.equal(initial.framesCompleted,1);
  const count=async()=>Number(JSON.parse(await ch.query('SELECT count() AS n FROM sdar_core.sdar_evidence_v1_record FINAL FORMAT JSON')).data[0].n);
  assert.equal(await count(),batch.records.length);
  const restarted=new TelemetryWorker({wal,projector:registry,clickhouse:ch,stateRoot:root+'/state'});
  assert.equal((await restarted.processOnce()).writesCompleted,0);
  const replay=new TelemetryWorker({wal,projector:registry,clickhouse:ch,stateRoot:root+'/fresh-state'});await replay.processOnce();
  assert.equal(await count(),batch.records.length);
  console.log(JSON.stringify({status:'PASS',isolated:true,clickhouseVersion:'25.3.14.14',records:batch.records.length,gatewayRestartAckStable:true,outageCheckpointPreserved:true,restartIdle:true,replayFinalRowsStable:true,initial}));
}finally{if(server?.listening)await close();await rm(root,{recursive:true,force:true});}
