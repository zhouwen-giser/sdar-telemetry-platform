# SDAR Benchmark Server MCP Provider telemetry handoff v1

This immutable, read-only handoff is `sdar.telemetry-smpp-providerops-handoff/v1`. It is pinned to
SMPP ProviderOps `1.1.0`, Source Mapping v4, the companion projection commit in
`handoff-manifest.json`, and ClickHouse `1.5.1-rc.2`.

The handoff exposes typed Provider facts, N:N relations, reconciliation, readiness and provenance.
Telemetry does not calculate Benchmark scores, choose weights, assign Fatal/Hard Gate outcomes, or
create Benchmark-owned input snapshots.

Provider `completed`, resource health, or projection success never proves SDAR Goal completion or
physical/business success. Missing required Provider telemetry is a readiness outcome, not an
automatic zero score.

`npm run check:smpp-benchmark-handoff` validates the immutable local asset closure and fixtures.
It is static and is not real E2E. `npm run check:smpp-benchmark-handoff:live` additionally checks the
locked release and compiles the read contracts on the configured ClickHouse server with
`readonly=2`; it still does not replace the S8 OTLP-to-consumer E2E.

All SQL identifiers are fixed. Values use ClickHouse named parameters; callers must never supply
database, table or View identifiers.
