# Phase 10 — Reconciliation, replay and schema-drift fail-closed

## Changes

- Added Domain reconciliation that detects source without terminal decision, target without lineage,
  produced lineage without target, target hash mismatch, checkpoint ahead of closure, unresolved
  blocking DLQ, schema-definition drift and duplicate target identity. Empty input is `empty`, never
  falsely `healthy`.
- Added per-projection schema preflight over the exact source, target, checkpoint, lineage and DLQ
  descriptors. It uses `readonly=2`, pins the frozen mapping document hash and fails before work on
  any mapping, table or column drift.
- Added bounded replay pinned to projection definition, mapping hash, tenant/project, optional
  episode, cursor range and a maximum of 1,000 records. Out-of-scope rows fail closed and a blocking
  terminal result stops the replay.
- Added DLQ retry/resolve/ignore service semantics with expected projection/version/mapping/status,
  idempotent management-action identity, and resolution only after a terminal non-blocking retry.

## Verification

- Focused reconciliation/replay/drift/DLQ suite: 7/7 PASS.
- Phase 9 target closure regression: 8/8 PASS.
- Exact descriptor pass and mutated-column failure are both covered; mapping hash drift fails before
  a ClickHouse query.
- Typecheck, build, static verification, `git diff --check` and the 472-object / 15,949-column RC2
  contract lock passed.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G19 DLQ retry/resolve/replay controls | PARTIAL | service semantics pass; authenticated Admin integration is Phase 12 |
| G20 schema/mapping drift fails closed | PASS | exact descriptor/mapping pin plus adversarial drift tests |

## Truthful scope

This phase performed no ClickHouse DML and does not claim real E2E. Schema tests use the immutable
RC2 descriptor assets through a deterministic query port. All projections remain disabled; no
near-name source and no Benchmark evaluation logic were introduced.

## Next phase

Phase 11 implements projection-set and lifecycle state machines for disabled, shadow, dry-run,
active, suspended and blocked operation, including empty/disabled readiness semantics.
