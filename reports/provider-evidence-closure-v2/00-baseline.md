# Provider Evidence Closure v2 — baseline

Observed at `main@ffa94df82e6056b351765478c4b8e6e393073bb9` on 2026-08-21.
The task-package observation SHA and fetched `origin/main` SHA are identical.

## Executed checks

- `npm install`: passed; dependencies were already current.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: 31/34 files passed. The pre-existing
  `domain-source-ingestion`, `ingestion-gateway`, and `query-api` test files
  failed in this restricted environment; no v2 change existed at the time.
- `npm run check:sdar-clickhouse-contract`: passed with 472 objects, 15,949
  columns, and zero table/column drift.
- `npm run check:smpp-benchmark-handoff`: v1 static check passed before the v2
  switch.
- `npm run check:benchmark-consumer`: blocked because `BENCHMARK_CONSUMER_REF`
  (or `--benchmark-ref`) was not supplied.

## Baseline defect

The production consumer queried Episode bindings, then depended on SMPP
relations and loaded entire `smpp_source_id` batches with fixed `LIMIT 1000`.
The reconciliation query first limited tenant/project global rows and only then
filtered `remote_task_id` in TypeScript. That path could mix Episodes, silently
truncate facts, and use non-authoritative relation material as a selection
bridge.

The frozen `remote_task_binding` consumer contract exposes Episode and remote
task identity but not the full Provider Source/Provider/instance binding keys
required by v2. Static v2 logic can be qualified, but a live closure must remain
blocked until those authoritative keys are projected.
