# Phase 13 — Benchmark Server handoff contracts

## Baseline

- Branch: `feature/domain-projection-worker-v0.1`
- Implementation commit: `c7335bf`
- Consumer baseline: `zhouwen-giser/sdar-benchmark-server@ee7f73735595382072b8205b891af554e8496582`
- ClickHouse lock: `1.5.1-rc.2`, migrations `00..26`, schema hash `sha256:78da6e…d7b8`,
  descriptor hash `sha256:1610cf…b335`

## Changes

- Added the frozen `sdar.telemetry-domain-handoff/v1` directory with an eight-asset byte-hash
  manifest, 10 exact sources, 2 Episode Seals, 10 projections, 6 targets, 4 projection sets and 7
  direct ClickHouse views.
- Frozen five readiness states and reason-code semantics. General profiles proceed without Domain
  input; formal Domain profiles snapshot only on `ready`; `not_ready` is NR and never score zero;
  `blocked_drift` fails closed.
- Added fixed bounded ClickHouse query examples, exact fact-index/lineage fields, Episode Seal
  completion semantics, TypeScript consumer example and five JSON fixtures.
- Added a self-contained verifier wrapper and separate static/live commands. The live mode uses
  `readonly=2`, verifies release/schema/descriptor locks and selects the exact contracted fields
  from all seven allowlisted views.

## Commands actually run

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run check:benchmark-handoff` | PASS — 8 assets, 10 sources, 10 projections, 6 targets, 4 sets, 7 views, 5 fixtures |
| focused handoff consumer/query tests | PASS — 2 contract cases |
| `python3 scripts/static_verify.py` | PASS |
| `git diff --check` | PASS |
| `npm run check:benchmark-handoff:live` in sandbox | FAIL — `CLICKHOUSE_REQUEST_FAILED`, network restricted |
| same live command with requested permission | NOT_RUN — approval rejected at platform usage limit |

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G23 General `not_required` | PENDING | Telemetry fixture passes; actual Benchmark consumer qualification is Phase 16 |
| G24 formal Domain requires `ready` | PENDING | Telemetry fixture passes; actual Benchmark consumer qualification is Phase 16 |
| G25 fact hashes and lineage refs | PASS | frozen view contract and exact bounded query include projection/source/target hashes and lineage `record_id` |
| G32 handoff manifest/checksum/verifier | PARTIAL | static closure passes; required queries against actual rebuilt database were not permitted |

## Evidence and limitations

No Benchmark scoring, weighting, ranking or EvaluationInputSnapshot creation exists in Telemetry.
No near-name source appears in the handoff. The live attempt is not reported as a ClickHouse or
Benchmark pass. Resume G32 by running `npm run check:benchmark-handoff:live` when external execution
permission is available; resume G23/G24 through the actual Benchmark consumer in Phase 16.

## Next phase

Phase 14 wires Compose, secrets, Control PostgreSQL migration and operational probes while retaining
the default `DOMAIN_PROJECTION_MAX_MODE=shadow` safety cap and zero active definitions.
