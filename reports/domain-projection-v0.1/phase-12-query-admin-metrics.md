# Phase 12 — Query API, Admin API, metrics and health

## Changes

- Added the ten fixed Domain Projection Query API routes from the endpoint matrix. Every route
  selects a fixed ClickHouse table or view, accepts only typed path/query fields, hex-encodes caller
  values, and inherits the existing Bearer, `readonly=2` and result-row bounds.
- Replaced the legacy in-memory Admin entry point with an independently authenticated server backed
  by Control PostgreSQL. Producer registration/heartbeat, lifecycle, reconciliation, bounded replay
  and DLQ actions are parsed into typed commands; projection actions require the expected revision,
  definition hash, mapping hash and request hash.
- Added the D10-compliant reconciliation-request migration and idempotent Control PostgreSQL
  repository operation. No second checkpoint, lineage, DLQ or run authority was created in
  PostgreSQL.
- Added Domain Projection worker `/health`, `/ready` and `/metrics` rendering. Metrics expose input,
  produced, skipped, failed and duplicate counts, checkpoint watermark/lag, blocking DLQ, drift,
  last success, lease owner/expiry and Episode Seal counts.

## Verification

- Domain Admin/worker contract suite: 3/3 tests PASS.
- Domain Query fixed-SQL contract: 1/1 test PASS.
- Typecheck and static verification PASS; `git diff --check` PASS.
- The Control PostgreSQL integration command exited successfully but explicitly skipped because
  `SDAR_TEST_CONTROL_POSTGRES_URL` was not configured. It is **not** counted as real PostgreSQL
  evidence.
- The complete Query API HTTP listener suite was not executable in the restricted sandbox because
  loopback listen returned `EPERM`. The pure route contract passed; the listener run remains open.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G19 DLQ controls | PARTIAL | typed authenticated route and scope-pinned service are present; real HTTP/Control PG integration remains open |
| G26 bounded typed Query API | PASS | ten fixed routes plus adversarial no-caller-SQL contract test |
| G27 revision/hash/idempotent Admin | PARTIAL | parser, auth boundary and idempotent repository implemented; real HTTP/Control PG integration remains open |
| G28 runtime health/readiness/metrics | PARTIAL | complete renderer/readiness contract test; live worker runtime probe remains open |

## Truthful scope

This phase did not start the Domain Projection worker, connect to Control PostgreSQL, write to
ClickHouse, activate a projection or run a real projection E2E. Mocked ports and pure render tests
are reported only as contract evidence. G19/G27/G28 remain blocking gates until their required live
integration or runtime probes run in Phase 14/17.

## Next phase

Phase 13 freezes the Benchmark Server handoff contract and verifier without adding any Benchmark
scoring logic to Telemetry.
