#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
npm run typecheck
npm run build
node --test dist/tests/unit/*.test.js dist/tests/integration/*.test.js
python3 scripts/static_verify.py
