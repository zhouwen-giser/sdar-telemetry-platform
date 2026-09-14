#!/usr/bin/env python3
"""One-command, offline, atomic publication of a pinned telemetry source union."""
import argparse
import json
import os
from pathlib import Path
import tempfile
from source import archive, build_source, digest, encode
from verify import validate_upstream, verify, verify_source
import upstream

ROOT = Path(__file__).resolve().parents[2]


def publish(output, name, delivery):
    output.mkdir(parents=True, exist_ok=True)
    destination = output / name
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or not destination.is_dir():
            raise ValueError('OUTPUT_CONFLICT')
        entries = list(destination.iterdir())
        if {p.name for p in entries} != set(delivery) or any(
            p.is_symlink() or not p.is_file() or p.read_bytes() != delivery[p.name] for p in entries
        ):
            raise ValueError('OUTPUT_CONFLICT')
        return destination
    with tempfile.TemporaryDirectory(prefix='.telemetry-union-', dir=output) as temp:
        stage = Path(temp) / name
        stage.mkdir()
        for filename, data in delivery.items():
            with (stage / filename).open('xb') as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
        # A nonempty competing delivery cannot be overwritten by this rename.
        stage.rename(destination)
    return destination


def package(upstream_path, output, repo=ROOT):
    upstream_path, output, repo = Path(upstream_path).resolve(), Path(output).resolve(), Path(repo).resolve()
    if output == repo or output in repo.parents:
        raise ValueError('OUTPUT_CONTAINS_SOURCE')
    blob = upstream_path.read_bytes()
    upstream.checksum_file(upstream_path, blob)
    up_root, up_manifest = validate_upstream(blob)
    source, source_manifest = build_source(repo, output)
    verify_source(source, source_manifest)
    manifest = {
        'schemaVersion': 1, 'format': 'sdar-telemetry-source-union',
        'upstream': {'root': up_root, 'sha256': digest(blob), 'manifest': up_manifest},
        'sdarTelemetry': {'revision': source_manifest['revision'], 'sourceHash': source_manifest['sourceHash'], 'archiveSha256': digest(source)},
        'targetPlatform': 'linux/amd64', 'siteClickHouseVersion': '25.3.14.14',
        'deploymentPolicy': 'Source delivery only; no service started or remote host contacted',
        'credentialPolicy': 'Private configuration is provided separately',
    }
    files = {'UNION.json': encode(manifest), 'upstream/sdar-united.tar.gz': blob,
             'telemetry/source.tar.gz': source, 'telemetry/source.manifest.json': encode(source_manifest)}
    for name in ['README.md', 'DEPLOYMENT_HISTORY.md', 'verify.py', 'source.py', 'upstream.py']:
        files[name] = (ROOT / 'deploy/united' / name).read_bytes()
    files['SHA256SUMS'] = ''.join(f'{digest(data)}  {name}\n' for name, data in sorted(files.items())).encode()
    name = 'sdar-telemetry-united-' + digest(files['SHA256SUMS'])[:20]
    union = archive({name + '/' + key: value for key, value in files.items()})
    # Validate all nested bytes before publishing any success-named artifact.
    verify(union)
    delivery = {'archive': name + '.tar.gz', 'sha256': digest(union), 'sourceHash': source_manifest['sourceHash'], 'upstreamSha256': digest(blob)}
    payload = {name + '.tar.gz': union, name + '.tar.gz.sha256': (digest(union) + '  ' + name + '.tar.gz\n').encode(),
               'UNION.json': files['UNION.json'], 'SHA256SUMS': files['SHA256SUMS'], 'delivery.json': encode(delivery)}
    destination = publish(output, name, payload)
    return {'directory': str(destination), **delivery}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/united')
    args = parser.parse_args()
    print(json.dumps(package(args.upstream, args.output)))


if __name__ == '__main__':
    main()
