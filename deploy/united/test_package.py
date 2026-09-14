import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import package as pack
import source
import upstream
import verify


def layer(root, files):
    files = dict(files)
    files.pop("SHA256SUMS", None)
    files['SHA256SUMS'] = ''.join(f'{source.digest(b)}  {n}\n' for n, b in sorted(files.items())).encode()
    return source.archive({root + '/' + n: b for n, b in files.items()})


def fixture():
    tiny = source.archive({'source.txt': b'fixture'})
    nested_manifest = {'smpp': {'revision': 'smpp-test', 'sha256': source.digest(tiny)},
                       'base': {'sha256': source.digest(tiny)}, 'gowm': {'sha256': source.digest(tiny)}, 'baseSourceSha256': 'base-test'}
    nested = layer('smpp', {'UNION.json': source.encode(nested_manifest), **{'upstream/' + n + '.tar.gz': tiny for n in ['analysis', 'gowm', 'smpp']}})
    schema = source.encode({'version': 1, 'objects': [{'name': name, 'kind': 'TABLE'} for name in ['sdar_core.external_provider_fact', 'sdar_core.external_entity_relation_fact']]})
    release = b'{"release_version":"fixture"}\n'
    telemetry_manifest = {'schemaVersion': 1, 'executionMode': 'live',
                          'upstream': {'root': 'smpp', 'sha256': source.digest(nested), 'smppRevision': 'smpp-test', 'baseSourceSha256': 'base-test'},
                          'telemetry': {'sha256': source.digest(tiny)},
                          'sdarSchema': {'sha256': source.digest(schema), 'objects': 2, 'releaseSeed': {'sha256': source.digest(release)}}}
    telemetry = layer('telemetry', {'UNION.json': source.encode(telemetry_manifest), 'upstream/smpp-united.tar.gz': nested,
                                   'upstream/telemetry.tar.gz': tiny, 'sdar/schema.json': schema, 'sdar/schema-contract-release.jsonl': release})
    entries = [{'path': 'source.txt', 'sha256': source.digest(b'fixture')}]
    sh = source.digest(json.dumps(entries, separators=(',', ':')).encode())
    sdar = source.archive({'source.txt': b'fixture', 'sdar-deployment-source.json': source.encode({'sourceRevision': 'test', 'sourceHash': sh})})
    sm = {'sourceRevision': 'test', 'sourceHash': sh, 'files': entries, 'archiveSha256': source.digest(sdar)}
    union = {'schemaVersion': 1, 'format': 'sdar-source-union', 'upstream': {'sha256': source.digest(telemetry), 'root': 'telemetry', 'manifest': telemetry_manifest},
             'sdar': {k: sm[k] for k in ['sourceRevision', 'sourceHash', 'archiveSha256']}}
    return layer('sdar', {'UNION.json': source.encode(union), 'upstream/telemetry-united.tar.gz': telemetry,
                          'sdar/source.tar.gz': sdar, 'sdar/source.manifest.json': source.encode(sm)})


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        subprocess.run(['git', '-C', str(self.repo), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture'], check=True)
        (self.repo / 'code.ts').write_text('export const value = 1;\n')

    def test_filters_private_files_but_preserves_contract_fixtures(self):
        paths = ['.env', 'business-connections.env', '.env.local', 'settings.env.production', 'secrets/token',
                 'credentials/value', 'reports/raw.json', 'deploy/compose.json', 'db.dump', 'account.secret',
                 'integrations/evidence/reports/fixture.json', '.env.example']
        for name in paths:
            p = self.repo / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('fixture')
        self.assertEqual(set(source.collect(self.repo)), {'code.ts', '.env.example', 'integrations/evidence/reports/fixture.json'})

    def test_output_and_deleted_source_are_excluded(self):
        output = self.repo / 'custom-delivery'
        output.mkdir(); (output / 'delivery.json').write_text('old')
        gone = self.repo / 'gone.txt'; gone.write_text('deleted')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'gone.txt'], check=True); gone.unlink()
        self.assertEqual(set(source.collect(self.repo, output)), {'code.ts'})
        with self.assertRaisesRegex(ValueError, 'OUTPUT_CONTAINS_SOURCE'): source.collect(self.repo, self.repo)

    def test_source_is_repeatable_and_tampering_or_omission_fails(self):
        blob, manifest = source.build_source(self.repo)
        self.assertEqual((blob, manifest), source.build_source(self.repo))
        root, files = verify.verify_source(blob, manifest)
        for operation in ['modify', 'omit', 'extra']:
            changed = dict(files)
            if operation == 'modify': changed['code.ts'] = b'changed'
            elif operation == 'omit': del changed['code.ts']
            else: changed['unlisted'] = b'extra'
            with self.assertRaises(ValueError): verify.verify_source(source.archive({root + '/' + n: b for n, b in changed.items()}), manifest)

    def test_source_rejects_links_and_private_keys(self):
        (self.repo / 'link').symlink_to('/etc/hosts')
        with self.assertRaisesRegex(ValueError, 'NON_REGULAR_SOURCE'): source.collect(self.repo)
        (self.repo / 'link').unlink()
        (self.repo / 'accidental.txt').write_text('-----BEGIN ' + 'PRIVATE KEY-----\nsecret\n')
        with self.assertRaisesRegex(ValueError, 'PRIVATE_KEY_IN_SOURCE'): source.collect(self.repo)

    def test_archive_rejects_traversal_links_and_duplicate_members(self):
        for mode in ['absolute', 'parent', 'symlink', 'hardlink', 'duplicate']:
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w:gz') as tar:
                info = tarfile.TarInfo('/unsafe' if mode == 'absolute' else 'root/../unsafe' if mode == 'parent' else 'root/file')
                if mode in ['symlink', 'hardlink']:
                    info.type = tarfile.SYMTYPE if mode == 'symlink' else tarfile.LNKTYPE
                    info.linkname = '/etc/hosts'
                tar.addfile(info)
                if mode == 'duplicate': tar.addfile(info)
            with self.assertRaises(ValueError): upstream.members(stream.getvalue())

    def test_nested_inventory_and_authority_are_required(self):
        blob = fixture(); upstream.verify(blob)
        root, files = upstream.rooted(blob)
        broken = dict(files); del broken['sdar/source.tar.gz']
        with self.assertRaises((ValueError, KeyError)): upstream.verify(layer(root, broken))
        troot, tfiles = upstream.rooted(files['upstream/telemetry-united.tar.gz'])
        del tfiles['sdar/schema-contract-release.jsonl']
        with self.assertRaises((ValueError, KeyError)): upstream.validate_upstream(layer(troot, tfiles))
        tfiles['unexpected'] = b'unlisted'
        with self.assertRaises(ValueError): upstream.inventory(tfiles)

    def test_fixed_upstream_and_external_checksum_are_enforced(self):
        blob = fixture()
        with self.assertRaisesRegex(ValueError, 'FIXED_UPSTREAM_MISMATCH'): verify.validate_upstream(blob)
        p = Path(self.temp.name) / 'upstream.tar.gz'; p.write_bytes(blob)
        Path(str(p) + '.sha256').write_text('0' * 64 + '  ' + p.name + '\n')
        with self.assertRaisesRegex(ValueError, 'UPSTREAM_HASH_MISMATCH'): pack.package(p, self.repo / 'out', self.repo)

    def test_atomic_publication_reuse_conflict_and_self_contained_validator(self):
        blob = fixture(); p = Path(self.temp.name) / 'upstream.tar.gz'; p.write_bytes(blob)
        Path(str(p) + '.sha256').write_text(source.digest(blob) + '  ' + p.name + '\n')
        output = self.repo / 'delivery'
        with patch.object(verify, 'UPSTREAM_SHA256', source.digest(blob)):
            first = pack.package(p, output, self.repo)
            self.assertEqual(first, pack.package(p, output, self.repo))
            directory = Path(first['directory'])
            root, files, manifest = verify.verify((directory / first['archive']).read_bytes())
            self.assertEqual(files['upstream/sdar-united.tar.gz'], blob)
            self.assertTrue({'verify.py', 'source.py', 'upstream.py'} <= set(files))
            (directory / 'delivery.json').write_text('conflict')
            with self.assertRaisesRegex(ValueError, 'OUTPUT_CONFLICT'): pack.package(p, output, self.repo)
            self.assertFalse(any(p.name.startswith('.telemetry-union-') for p in output.iterdir()))


if __name__ == '__main__':
    unittest.main()
