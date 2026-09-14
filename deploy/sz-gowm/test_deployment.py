import importlib.util, json, pathlib, sys, tempfile, unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from config import compose, SERVICES
import deploy

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.scope={'tenantId':'tenant-local','projectId':'smpp-development','environment':'development'}
        self.c=compose('/release','/state','sdar-telemetry:test',self.scope)
    def test_ports_and_networks_are_site_specific(self):
        self.assertEqual(self.c['services']['ingestion-gateway']['ports'],['0.0.0.0:28080:8080'])
        self.assertEqual(self.c['services']['domain-projection-worker']['ports'],['127.0.0.1:28083:8083'])
        self.assertNotIn('ports',self.c['services']['control-postgres'])
        self.assertEqual(self.c['networks']['warehouse']['name'],'smpp-telemetry_default')
        self.assertEqual(self.c['services']['ingestion-gateway']['networks']['runtime']['aliases'],['sdar-telemetry-ingestion'])
    def test_credentials_are_least_privilege_mounts(self):
        gateway=json.dumps(self.c['services']['ingestion-gateway'])
        self.assertNotIn('warehouse-password',gateway);self.assertNotIn('postgres-url',gateway)
        query=json.dumps(self.c['services']['query-api'])
        self.assertNotIn('/run/secrets/warehouse-password',query);self.assertNotIn('postgres-url',query)
        self.assertNotIn('POSTGRES_PASSWORD',self.c['services']['control-postgres']['environment'])
    def test_shadow_and_persistence_survive_regeneration(self):
        self.assertEqual(self.c,compose('/release','/state','sdar-telemetry:test',self.scope))
        domain=self.c['services']['domain-projection-worker']['environment']
        self.assertEqual(domain['DOMAIN_PROJECTION_MAX_MODE'],'shadow')
        self.assertEqual(domain['DOMAIN_PROJECT_ID'],'smpp-development')
        self.assertEqual(set(self.c['volumes']),{'control-data','evidence-wal'})
    def test_conflicting_export_stops_before_publish(self):
        with patch.object(deploy,'api',return_value=(200,{'exportId':'someone-else'},'etag')) as api:
            with self.assertRaisesRegex(ValueError,'EVIDENCE_CONFIGURATION_CONFLICT'):deploy.evidence()
            api.assert_called_once_with()
    def test_manifest_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);(root/'x').write_text('original')
            files={'x':deploy.hashlib.sha256(b'original').hexdigest()}
            (root/'SITE-MANIFEST.json').write_text(json.dumps({'files':files,'sourceHash':deploy.hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()}))
            with patch.object(deploy,'ROOT',root):
                deploy.verify();(root/'x').write_text('modified')
                with self.assertRaisesRegex(ValueError,'PACKAGE_HASH_MISMATCH'):deploy.verify()
    def test_export_honors_site_batch_limit_and_waits_for_recovery(self):
        created=[];states=iter([{'activeRevision':1,'status':'degraded'},{'activeRevision':1,'status':'healthy'}])
        def api(path='',body=None,**kwargs):
            if path=='':return 404,{},None
            if path=='/revisions':
                created.append(body);return 201,body|{'status':'active'},'etag'
            if path=='/status':return 200,next(states),None
            self.fail('unexpected mutation: '+path)
        with patch.object(deploy,'api',side_effect=api),patch.object(deploy,'save'),patch.object(deploy.time,'sleep') as sleep:
            deploy.evidence()
        self.assertEqual(created[0]['batchPolicy']['maxBytes'],262144)
        self.assertEqual(created[0]['deliveryStart'],'from_activation')
        sleep.assert_called_once_with(2)

if __name__=='__main__':unittest.main()
