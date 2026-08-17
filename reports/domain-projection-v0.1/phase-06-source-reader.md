# Phase 6 — Checkpointed Domain SourceReader and late-arrival handling

## Baseline

- Phase 5 publication HEAD: `bdcc3d8`.
- The live RC2 contract was revalidated immediately before the read-only smoke: ClickHouse
  `24.10.2.1`, release `1.5.1-rc.2`, 472 objects, 15,949 columns, 31 required objects, ten source
  definitions, ten projection definitions, four sets and zero active projections.
- No projection was activated and no ClickHouse write was authorized in this phase.

## Changes

- Added a separate ClickHouse `ClickHouseDomainSourceReader`; it does not reuse the WAL worker.
- Restricted reads to the ten exact RC2 source tables derived from the frozen registry. Arbitrary
  or near-name table identifiers cannot enter the query.
- Added a 30-minute bounded lookback and a maximum page size of 1,000 rows under `readonly=2`.
- Added versioned composite cursors. Ordinary sources order by occurrence time, numeric sequence,
  record ID and numeric source revision. State sources replace sequence ordering with numeric state
  snapshot version.
- Added stable source identity/content indexing: exact replay is a duplicate; the same immutable
  identity with different content fails closed as `SOURCE_CONTENT_CONFLICT`.
- Recomputed every source payload hash and preserved UInt64 values as canonical decimal strings.
- A recovered late record is emitted once, but cannot move an already newer checkpoint backward.

## Real ClickHouse compatibility evidence

Run `codex_dp6_20260817t084700z` re-ran the strict live preflight and then read one existing row
from each of the ten exact RC2 source tables. All 10/10 scans returned one accepted row under
`readonly=2`; there were no writes. Machine evidence is in
`reports/domain-projection-v0.1/evidence/codex_dp6_20260817t084700z-phase-06-source-reader.json`.

The live smoke exposed and closed two real compatibility defects:

1. the source tables use ordinary `MergeTree`, so adding `FINAL` caused `ILLEGAL_FINAL`;
2. `sequence` and `source_revision` are `UInt64`, so applying `length()` caused
   `ILLEGAL_TYPE_OF_ARGUMENT`.

The final reader omits `FINAL` and uses numeric ClickHouse ordering for UInt64 columns. Both cases
have regression assertions.

This evidence is a real ClickHouse read-only SourceReader compatibility smoke. It is not a live
late-arrival fault injection, mapping E2E, target-write E2E or Benchmark evaluation.

## Verification

- `domain-source-reader.test.ts`: 4/4 PASS.
- Bounded lookback, replay deduplication, monotonic checkpoint, content conflict, ordinary/state
  cursor separation, exact contract validation, hash validation and bounded input were covered.
- `npm run verify`: 108 PASS, 0 failed; two Control PostgreSQL tests explicitly skipped because
  their dedicated database URL was absent. Typecheck, build, RC2 lock, Domain Source lock and
  static verification passed.

## Gate

| Gate | Result | Evidence |
| --- | --- | --- |
| G10 late-arrival record is eventually processed without replay duplication | PASS | deterministic bounded-lookback test; one late record accepted once, replay duplicate-only, checkpoint unchanged |

## Commit / push

Phase 6 implementation commit `245af9a` (`feat(projection): add checkpointed reader`) was pushed
to `origin/feature/domain-projection-worker-v0.1` and Draft PR #1.

## Next phase

Phase 7 implements the five Commander mappings DP-C01 through DP-C05 against only their exact
source contracts, with all projections still disabled by default.
