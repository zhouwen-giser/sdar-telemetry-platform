#!/usr/bin/env python3
"""Owned, repeatable sz-gowm deployment. Run on the destination host."""
import argparse, contextlib, fcntl, hashlib, json, os, pathlib, secrets, socket, subprocess, time, urllib.request, urllib.error
from config import compose, PROJECT, PORTS, SERVICES
ROOT=pathlib.Path(__file__).resolve().parents[2]
STATE=pathlib.Path('/mnt/data/sdar-telemetry-state')
CURRENT=pathlib.Path('/mnt/data/sdar-telemetry-current')
RUNTIME_COMPOSE=pathlib.Path('/mnt/data/sdar-site-20260909/config/.state/compose.json')
CH='smpp-telemetry-sdar-clickhouse-1'
def run(args, data=None, capture=False):
    return subprocess.run(args,input=data,text=True,check=True,stdout=subprocess.PIPE if capture else None).stdout
def save(p, value):
    p=pathlib.Path(p); p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_name(p.name+'.tmp');tmp.write_text(value if isinstance(value,str) else json.dumps(value,indent=2)+'\n');tmp.chmod(0o600);tmp.replace(p)
def read(p): return json.loads(pathlib.Path(p).read_text())
def verify():
    m=read(ROOT/'SITE-MANIFEST.json')
    for n,h in m['files'].items():
        p=pathlib.PurePosixPath(n)
        if p.is_absolute() or '..' in p.parts or (ROOT/n).is_symlink():raise ValueError('UNSAFE_MANIFEST')
        if hashlib.sha256((ROOT/n).read_bytes()).hexdigest()!=h:raise ValueError('PACKAGE_HASH_MISMATCH:'+n)
    if hashlib.sha256(json.dumps(m['files'],sort_keys=True).encode()).hexdigest()!=m['sourceHash']:raise ValueError('SOURCE_HASH_MISMATCH')
    return m
def dc(*args,capture=False):return run(['docker','compose','--env-file','/dev/null','-p',PROJECT,'-f',str(STATE/'compose.json'),*args],capture=capture)
def ch(sql,container=CH):
    command='exec clickhouse-client --multiquery'
    if container==CH:command+=' --user "$CLICKHOUSE_USER" --password "$(cat /run/secrets/shared-password)"'
    result=subprocess.run(['docker','exec','-i',container,'sh','-c',command],input=sql,text=True,capture_output=True)
    if result.returncode:raise ValueError('CLICKHOUSE_COMMAND_FAILED:'+str(result.returncode))
    return result.stdout
def objects(container=CH):
    predicate="(database='sdar_core' AND name='sdar_evidence_v1_record') OR (database='sdar_mart' AND (startsWith(name,'provider_closure_') OR startsWith(name,'v_episode_smpp_')))"
    tables=json.loads(ch('SELECT database,name,engine,partition_key,sorting_key,primary_key,as_select FROM system.tables WHERE '+predicate+' ORDER BY database,name FORMAT JSON',container))['data']
    columns=json.loads(ch('SELECT database,table,position,name,type,default_kind,default_expression FROM system.columns WHERE (database,table) IN (SELECT database,name FROM system.tables WHERE '+predicate+') ORDER BY database,table,position FORMAT JSON',container))['data']
    return {'tables':tables,'columns':columns}
