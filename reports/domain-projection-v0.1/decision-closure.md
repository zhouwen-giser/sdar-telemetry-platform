# Domain Projection v0.1 — Decision closure

Observed at: `2026-08-17T07:28:12.565Z`

## Authority

The 40-file `SDAR_Telemetry_Domain_Projection_Benchmark_Handoff_Codex_Goal_Package_V1.0`
passed its bundled verifier and `SHA256SUMS.txt`. The nested immutable ClickHouse package
`SDAR_ClickHouse_Schema_1.5.1_RC2_Clean_Rebuild.zip` matched the locked SHA-256
`99fd093201cecbd97eec8579d316d3d96b155330feef9a8a8bf57b1d1ac51496`; its internal
checksum set also passed.

Execution-time remote heads matched the task lock:

- Runtime `main`: `2275bc52759914bc80113358a9083e6f00d59e6d`.
- Benchmark Server `feature/v0.1-benchmark-server`:
  `ee7f73735595382072b8205b891af554e8496582`.
- Telemetry branch and remote: `301189599a9cf63ee7b51ee594aa1714441dee9d`.

## D1–D10 closure

All decisions are approved exactly as frozen in the handoff package:

- D1 binds only the ten new `domain_*_source_v1` tables and two Episode Seal tables.
  Near-name legacy tables remain non-authoritative and are never aliases.
- D2 uses ten independent projection identities `application_to_embodied.dp-c01` through
  `application_to_embodied.dp-n05`, each at projection version `1`.
- D3 accepts only an exact live match to ClickHouse `1.5.1-rc.2`, migrations `00..26`,
  schema hash `sha256:78da6e...d7b8`, and descriptor hash `sha256:1610cf...b335`.
- D4 routes `sdar.domain-source/v1` through Gateway and durable WAL; no application writes
  directly to ClickHouse.
- D5 freezes bounded lookback, stable identity/hash deduplication, fail-closed conflicts, and
  checkpoint advancement only after terminal target/lineage or durable DLQ closure.
- D6 freezes the disabled-first lifecycle. Schema acceptance does not activate a projection.
- D7 provides readiness and immutable fact handoff only.
- D8 prohibits Benchmark scoring, M1–M15, F/HG, baseline, comparison, and release evaluation
  logic in this repository.
- D9 preserves the established credential, host allowlist, readonly, timeout, and redaction
  behavior.
- D10 keeps leases, actions, replay and producer registration in Control PostgreSQL; ClickHouse
  governance remains analytical.

## Live D3 result

The live preflight passed. The old `BLOCKED_SCHEMA_COMPATIBILITY` hard stop is therefore
cleared. This permits Phase 1 contract synchronization and later implementation work; it does
not activate any projection or authorize near-name compatibility.

Machine evidence: [decision-closure.json](decision-closure.json) and the
[`domain-projection-rc2-preflight`](../clickhouse/192.168.1.7-schema-snapshot/domain-projection-rc2-preflight/)
snapshot.
