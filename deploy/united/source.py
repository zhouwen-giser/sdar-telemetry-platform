"""Shared deterministic source packaging; does not contact any service."""
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def archive(files):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for name, data in sorted(files.items()):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(data))
    return output.getvalue()


def excluded(name):
    p = PurePosixPath(name)
    blocked = {'artifacts', '.git', '.codex', '.agents', 'node_modules', 'dist',
               'vendor', 'secrets', 'credentials', '__pycache__', 'coverage', 'runtime'}
    if blocked.intersection(p.parts) or p.parts[0] == 'reports':
        return True
    base = p.name.lower()
    if base != '.env.example' and (base.startswith('.env') or base.endswith('.env') or '.env.' in base):
        return True
    if p.suffix.lower() in {'.log', '.pem', '.key', '.p12', '.pfx', '.gz', '.zip', '.tar', '.pyc', '.db', '.sqlite', '.dump', '.secret'}:
        return True
    return base in {'compose.json', 'postgres-url', 'postgres-password', 'evidence-token',
                    'domain-token', 'query-token', 'admin-token', 'warehouse-password',
                    'warehouse-query-password', 'provider-closure.json', 'SITE-MANIFEST.json'.lower()}


def collect(repo, output=None):
    repo = Path(repo).resolve()
    output = Path(output).resolve() if output is not None else repo / 'artifacts'
    if output == repo or output in repo.parents:
        raise ValueError('OUTPUT_CONTAINS_SOURCE')
    names = subprocess.check_output(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=repo,
    ).decode().split('\0')
    files = {}
    for name in sorted(set(names) - {''}):
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError('UNSAFE_SOURCE_PATH')
        f = repo / name
        if f == output or output in f.parents or excluded(name):
            continue
        if f.is_symlink():
            raise ValueError('NON_REGULAR_SOURCE:' + name)
        if not f.exists():
            continue
        if not f.is_file():
            raise ValueError('NON_REGULAR_SOURCE:' + name)
        data = f.read_bytes()
        if re.search(rb'^-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----$', data, re.M):
            raise ValueError('PRIVATE_KEY_IN_SOURCE:' + name)
        files[name] = data
    return files


def build_source(repo, output=None):
    files = collect(repo, output)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo).decode().strip()
    manifest = {'schemaVersion': 1, 'revision': revision,
                'files': {name: digest(data) for name, data in files.items()}}
    # Retain the deployed SITE-MANIFEST algorithm for backwards compatibility.
    manifest['sourceHash'] = digest(json.dumps(manifest['files'], sort_keys=True).encode())
    root = 'sdar-telemetry-' + manifest['sourceHash'][:16]
    files['SITE-MANIFEST.json'] = encode(manifest)
    return archive({root + '/' + name: data for name, data in files.items()}), manifest
