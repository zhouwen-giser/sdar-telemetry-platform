"""Site composition. Pure generation; credentials never enter the Compose document."""
from pathlib import Path

PROJECT = 'sdar-telemetry'
PORTS = {'ingestion-gateway':28080,'query-api':28081,'admin-api':28082,'domain-projection-worker':28083}
SERVICES = ['ingestion-gateway','telemetry-worker','query-api','admin-api','domain-projection-worker']

def compose(root, state, image, scope, postgres='postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'):
    state = str(Path(state).resolve())
    secret = lambda name: {'type':'bind','source':state+'/'+name,'target':'/run/secrets/'+name,'read_only':True}
    warehouse = {'CLICKHOUSE_URL':'http://sdar-clickhouse:8123','CLICKHOUSE_USER':'sdar_site_telemetry_writer','CLICKHOUSE_PASSWORD_FILE':'/run/secrets/warehouse-password','CLICKHOUSE_SECURE':'false','CLICKHOUSE_EXPECTED_HOST':'sdar-clickhouse'}
    control = {'CONTROL_POSTGRES_URL_FILE':'/run/secrets/postgres-url'}
    services = {}
    for name in SERVICES:
        services[name] = {'image':image,'restart':'unless-stopped','command':['node','dist/apps/'+name+'/src/main.js'],'environment':{},'volumes':[],'networks':{'default':{}},'labels':{'io.sdar.site':'sz-gowm'}}
    for name in ['telemetry-worker','domain-projection-worker']:
        services[name]['environment'].update(warehouse | control)
        services[name]['volumes'] += [secret('warehouse-password'),secret('postgres-url')]
        services[name]['networks']['warehouse'] = {}
    gateway = services['ingestion-gateway']
    gateway['environment'].update({'WAL_DIR':'/var/lib/sdar-telemetry/wal','GATEWAY_PORT':'8080','GATEWAY_BIND_HOST':'0.0.0.0','EVIDENCE_INGEST_BEARER_TOKEN_FILE':'/run/secrets/evidence-token','DOMAIN_SOURCE_INGEST_BEARER_TOKEN_FILE':'/run/secrets/domain-token'})
    gateway['volumes'] += [secret('evidence-token'),secret('domain-token'),'evidence-wal:/var/lib/sdar-telemetry/wal']
    gateway['networks']['runtime'] = {'aliases':['sdar-telemetry-ingestion']}
    worker = services['telemetry-worker']
    worker['environment'].update({'WAL_DIR':'/var/lib/sdar-telemetry/wal','PROVIDER_CLOSURE_CONFIG_FILE':'/run/config/provider-closure.json'})
    worker['volumes'] += ['evidence-wal:/var/lib/sdar-telemetry/wal',{'type':'bind','source':state+'/provider-closure.json','target':'/run/config/provider-closure.json','read_only':True}]
    query = services['query-api']
    query['environment'].update({'QUERY_PORT':'8081','QUERY_BIND_HOST':'0.0.0.0','TELEMETRY_TRUSTED_DEVELOPMENT':'true','QUERY_API_BEARER_TOKEN_FILE':'/run/secrets/query-token','CLICKHOUSE_QUERY_URL':'http://sdar-clickhouse:8123','CLICKHOUSE_QUERY_USER':'sdar_site_telemetry_reader','CLICKHOUSE_QUERY_PASSWORD_FILE':'/run/secrets/warehouse-query-password','CLICKHOUSE_QUERY_SECURE':'false','CLICKHOUSE_QUERY_EXPECTED_HOST':'sdar-clickhouse','SMPP_TELEMETRY_QUERY_URL':'http://smpp-telemetry-query-api-1:8088'})
    query['volumes'] += [secret('query-token'),secret('warehouse-query-password')]
    query['networks']['warehouse'] = {}
    admin = services['admin-api']
    admin['environment'].update(control | {'ADMIN_PORT':'8082','ADMIN_BIND_HOST':'0.0.0.0','ADMIN_API_BEARER_TOKEN_FILE':'/run/secrets/admin-token','TELEMETRY_TRUSTED_DEVELOPMENT':'true'})
    admin['volumes'] += [secret('postgres-url'),secret('admin-token')]
    domain = services['domain-projection-worker']
    domain['environment'].update({'DOMAIN_PROJECTION_ENABLED':'true','DOMAIN_PROJECTION_MAX_MODE':'shadow','DOMAIN_PROJECTION_BIND_HOST':'0.0.0.0','DOMAIN_PROJECTION_HEALTH_PORT':'8083','DOMAIN_PROJECTION_WORKER_ID':'sz-gowm-domain-worker','DOMAIN_TENANT_ID':scope['tenantId'],'DOMAIN_PROJECT_ID':scope['projectId']})
    for name, port in PORTS.items():
        internal = port - 20000
        services[name]['ports'] = [f"{'127.0.0.1' if name=='domain-projection-worker' else '0.0.0.0'}:{port}:{internal}"]
        services[name]['healthcheck'] = {'test':['CMD','node','-e',f"fetch('http://127.0.0.1:{internal}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],'interval':'5s','timeout':'5s','retries':24}
    services['control-postgres'] = {'image':postgres,'restart':'unless-stopped','environment':{'POSTGRES_USER':'sdar_telemetry','POSTGRES_DB':'sdar_telemetry_control','POSTGRES_PASSWORD_FILE':'/run/secrets/postgres-password'},'volumes':[secret('postgres-password'),'control-data:/var/lib/postgresql/data'],'healthcheck':{'test':['CMD','pg_isready','-U','sdar_telemetry','-d','sdar_telemetry_control'],'interval':'3s','timeout':'3s','retries':40},'networks':{'default':{}}}
    return {'name':PROJECT,'services':services,'volumes':{'control-data':{},'evidence-wal':{}},'networks':{'default':{},'warehouse':{'external':True,'name':'smpp-telemetry_default'},'runtime':{'external':True,'name':'sdar-sz-gowm_default'}}}
