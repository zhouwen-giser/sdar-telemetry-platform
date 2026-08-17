# Phase 15 — Controlled real ClickHouse E2E and recovery

## Implementation

- Added a production ClickHouse checkpoint committer with stable identity/token, terminal-only
  advancement, sparse monotonic sequence handling, same-hash replay and content-conflict rejection.
- Added `test:domain-projection-e2e`. The harness first runs the existing real
  Gateway → durable WAL → Domain Source landing path, then executes all ten exact mappers against
  ClickHouse target, lineage and checkpoint objects.
- The tenth mapping runs in a separate process. After the target insert returns and before lineage
  begins, the parent sends real `SIGKILL`; it verifies target=1, lineage=0, checkpoint=0, restarts,
  closes lineage/checkpoint, then replays all ten inputs and requires exactly one logical row at each
  boundary.
- The harness validates ClickHouse `24.10.2.1`, release `1.5.1-rc.2` and the exact schema/descriptor
  hashes before any test write. It uses a unique run scope and never activates projection metadata.

## Commands actually run

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| target/checkpoint focused suite | PASS — 9 source-level cases |
| `python3 scripts/static_verify.py` | PASS |
| `git diff --check` | PASS |
| `SDAR_DOMAIN_PHASE15_RUN_ID=<unique> npm run test:domain-projection-e2e` | NOT_RUN — live external execution permission unavailable |

## Gate status

| Gate | Result | Reason |
| --- | --- | --- |
| G14 real same-hash target replay | PENDING | harness ready; no real run result |
| G30 controlled real 10/10 mapping E2E | PENDING | harness ready; no real run result |
| G31 real worker crash/restart/replay | PENDING | real SIGKILL child is implemented; it was not executed against ClickHouse |

## Truthful boundary

No Phase 15 ClickHouse row was written in this phase. The focused in-memory tests validate code but
are not E2E evidence. The earlier sandbox live request failed at the network boundary and external
execution permission was rejected at the platform usage limit; this phase does not retry or route
around that decision.

## Exact resume command

From the repository root with the existing untracked writer credential and external execution
permission:

```bash
SDAR_DOMAIN_PHASE15_RUN_ID=codex_dp15_<new-unique-id> npm run test:domain-projection-e2e
```

Accept only a generated `reports/domain-projection-v0.1/evidence/*-phase-15-domain-projection-e2e.json`
whose status is `passed`, ten mapping rows are present, every check is true and recovery signal is
`SIGKILL`.

## Next phase

Phase 16 prepares and runs the actual Benchmark consumer qualification where access permits; it
must not treat Telemetry fixtures or the blocked Phase 15 run as consumer evidence.
