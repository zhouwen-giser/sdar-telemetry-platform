#!/usr/bin/env bash
set -euo pipefail
rm -rf dist
npm run typecheck
npm run build
npm run check:sdar-clickhouse-contract
npm run check:domain-source-contracts
node --test dist/tests/unit/*.test.js dist/tests/integration/*.test.js
python3 scripts/static_verify.py
