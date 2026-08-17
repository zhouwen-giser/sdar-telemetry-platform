# Phase 2 — Domain Source v1 contracts and Golden fixtures

## Baseline

- Phase 1 publication HEAD: `f7d4778`.
- Live ClickHouse `24.10.2.1` is an exact zero-diff match for `1.5.1-rc.2` migrations `00..26`.
- The ten RC2 Domain Source contracts and two Episode Seal tables are the only accepted source
  authority; all projections remain disabled.

## Changes

- Added the producer-facing `sdar.domain-source/v1` contract to the existing
  `telemetry-contracts` package.
- Frozen the header `x-sdar-domain-source-contract`, batch and Episode Seal request schemas, and
  strict one-field/two-field acknowledgement schemas.
- Frozen ten exact per-source payload variants: five commander and five NPC. No physical table,
  database or arbitrary SQL identifier is accepted on the wire.
- Frozen canonical JSON, SHA-256 payload and batch hashing, canonical UInt64 decimal strings,
  record identity `(tenant, project, source contract, record, revision)`, and application-homogeneous
  batches.
- Added two five-record Golden batches covering 10/10 source types, two valid seals, two valid ACKs
  and ten adversarial fixtures.
- Added a deterministic no-write drift check and six unit-test groups.

## Commands actually run

- `npm run check:domain-source-contracts`
- `npm run build`
- focused `domain-source-contracts.test.ts`
- `npm run verify` in the default sandbox — expected local-listener false failures only
- `npm run verify` with loopback permission — PASS: 93/93, typecheck, build, RC2 lock, Domain
  Source lock and static verification

## Acceptance

| Gate | Result | Evidence |
| --- | --- | --- |
| G05 schemas and valid/invalid fixtures | PASS | 4 schemas, 10 source types, 16/16 fixture outcomes |
| exact sources only | PASS | near-name source and arbitrary table fixtures rejected |
| identity/revision/hash semantics | PASS | canonical/hash/UInt64/identity unit tests |
| existing Evidence v1 regression | PASS | full verify 93/93; imported 100/95/5 contract unchanged |

## Limitations

This phase contains contract and fixture evidence only. It did not start the Gateway, append a
Domain Source WAL frame, write ClickHouse, run a mapper, or activate a projection. G06–G08 and all
real Domain Source/Projection E2E gates remain pending. Fixtures and static tests are not reported
as real ClickHouse evidence.

## Commit / push

Phase 2 implementation commit: `PENDING_PUBLICATION`. It will be pushed before Phase 3 starts.

## Next phase

Phase 3 adds authenticated `/v1/domain-source/batches` and `/v1/domain-source/episode-seals`
routes, durable WAL fsync-before-ACK behavior, exact allowlisted routing, duplicate/conflict
handling, and real ClickHouse qualification where the phase explicitly requires it.
