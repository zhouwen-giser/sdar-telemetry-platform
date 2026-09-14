#!/usr/bin/env python3
"""Offline validator for the telemetry source union and every upstream layer."""
import argparse
import json
from pathlib import Path
from source import digest
import upstream

UPSTREAM_SHA256 = '9f08a3c7aa7244d0e15223cdddc10dfaa8d87913a869403cf9de70dacbc2d34f'


def verify_source(blob, manifest):
    root, files = upstream.rooted(blob)
    expected = manifest['files']
    upstream.require(set(files) == set(expected) | {'SITE-MANIFEST.json'}, 'SOURCE_COVERAGE_MISMATCH')
    for name, checksum in expected.items():
        upstream.require(digest(files[name]) == checksum, 'SOURCE_HASH_MISMATCH')
    calculated = digest(json.dumps(expected, sort_keys=True).encode())
    upstream.require(calculated == manifest['sourceHash'], 'SOURCE_IDENTITY_MISMATCH')
    upstream.require(root == 'sdar-telemetry-' + calculated[:16], 'SOURCE_ROOT_MISMATCH')
    upstream.require(json.loads(files['SITE-MANIFEST.json']) == manifest, 'SOURCE_MANIFEST_MISMATCH')
    return root, files


def validate_upstream(blob):
    upstream.require(digest(blob) == UPSTREAM_SHA256, 'FIXED_UPSTREAM_MISMATCH')
    root, _, manifest = upstream.verify(blob)
    return root, manifest


def verify(blob):
    root, files = upstream.rooted(blob)
    upstream.inventory(files)
    manifest = json.loads(files['UNION.json'])
    upstream.require(manifest['schemaVersion'] == 1 and manifest['format'] == 'sdar-telemetry-source-union', 'UNION_FORMAT_MISMATCH')
    upstream_blob = files['upstream/sdar-united.tar.gz']
    up_root, up_manifest = validate_upstream(upstream_blob)
    upstream.require(manifest['upstream'] == {'root': up_root, 'sha256': digest(upstream_blob), 'manifest': up_manifest}, 'UPSTREAM_MANIFEST_MISMATCH')
    source_blob = files['telemetry/source.tar.gz']
    source_manifest = json.loads(files['telemetry/source.manifest.json'])
    verify_source(source_blob, source_manifest)
    upstream.require(manifest['sdarTelemetry'] == {
        'revision': source_manifest['revision'], 'sourceHash': source_manifest['sourceHash'],
        'archiveSha256': digest(source_blob),
    }, 'TELEMETRY_IDENTITY_MISMATCH')
    return root, files, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    blob = args.archive.read_bytes()
    upstream.checksum_file(args.archive, blob)
    root, _, manifest = verify(blob)
    print(json.dumps({'status': 'PASS', 'root': root, 'sourceHash': manifest['sdarTelemetry']['sourceHash'], 'upstreamSha256': UPSTREAM_SHA256}))


if __name__ == '__main__':
    main()
