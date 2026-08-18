# Phase 11 — Projection sets and lifecycle readiness

## Changes

- Added the exact seven-state lifecycle with revision compare-and-set and request-hash idempotency.
  Transitions cannot skip approval/shadow/dry-run, drift blocks operational states, and recovery
  returns through disabled or shadow rather than directly active.
- Added `DOMAIN_PROJECTION_MAX_MODE` parsing with the required default safety cap `shadow`.
- Activation guards require exact release/schema/definition/mapping hashes, approved source,
  payload and target contracts, an active producer or explicit fixture qualification, and no drift.
- Frozen four RC2 sets with member counts 5/5/10/4 and their locked content hashes.
- Added readiness semantics `not_required`, `not_ready`, `degraded`, `ready`, `blocked_drift`.
  Empty, missing and disabled required members can never report ready.

## Verification

- Lifecycle/readiness suite: 6/6 PASS.
- Domain core regression: 6/6 PASS.
- Typecheck, build, static verification and `git diff --check` passed.
- No projection was activated; live RC2 remains at zero active projections from the Phase 0 lock.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G21 lifecycle transitions | PASS | graph, revision, action-id, cap, hash and drift tests |
| G22 set/episode readiness avoids false healthy | PASS | empty/disabled/missing/diagnostic/drift tests |
| G23 General profile not-required consumer behavior | PENDING | Phase 16 Benchmark consumer qualification |

## Truthful scope

These are pure lifecycle/readiness tests, not live activation or ClickHouse E2E. The implementation
does not write evaluation snapshots or scores. All ten definitions remain disabled.

## Next phase

Phase 12 exposes bounded typed Query/Admin contracts plus authenticated actions, health and metrics.
