#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
clickhouse_bin="${CLICKHOUSE_BIN:-clickhouse}"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/sdar-clickhouse-validation.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

"$clickhouse_bin" local \
  --path "$work_dir/data" \
  --multiquery \
  --queries-file "$root_dir/all.sql"

echo "ClickHouse validation passed: $($clickhouse_bin local --version)"
