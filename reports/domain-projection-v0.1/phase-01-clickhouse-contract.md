# Phase 1 — ClickHouse 1.5.1-rc.2 contract synchronization

## Baseline

- Branch started at Phase 0 publication commit `d573ef2`.
- `SOURCE_LOCK.json` requires ClickHouse `24.10.2.1`, release `1.5.1-rc.2`, migrations
  `00..26`, schema hash `78da6e…d7b8` and release descriptor hash `1610cf…b335`.
- Phase 0 live/reference descriptor comparison was zero-diff.

## Changes

- Added `integrations/sdar-clickhouse/1.5.1-rc.2` as the immutable Telemetry consumer contract.
- Frozen six Atomic databases, ten exact sources, two seals, ten independent disabled
  projections, four disabled sets, six targets, six governance tables and seven views.
- Generated exact table and column descriptors for 31 required objects from the accepted live
  snapshot.
- Added a byte-locked manifest and package/live descriptor source lock.
- Added an offline sync/check command and a fail-closed live `readonly=2` verifier.
- Added tests proving family counts, exact-source-only routing, governance v2 column coverage and
  asset checksums.
- Updated the stale root README and work-status report without rewriting historical reports.

The repository does not execute the RC2 rebuild aggregate. The integration is a consumer lock,
not a ClickHouse schema installer.

## Commands actually run

- `npm run sync:sdar-clickhouse-contract`
- `npm run check:sdar-clickhouse-contract`
- `npm run typecheck`
- `npm run build`
- focused `sdar-clickhouse-contract` unit tests
- `npm run clickhouse:domain-preflight` against live ClickHouse with `readonly=2`
- `npm run verify` — 87/87 tests plus typecheck, build, RC2 offline lock and static verification

## Results

Offline synchronization is clean: 472 objects, 15,949 columns, 31 required objects, zero table
or column descriptor differences. The live verifier independently re-read the database and
passed the exact release/hash/descriptors, 10 sources, 10 projections, 4 sets, 0 active
projections, and all seven `LIMIT 0` view analyses.

## Evidence and limitations

This is a real live schema-contract verification, but it is not a Domain Projection E2E. No
fixture, mock or static test is labeled as source ingestion or target projection evidence.

## Commit / push

To be filled after the focused Phase 1 commit is created and pushed.

## Next phase or exact blocker

Phase 2 may define `sdar.domain-source/v1` schemas and Golden fixtures against only these exact
source contracts. All projections remain disabled.
