# Phase 16 — Benchmark consumer-contract qualification

## Baseline and isolation

- Frozen consumer baseline: `zhouwen-giser/sdar-benchmark-server@ee7f73735595382072b8205b891af554e8496582`.
- The adjacent Benchmark working tree is currently on another feature branch and contains user
  changes. This phase did not switch, edit, stage or commit that repository.
- Qualification reads the exact frozen commit with `git cat-file`/`git grep`; current working-tree
  content cannot create a false pass.

## Changes

- Added a repeatable read-only consumer baseline qualifier for all seven direct Domain views, all
  five readiness statuses, General-profile independence and the formal Domain `ready` gate.
- Added adversarial unit coverage showing that missing views, `not_required`, `blocked_drift` or
  either profile rule prevents qualification.

## Commands actually run

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| focused consumer qualifier test | PASS — complete and missing-path cases |
| `python3 scripts/static_verify.py` | PASS |
| `git diff --check` | PASS |
| `npm run check:benchmark-consumer` | EXPECTED BLOCK — `BENCHMARK_DOMAIN_CONSUMER_PATH_MISSING` |

The frozen baseline result is exact: 7 missing Domain view references, 2 missing readiness statuses
(`not_required`, `blocked_drift`), no General-profile independence and no formal-ready gate.

## Gates

| Gate | Result | Reason |
| --- | --- | --- |
| G23 General `not_required` consumer | BLOCKED_EXTERNAL_CONSUMER | baseline does not implement the path |
| G24 formal Domain `ready` gate | BLOCKED_EXTERNAL_CONSUMER | baseline does not implement the path |
| G32 full handoff qualification | BLOCKED | consumer path absent and live ClickHouse query permission unavailable |

## Exact resume action

Implement the frozen handoff in a clean Benchmark Server branch based on or intentionally rebased
from the recorded baseline. The consumer must add the seven exact allowlisted views, preserve its
read-only query boundary, map General to `not_required`, permit formal Domain snapshots only on
`ready`, return NR rather than zero for `not_ready`, and fail closed on `blocked_drift`. Then update
the handoff consumer baseline hash, run `npm run check:benchmark-consumer`, and run
`npm run check:benchmark-handoff:live` against the rebuilt database.

No Benchmark scoring code belongs in Telemetry, and none was added.

## Next phase

Phase 17 executes every locally available regression/documentation/git gate and publishes final
acceptance with all external blockers retained. Completion cannot be declared while any required
gate remains open.
