# SDAR Benchmark Server Domain Projection handoff v1

This directory is the immutable consumer contract for
`sdar.telemetry-domain-handoff/v1`. It is pinned to ClickHouse `1.5.1-rc.2` and exposes facts and
readiness provenance only. Telemetry does not create EvaluationInputSnapshot rows, calculate a
score, choose weights or decide Benchmark outcomes.

`npm run check:benchmark-handoff` verifies local assets and fixtures. That command is static and is
not Benchmark qualification. `npm run check:benchmark-handoff:live` additionally runs the locked
queries against the configured rebuilt ClickHouse database; Phase 16 records that evidence.

Consumer rule:

- General profile: `not_required` proceeds without Domain Projection input.
- Formal Domain profile: only `ready` permits an immutable input snapshot.
- `not_ready` means NR, never score zero.
- `degraded` exposes complete required facts with diagnostic gaps for consumer policy.
- `blocked_drift` fails closed.

All table identifiers in `queries.sql` are fixed allowlisted RC2 views. Query parameters use
ClickHouse named parameter syntax; consumers must not substitute arbitrary identifiers.
