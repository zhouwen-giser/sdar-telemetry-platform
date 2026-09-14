#!/usr/bin/env python3
"""Standalone source package; shares collection/format with the united packager."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import os
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'united'))
from source import build_source, digest

ROOT = Path(__file__).resolve().parents[2]


def package(output=None):
    output = Path(output).resolve() if output is not None else ROOT / 'artifacts/sz-gowm'
    blob, manifest = build_source(ROOT, output)
    name = 'sdar-telemetry-' + manifest['sourceHash'][:16] + '.tar.gz'
    files = {name: blob, name + '.sha256': (digest(blob) + '  ' + name + '\n').encode()}
    output.mkdir(parents=True, exist_ok=True)
    for filename, data in files.items():
        target = output / filename
        if target.is_symlink() or (target.exists() and (not target.is_file() or target.read_bytes() != data)):
            raise ValueError('OUTPUT_CONFLICT')
    with tempfile.TemporaryDirectory(prefix='.source-stage-', dir=output) as temp:
        for filename, data in files.items():
            stage = Path(temp) / filename
            stage.write_bytes(data)
            if not (output / filename).exists():
                os.link(stage, output / filename)
    print(json.dumps({'archive': str(output / name), 'sha256': digest(blob), 'sourceHash': manifest['sourceHash'], 'files': len(manifest['files'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    package(parser.parse_args().output)