def warehouse_check():
    version=json.loads(ch('SELECT version() AS version FORMAT JSON'))['data'][0]['version']
    if version!='25.3.14.14':raise ValueError('SITE_CLICKHOUSE_VERSION_DRIFT')
    expected_release=read(ROOT/'integrations/smpp-providerops/v1.1/source-lock.json')['clickHouse']
    releases=json.loads(ch('SELECT release_version,migration_range,release_descriptor_hash,schema_contract_hash FROM sdar_meta.v_schema_contract_release_current FORMAT JSON'))['data']
    expected_row={'release_version':expected_release['releaseVersion'],'migration_range':expected_release['migrationRange'],'release_descriptor_hash':expected_release['releaseDescriptorHash'],'schema_contract_hash':expected_release['schemaContractHash']}
    if releases!=[expected_row]:raise ValueError('SITE_RELEASE_METADATA_DRIFT')
    provider_columns=json.loads(ch("SELECT database,table,position,name,type,default_kind,default_expression,compression_codec,is_in_partition_key,is_in_sorting_key,is_in_primary_key,is_in_sampling_key FROM system.columns WHERE database='sdar_core' AND table IN ('external_entity_relation_fact','external_provider_fact') ORDER BY database,table,position FORMAT JSON"))['data']
    descriptor_hash='sha256:'+hashlib.sha256(json.dumps(provider_columns,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    if len(provider_columns)!=expected_release['targetColumnCount'] or descriptor_hash!=expected_release['targetColumnDescriptorHash']:raise ValueError('PROVIDER_INPUT_DESCRIPTOR_DRIFT')
    # Qualify the exact site engine against our unmodified migrations in an isolated server.
    name='sdar-telemetry-schema-check-'+str(os.getpid())
    run(['docker','run','-d','--name',name,'--network','none','--label','io.sdar.temporary=schema-check','clickhouse/clickhouse-server:25.3.14.14'],capture=True)
    try:
        for _ in range(40):
            p=subprocess.run(['docker','exec',name,'clickhouse-client','--query','SELECT 1'],capture_output=True)
            if p.returncode==0:break
            time.sleep(1)
        else:raise ValueError('SCHEMA_CHECK_SERVER_NOT_READY')
        ch('CREATE DATABASE sdar_mart;',name)
        for n in ['014_sdar_evidence_v1_canonical.sql','015_provider_closure_v2.sql','016_provider_closure_task_semantics_v2.sql']:
            ch((ROOT/'migrations/clickhouse'/n).read_text(),name)
        expected=objects(name);actual=objects()
        if actual!=expected:
            save(STATE/'schema-diff.json',{'expected':expected,'actual':actual})
            raise ValueError('EVIDENCE_OR_PROVIDER_SCHEMA_DRIFT')
        save(STATE/'schema-check.json',{'version':version,'status':'PASS','tables':len(actual['tables']),'columns':len(actual['columns']),'metadataSha256':hashlib.sha256(json.dumps(actual,sort_keys=True).encode()).hexdigest()})
    finally:run(['docker','rm','-f','-v',name],capture=True)
def scope():
    obj=read('/mnt/data/smpp-telemetry-state/config/source-mappings.json');found=[]
    def walk(x):
        if isinstance(x,dict):
            if all(k in x for k in ['tenantId','projectId','environment']):found.append({k:x[k] for k in ['tenantId','projectId','environment']})
            for v in x.values():walk(v)
        elif isinstance(x,list):
            for v in x:walk(v)
    walk(obj)
    unique={json.dumps(x,sort_keys=True) for x in found}
    if len(unique)!=1:raise ValueError('SITE_SCOPE_AMBIGUOUS')
    return json.loads(unique.pop())
@contextlib.contextmanager
def account_admin():
    # Ephemeral localhost-only bootstrap identity. SQL accounts persist in the existing data volume.
    password=secrets.token_hex(32)
    digest=hashlib.sha256(password.encode()).hexdigest()
    file='/etc/clickhouse-server/users.d/sdar-site-bootstrap.xml'
    xml=f'<clickhouse><users><sdar_site_bootstrap><password_sha256_hex>{digest}</password_sha256_hex><networks><ip>127.0.0.1</ip><ip>::1</ip></networks><profile>default</profile><quota>default</quota><access_management>1</access_management></sdar_site_bootstrap></users></clickhouse>'
    run(['docker','exec','-i',CH,'sh','-c','umask 077; cat > '+file],xml)
    run(['docker','exec',CH,'chown','clickhouse:clickhouse',file])
    def admin(sql):
        # Pass the password by stdin, never a command argument or error output.
        command='IFS= read -r password; exec clickhouse-client --user sdar_site_bootstrap --password "$password" --multiquery'
        result=subprocess.run(['docker','exec','-i',CH,'sh','-c',command],input=password+'\n'+sql,text=True,capture_output=True)
        if result.returncode:raise ValueError('CLICKHOUSE_ACCOUNT_SETUP_FAILED:'+str(result.returncode))
        return result.stdout
    try:
        for _ in range(30):
            try:admin('SELECT 1');break
            except ValueError:time.sleep(1)
        else:raise ValueError('CLICKHOUSE_BOOTSTRAP_NOT_READY')
        yield admin
    finally:
        run(['docker','exec',CH,'rm','-f',file])

def credentials():
    for name in ['postgres-password','evidence-token','domain-token','query-token','admin-token','warehouse-password','warehouse-query-password']:
        if not (STATE/name).exists():save(STATE/name,secrets.token_hex(24))
    url='postgresql://sdar_telemetry:'+(STATE/'postgres-password').read_text().strip()+'@control-postgres:5432/sdar_telemetry_control'
    save(STATE/'postgres-url',url)
    descriptors=read(ROOT/'integrations/sdar-clickhouse/1.5.1-rc.2/required-object-descriptors.json')['objects']
    readable={x['name'] for x in descriptors}
    readable.update(x['database']+'.'+x['name'] for x in objects()['tables'])
    readable.update(['sdar_meta.v_schema_contract_release_current','sdar_core.external_provider_fact','sdar_core.external_entity_relation_fact','sdar_core.node_capability_version_fact','sdar_core.a2a_exposure_revision_fact','sdar_core.agent_card_revision_fact'])
    with account_admin() as admin:
        for user,file in [('sdar_site_telemetry_writer','warehouse-password'),('sdar_site_telemetry_reader','warehouse-query-password')]:
            password=(STATE/file).read_text().strip()
            if len(password)!=48 or any(c not in '0123456789abcdef' for c in password):raise ValueError('INVALID_SITE_SECRET')
            admin(f"CREATE USER IF NOT EXISTS {user} IDENTIFIED WITH sha256_password BY '{password}';")
            # Independent fixed account names owned by this site, never alter upstream accounts.
            for table in sorted(readable):
                if not __import__('re').fullmatch(r'sdar_[a-z]+\.[a-z0-9_]+',table):raise ValueError('INVALID_GRANT_TARGET')
                admin(f'GRANT SELECT ON {table} TO {user};')
        # Writes are constrained to the currently deployed Evidence and ProviderOps projections.
        tables=['sdar_core.sdar_evidence_v1_record','sdar_core.node_capability_version_fact','sdar_core.a2a_exposure_revision_fact','sdar_core.agent_card_revision_fact']
        tables += ['sdar_mart.'+x['name'] for x in objects()['tables'] if x['database']=='sdar_mart' and x['engine']!='View']
        for table in tables:admin(f'GRANT INSERT ON {table} TO sdar_site_telemetry_writer;')
        admin('GRANT SELECT ON sdar_core.v_smpp_provider_task_timeline TO sdar_site_telemetry_reader;')
        admin('ALTER USER sdar_site_telemetry_reader SETTINGS readonly=2;')
def oneoff(service,script):return dc('run','--rm','--no-deps',service,'node',script,capture=True)
def baseline():
    names=run(['docker','ps','-q'],capture=True).split()
    return {c['Name']:{'id':c['Id'],'startedAt':c['State']['StartedAt']} for c in json.loads(run(['docker','inspect',*names],capture=True)) if c['Config']['Labels'].get('com.docker.compose.project')!=PROJECT}
def api(path='',body=None,etag=None,key=None):
    headers={'Content-Type':'application/json'}
    if etag:headers['If-Match']=etag
    if key:headers['Idempotency-Key']=key
    request=urllib.request.Request('http://127.0.0.1:10091/api/v1/evidence-export'+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
    try:
        with urllib.request.urlopen(request,timeout=40) as r:return r.status,json.load(r),r.headers.get('etag')
    except urllib.error.HTTPError as e:
        if e.code==404:return 404,{},None
        raise ValueError('EVIDENCE_API_HTTP_'+str(e.code)+':'+e.read().decode()[:800]) from None
def runtime_token(enable=True):
    c=read(RUNTIME_COMPOSE);service=c['services']['runtime'];env=service.setdefault('environment',{})
    token=(STATE/'evidence-token').read_text().strip()
    live=json.loads(run(['docker','inspect','sdar-sz-gowm-runtime-1'],capture=True))[0]
    live_env=dict(x.split('=',1) for x in live['Config']['Env'])
    if enable and env.get('SDAR_SITE_EVIDENCE_TOKEN')==token and live_env.get('SDAR_SITE_EVIDENCE_TOKEN')==token:return
    if not enable and 'SDAR_SITE_EVIDENCE_TOKEN' not in env and 'SDAR_SITE_EVIDENCE_TOKEN' not in live_env:return
    # Verify no active tasks before the authorized runtime-only configuration reload.
    with urllib.request.urlopen('http://127.0.0.1:10998/api/v1/tasks',timeout=20) as r:
        tasks=json.load(r)
    rows=tasks if isinstance(tasks,list) else tasks.get('items',tasks.get('tasks',tasks.get('data',[])))
    if not isinstance(rows,list):raise ValueError('TASK_CHECK_RESPONSE_INVALID')
    if any(x.get('status') not in ['completed','failed','canceled','cancelled','rejected'] for x in rows):raise ValueError('ACTIVE_TASKS_BLOCK_RUNTIME_RELOAD')
    if not (STATE/'runtime-compose.before.json').exists():save(STATE/'runtime-compose.before.json',RUNTIME_COMPOSE.read_text())
    if enable:env['SDAR_SITE_EVIDENCE_TOKEN']=token
    else:env.pop('SDAR_SITE_EVIDENCE_TOKEN',None)
    save(RUNTIME_COMPOSE,c)
    run(['docker','compose','--env-file','/dev/null','-p','sdar-sz-gowm','-f',str(RUNTIME_COMPOSE),'up','-d','--no-deps','runtime'])
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://127.0.0.1:10998/api/v1/health',timeout=3) as r:
                if r.status==200:return
        except (OSError,urllib.error.URLError):pass
        time.sleep(1)
    raise ValueError('RUNTIME_RELOAD_NOT_READY')
def evidence():
    desired={'exportId':'sz-gowm-incremental-evidence','deliveryStart':'from_activation','revision':1,'status':'draft','endpointRef':'http://sdar-telemetry-ingestion:8080/v1/evidence/batches','sourceId':'sdar-sz-gowm','nodeId':'sdar-sz-gowm','credentialRef':'env:SDAR_SITE_EVIDENCE_TOKEN','includedFamilies':['runtime','skill','mcp_task','capability','experience','replay','artifact','node_control','evidence'],'batchPolicy':{'maxRecords':100,'maxBytes':262144,'flushIntervalMs':1000},'retryPolicy':{'baseDelayMs':1000,'maxDelayMs':30000},'outboxPolicy':{'maxPendingRecords':100000,'retentionDays':30},'redactionProfile':'strict_internal_v1','artifactMode':'reference','applyMode':'hot_reload'}
    status,current,etag=api()
    if status==404:status,current,etag=api('/revisions',desired,key='sz-gowm-evidence-create-v1')
    for k in ['exportId','deliveryStart','endpointRef','sourceId','nodeId','credentialRef']:
        if current.get(k)!=desired[k]:raise ValueError('EVIDENCE_CONFIGURATION_CONFLICT:'+k)
    if current['status']!='active':
        rev=current['revision'];_,current,etag=api(f'/revisions/{rev}/validate',{'reason':'sz-gowm incremental telemetry'},etag,f'sz-gowm-evidence-validate-{rev}')
        _,operation,_=api(f'/revisions/{rev}/publish',{'reason':'sz-gowm incremental telemetry'},etag,f'sz-gowm-evidence-publish-{rev}')
        if operation.get('status') in ['failed','rejected']:raise ValueError('EVIDENCE_PUBLISH_FAILED')
    for _ in range(60):
        result=api('/status')[1]
        if result.get('activeRevision')==current['revision'] and result.get('status')=='healthy':break
        time.sleep(2)
    else:
        save(STATE/'evidence-status.json',result)
        raise ValueError('EVIDENCE_NOT_HEALTHY_AFTER_RECOVERY_WINDOW')
    save(STATE/'evidence-status.json',result)
    print(json.dumps(result))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['verify','build','up','status','logs','check','rollback']);parser.add_argument('--release',type=pathlib.Path);a=parser.parse_args()
    manifest=verify();image='sdar-telemetry:'+manifest['sourceHash'][:16]
    if a.action=='verify':print('PACKAGE_PASS');return
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700);STATE.chmod(0o700)
    with (STATE/'deploy.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if a.action=='build':
            run(['docker','build','--network','host','--label','org.opencontainers.image.revision='+manifest['revision'],'--label','io.sdar.source-hash='+manifest['sourceHash'],'--build-arg','APP=telemetry-worker','-t',image,'-f',str(ROOT/'deploy/Dockerfile'),str(ROOT)]);return
        if a.action in ['status','logs']:
            dc(*(['ps','--all'] if a.action=='status' else ['logs','--tail','80']));return
        if a.action=='rollback':
            if a.release:
                target=a.release.resolve()
                if target.parent!=ROOT.parent:raise ValueError('ROLLBACK_RELEASE_OUTSIDE_RELEASES')
                run(['python3',str(target/'deploy/sz-gowm/deploy.py'),'verify'])
            runtime_token(False) # No suspend API exists; removing this site's credential fences successful sends.
            dc('stop',*SERVICES)
            if a.release:
                old=read(target/'SITE-MANIFEST.json');c=read(STATE/'compose.json')
                for n in SERVICES:c['services'][n]['image']='sdar-telemetry:'+old['sourceHash'][:16]
                save(STATE/'compose.json',c);dc('up','-d','--wait',*SERVICES)
                CURRENT.unlink(missing_ok=True);CURRENT.symlink_to(target);runtime_token(True)
            print('ROLLBACK_APP_ONLY_DATA_RETAINED');return
        if a.action=='check':
            warehouse_check();print(oneoff('telemetry-worker','dist/scripts/preflight-ugv-debug.js'))
            return
        owner=STATE/'owner.json'
        if owner.exists():
            if read(owner)!={'project':PROJECT,'site':'sz-gowm'}:raise ValueError('STATE_OWNER_MISMATCH')
        elif run(['docker','ps','-aq','--filter','label=com.docker.compose.project='+PROJECT],capture=True).strip():raise ValueError('UNOWNED_PROJECT_EXISTS')
        else:save(owner,{'project':PROJECT,'site':'sz-gowm'})
        before=baseline();save(STATE/'upstream-before.json',before)
        if not (STATE/'compose.json').exists():
            for port in PORTS.values():
                with socket.socket() as s:s.bind(('0.0.0.0',port))
        for network in ['smpp-telemetry_default','sdar-sz-gowm_default']:run(['docker','network','inspect',network],capture=True)
        warehouse_check();credentials();site_scope=scope()
        origin=site_scope|{'originId':'sz-gowm-provider-closure','exportId':'sz-gowm-incremental-evidence','sourceId':'sdar-sz-gowm','nodeId':'sdar-sz-gowm'}
        if (STATE/'provider-closure.json').exists() and read(STATE/'provider-closure.json')!=origin:raise ValueError('PROVIDER_SCOPE_DRIFT')
        save(STATE/'provider-closure.json',origin)
        c=compose(ROOT,STATE,image,site_scope);save(STATE/'compose.json',c)
        dc('config','--quiet');dc('up','-d','--wait','control-postgres')
        print(oneoff('admin-api','dist/scripts/migrate-control.js'))
        print(oneoff('telemetry-worker','dist/scripts/preflight-ugv-debug.js'))
        print(dc('run','--rm','--no-deps','telemetry-worker','node','dist/scripts/provider-closure-debug.js','bootstrap',capture=True))
        dc('up','-d','--wait',*SERVICES)
        runtime_token();evidence()
        after=baseline();changed=[n for n,v in before.items() if n!='/sdar-sz-gowm-runtime-1' and after.get(n)!=v]
        if changed:raise ValueError('UPSTREAM_CHANGED:'+','.join(changed))
        save(STATE/'deployment.json',{'sourceHash':manifest['sourceHash'],'image':image,'scope':site_scope,'upstreamPreserved':len(before)-1,'runtimeChanged':before.get('/sdar-sz-gowm-runtime-1')!=after.get('/sdar-sz-gowm-runtime-1'),'release':str(ROOT)})
        if CURRENT.exists() and CURRENT.resolve()!=ROOT:save(STATE/'previous-release',str(CURRENT.resolve()))
        temp=CURRENT.with_name(CURRENT.name+'.next');temp.unlink(missing_ok=True);temp.symlink_to(ROOT);temp.replace(CURRENT)
        print('SZ_GOWM_DEPLOYMENT_PASS')
if __name__=='__main__':main()
