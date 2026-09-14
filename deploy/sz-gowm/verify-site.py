#!/usr/bin/env python3
"""Read-only site acceptance; no synthetic business events or destructive permission probes."""
import json, urllib.request, urllib.error
from deploy import ROOT, STATE, SERVICES, PORTS, ch, dc, read, run, save, verify, api

def request(port,path,method='GET',headers=None,data=None):
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,method=method,headers=headers or {},data=data)
    try:
        with urllib.request.urlopen(req,timeout=15) as r:return r.status,None if method=='HEAD' else json.load(r)
    except urllib.error.HTTPError as e:return e.code,None

def main():
    manifest=verify();results={}
    for name,port in PORTS.items():
        status,body=request(port,'/health');assert status==200;results[name]={'health':status}
    for path in ['/v1/metrics?limit=1','/v1/traces?limit=1']:
        status,body=request(28081,path);assert status==200
        results[path]={'status':status,'rows':len(body.get('data',[]))}
    header={'x-sdar-evidence-contract':'sdar.evidence/v1'}
    assert request(28080,'/v1/evidence/batches','HEAD',header)[0]==401
    for name,expected in [('domain-token',401),('evidence-token',204)]:
        credential=(STATE/name).read_text().strip()
        assert request(28080,'/v1/evidence/batches','HEAD',header|{'Authorization':'Bearer '+credential})[0]==expected
    assert request(28082,'/v1/admin/domain-source-producers','POST',{'Content-Type':'application/json'},b'{}')[0]==400
    assert request(28081,'/v1/metrics?endpoint=http://example.invalid')[0]==400
    domain=request(28083,'/status')[1]
    assert domain['controlPostgresReady'] and domain['clickHouseReady']
    assert len(domain['projections'])==10 and not domain['sources']
    assert all(p['lifecycle']!='ACTIVE' and p['lastErrorCode']=='DOMAIN_SOURCE_PRODUCER_NOT_REGISTERED' and not p['schemaDrift'] for p in domain['projections'])
    results['domain']={'projections':10,'status':'missing_real_producers','maxMode':'shadow','activated':False}
    provider=json.loads(dc('exec','-T','telemetry-worker','node','dist/scripts/provider-closure-debug.js','status',capture=True))
    results['provider']=provider
    evidence=api('/status')[1];assert evidence['status']=='healthy' and evidence['activeRevision']==1;results['evidence']=evidence
    rows=json.loads(ch("SELECT count() AS rows,uniqExact(record_id) AS records,max(toUInt64(evidence_sequence)) AS lastSequence FROM sdar_core.sdar_evidence_v1_record FINAL WHERE export_id='sz-gowm-incremental-evidence' FORMAT JSON"))['data'][0]
    assert int(rows['rows'])>0;results['warehouse']=rows
    def own_grants(service,prefix):
        script="import {ClickHouseClient,configFromEnv} from './dist/packages/telemetry-clickhouse/src/index.js'; console.log(await new ClickHouseClient(configFromEnv("+json.dumps(prefix)+")).query('SHOW GRANTS'));"
        return dc('exec','-T',service,'node','--input-type=module','-e',script,capture=True)
    grants=own_grants('query-api','CLICKHOUSE_QUERY_')
    assert 'INSERT' not in grants and 'CREATE' not in grants
    writer=own_grants('telemetry-worker','CLICKHOUSE_')
    assert 'INSERT' in writer and 'CREATE' not in writer
    results['permissions']={'readerNoWriteOrDdl':True,'writerNoDdl':True,'separateIngestTokens':True}
    secrets=[(STATE/n).read_bytes().strip() for n in ['postgres-password','evidence-token','domain-token','query-token','admin-token','warehouse-password','warehouse-query-password']]
    assert all(not any(secret in (ROOT/name).read_bytes() for secret in secrets) for name in manifest['files'])
    containers=json.loads(run(['docker','inspect',*[f'sdar-telemetry-{s}-1' for s in [*SERVICES,'control-postgres']]],capture=True))
    results['containers']=[{'name':c['Name'],'id':c['Id'],'imageId':c['Image'],'status':c['State']['Status'],'startedAt':c['State']['StartedAt'],'health':c['State'].get('Health',{}).get('Status')} for c in containers]
    results.update({'status':'PASS','sourceHash':manifest['sourceHash'],'packageSecretScan':'PASS'})
    save(STATE/'acceptance.json',results)
    print(json.dumps(results))
if __name__=='__main__':main()
