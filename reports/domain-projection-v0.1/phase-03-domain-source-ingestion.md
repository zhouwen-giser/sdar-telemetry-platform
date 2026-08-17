# Phase 3 — Durable Domain Source ingestion and WAL routing

## Baseline and preflight

- Phase 2 publication HEAD: `692b1b4`.
- Immediately before live DML, `npm run clickhouse:domain-preflight` passed against ClickHouse
  `24.10.2.1`, release `1.5.1-rc.2`, migrations `00..26`, 472 objects, 15,949 columns, 31 required
  objects, 10 sources, 10 projections, 4 sets, 0 active, and 7/7 compiled views.

## Changes

- Added independent Domain Source authentication and exact contract-header enforcement to the
  existing Gateway.
- Added `POST`/`HEAD /v1/domain-source/batches` and
  `/v1/domain-source/episode-seals`; Evidence v1 behavior remains unchanged.
- Added a separate immutable `sdar-domain-source-v1` WAL and application/tenant/project
  partitions.
- ACK is emitted only after file fsync, atomic rename and directory fsync.
- Added restart-safe batch, source identity, sequence and seal duplicate/conflict detection.
- Added a crash-resumable landing worker with durable per-write journal and per-frame checkpoint.
- Added an immutable 12-table allowlist: exactly 10 RC2 source tables and 2 RC2 seal tables.
- Added separate Domain Source bearer secret wiring to Compose.
- Added a controlled real ClickHouse E2E runner that uses a unique tenant/project and emits only
  redacted machine evidence.

## Focused verification

`domain-source-ingestion.test.ts` passed 5/5:

1. exact independent header/token and foreign-header rejection;
2. ACK after `fsync-file → rename → fsync-directory`;
3. restart duplicate/repackaged duplicate idempotence plus pre-append conflict rejection;
4. seal duplicate/conflict behavior;
5. exact 10-source + 2-seal routing and idle replay.

Full `npm run verify` passed 98/98 plus typecheck, build, RC2 lock, Domain Source lock and static
verification.

## Real ClickHouse evidence

Run `codex_dp3_20260817t081412z` used the real Gateway, immutable WAL, landing worker and external
ClickHouse `192.168.1.7`:

- 2 batch ACKs + 2 seal ACKs;
- 2 WAL partitions / 4 durable frames;
- first worker cycle: 4 frames / 12 table writes;
- 10 exact source tables each contain exactly one isolated run row;
- 2 exact seal tables each contain exactly one isolated run row;
- second worker cycle is idle and all counts remain one;
- no projection was activated and no Benchmark scoring ran.

Machine evidence:
`reports/domain-projection-v0.1/evidence/codex_dp3_20260817t081412z-phase-03-domain-source-e2e.json`.

This is a controlled real ClickHouse source-landing E2E. It is not a Domain mapping/target E2E;
that remains reserved for Phase 15.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G06 WAL fsync-before-ACK | PASS | durability event order + restart integration |
| G07 10 source + 2 seal routes | PASS | real ClickHouse 12/12 isolated rows |
| G08 duplicate/conflict | PASS | same identity/hash idempotent; differing hash/sequence/seal rejected before append |

## Commit / push

Phase 3 implementation commit `19ea1c2` (`feat(domain-projection): add durable Domain Source
landing`) was pushed to `origin/feature/domain-projection-worker-v0.1` and Draft PR #1.

## Next phase

Phase 4 adds Control PostgreSQL operational authority for per-projection/version/partition leases,
management actions, replay requests and producer registrations. Projection checkpoints remain in
ClickHouse; all ten projections stay disabled.
