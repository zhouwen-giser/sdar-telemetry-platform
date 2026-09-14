#!/usr/bin/env python3
"""Exercise real Gateway/WAL/Worker against a disposable 25.3.14.14 warehouse."""
import json, os, subprocess, time
from deploy import ROOT, STATE, ch, run, save, verify

def main():
    manifest=verify();image='sdar-telemetry:'+manifest['sourceHash'][:16]
    name='sdar-telemetry-e2e-'+str(os.getpid())
    def sql(text):
        return run(['docker','exec','-i',name,'clickhouse-client','--user','site_test','--password','isolated-test-only','--multiquery'],text,True)
    run(['docker','run','-d','--name',name,'--network','none','--label','io.sdar.temporary=evidence-test','-e','CLICKHOUSE_USER=site_test','-e','CLICKHOUSE_PASSWORD=isolated-test-only','clickhouse/clickhouse-server:25.3.14.14'],capture=True)
    try:
        for _ in range(40):
            p=subprocess.run(['docker','exec',name,'clickhouse-client','--user','site_test','--password','isolated-test-only','--query','SELECT 1'],capture_output=True)
            if p.returncode==0:break
            time.sleep(1)
        else:raise ValueError('ISOLATED_CH_NOT_READY')
        sql((ROOT/'migrations/clickhouse/014_sdar_evidence_v1_canonical.sql').read_text())
        # Schema only: no production records, credentials, WAL or control state are copied.
        for table in ['node_capability_version_fact','a2a_exposure_revision_fact','agent_card_revision_fact']:
            ddl=json.loads(ch('SHOW CREATE TABLE sdar_core.'+table+' FORMAT JSON'))['data'][0]['statement']
            sql(ddl)
        result=run(['docker','run','--rm','--network','container:'+name,'-e','SDAR_ISOLATED_TEST=true','-v',str(ROOT/'deploy/sz-gowm/isolated-evidence.mjs')+':/run/isolated-evidence.mjs:ro',image,'node','/run/isolated-evidence.mjs'],capture=True)
        save(STATE/'isolated-evidence.json',json.loads(result));print(result)
    finally:run(['docker','rm','-f','-v',name],capture=True)
if __name__=='__main__':main()
