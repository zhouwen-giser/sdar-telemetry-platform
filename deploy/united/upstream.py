# Trusted validator adapted from skill-driven-agent-runtime/deploy/united/bundle.py.
# Source SHA256: b040b5d9d89f7e925bb02a71602ff86f612d1a81a28fd08d1e533d64e1695d80
# Copied from the local reviewed source, never loaded from an input archive.
#!/usr/bin/env python3
"""Deterministic source union; validation never starts a service."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile


def require(ok, code):
    if not ok:
        raise ValueError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def members(data):
    result = {}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            name = member.name
            p = PurePosixPath(name)
            require(not p.is_absolute() and '..' not in p.parts and '\\' not in name
                    and str(p) == name and name not in seen, 'UNSAFE_ARCHIVE_PATH')
            require(member.isfile() or member.isdir(), 'UNSAFE_ARCHIVE_TYPE')
            seen.add(name)
            if member.isfile():
                result[name] = archive.extractfile(member).read()
    require(bool(result), 'EMPTY_ARCHIVE')
    return result


def archive(files):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, filename='', mode='wb', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.USTAR_FORMAT) as tar:
            for name, data in sorted(files.items()):
                item = tarfile.TarInfo(name)
                item.size = len(data)
                item.mode = 0o644
                tar.addfile(item, io.BytesIO(data))
    return output.getvalue()


def rooted(data):
    files = members(data)
    roots = {name.split('/')[0] for name in files}
    require(len(roots) == 1 and all('/' in name for name in files), 'INVALID_ARCHIVE_ROOT')
    root = roots.pop()
    return root, {name[len(root)+1:]: value for name, value in files.items()}


def inventory(files):
    require('SHA256SUMS' in files, 'MISSING_INVENTORY')
    recorded = {}
    for line in files['SHA256SUMS'].decode().splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        require(match is not None, 'INVALID_INVENTORY')
        h, name = match.groups()
        require(name not in recorded and name in files and digest(files[name]) == h,
                'INVENTORY_MISMATCH')
        recorded[name] = h
    require(set(recorded) == set(files) - {'SHA256SUMS'}, 'INVENTORY_COVERAGE_MISMATCH')


def checksum_file(path, data):
    parts = Path(str(path)+'.sha256').read_text().split()
    require(parts == [digest(data), path.name], 'UPSTREAM_HASH_MISMATCH')


def validate_upstream(data):
    root, files = rooted(data)
    inventory(files)
    manifest = json.loads(files['UNION.json'])
    require(manifest['schemaVersion'] == 1 and manifest['executionMode'] == 'live', 'UPSTREAM_MODE_MISMATCH')
    for name, descriptor in [('upstream/smpp-united.tar.gz', manifest['upstream']),
                             ('upstream/telemetry.tar.gz', manifest['telemetry']),
                             ('sdar/schema.json', manifest['sdarSchema']),
                             ('sdar/schema-contract-release.jsonl', manifest['sdarSchema']['releaseSeed'])]:
        require(digest(files[name]) == descriptor['sha256'], 'UPSTREAM_IDENTITY_MISMATCH')
    schema = json.loads(files['sdar/schema.json'])
    require(schema['version'] == 1 and len(schema['objects']) == manifest['sdarSchema']['objects'], 'AUTHORITY_SCHEMA_MISMATCH')
    require({'sdar_core.external_provider_fact', 'sdar_core.external_entity_relation_fact'} <= {o['name'] for o in schema['objects'] if o['kind'] == 'TABLE'}, 'AUTHORITY_TABLES_MISSING')
    rows = [json.loads(line) for line in files['sdar/schema-contract-release.jsonl'].splitlines() if line.strip()]
    require(bool(rows) and all(isinstance(row, dict) and row.get('release_version') for row in rows), 'EMPTY_AUTHORITY_RELEASE')
    nested_root, nested = rooted(files['upstream/smpp-united.tar.gz'])
    inventory(nested)
    smpp = json.loads(nested['UNION.json'])
    require(nested_root == manifest['upstream']['root'] and smpp['smpp']['revision'] == manifest['upstream']['smppRevision']
            and smpp['baseSourceSha256'] == manifest['upstream']['baseSourceSha256'], 'NESTED_IDENTITY_MISMATCH')
    for name, descriptor in [('analysis', 'base'), ('gowm', 'gowm'), ('smpp', 'smpp')]:
        blob = nested['upstream/'+name+'.tar.gz']
        require(digest(blob) == smpp[descriptor]['sha256'], 'NESTED_HASH_MISMATCH')
        members(blob)
    members(files['upstream/telemetry.tar.gz'])
    return root, manifest


def validate_source(blob, manifest):
    files = members(blob)
    expected = manifest['files']
    require(len({entry['path'] for entry in expected}) == len(expected), 'DUPLICATE_SOURCE')
    require(set(files) == {entry['path'] for entry in expected} | {'sdar-deployment-source.json'}, 'SOURCE_COVERAGE_MISMATCH')
    for entry in expected:
        require(digest(files[entry['path']]) == entry['sha256'], 'SOURCE_HASH_MISMATCH')
    calculated = digest(json.dumps(expected, separators=(',', ':'), ensure_ascii=False).encode())
    require(calculated == manifest['sourceHash'] and digest(blob) == manifest['archiveSha256'], 'SOURCE_IDENTITY_MISMATCH')
    require(json.loads(files['sdar-deployment-source.json']) == {
        'sourceRevision': manifest['sourceRevision'], 'sourceHash': calculated}, 'SOURCE_METADATA_MISMATCH')
    return files


def verify(data):
    root, files = rooted(data)
    inventory(files)
    manifest = json.loads(files['UNION.json'])
    require(manifest['schemaVersion'] == 1 and manifest['format'] == 'sdar-source-union', 'UNION_FORMAT_MISMATCH')
    require(digest(files['upstream/telemetry-united.tar.gz']) == manifest['upstream']['sha256'], 'UNION_UPSTREAM_MISMATCH')
    upstream_root, upstream = validate_upstream(files['upstream/telemetry-united.tar.gz'])
    require(upstream_root == manifest['upstream']['root'] and upstream == manifest['upstream']['manifest'], 'UNION_UPSTREAM_IDENTITY_MISMATCH')
    source = json.loads(files['sdar/source.manifest.json'])
    require(manifest['sdar'] == {key: source[key] for key in ['sourceRevision', 'sourceHash', 'archiveSha256']}, 'UNION_SOURCE_MISMATCH')
    validate_source(files['sdar/source.tar.gz'], source)
    return root, files, manifest

