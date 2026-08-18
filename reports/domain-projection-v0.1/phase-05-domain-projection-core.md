# Phase 5 — DomainProjectionRegistry, identity and common target envelope

## Baseline

- Phase 4 publication HEAD: `45f393c`.
- The RC2 exact source/target catalog remains locked and all ten projection definitions remain
  disabled.
- Phase 5 adds no mapper logic and performs no ClickHouse I/O.

## Changes

- Added `DomainProjectionRegistry` inside the existing projection-registry package; the legacy
  Evidence registry and worker lane are unchanged.
- Frozen ten independent IDs `application_to_embodied.dp-c01` through `dp-n05`, version 1, mapper
  IDs `domain.mapper.dp-*`, mapper version `0.1.0`, ten exact source contracts and six approved
  target tables.
- Every definition is disabled, schema-valid, deep frozen and pinned by a deterministic definition
  hash. Duplicate projection or source identities fail closed.
- Added RFC 9562 UUIDv5 using the warehouse namespace
  `5832c301-3d9e-5927-8f15-fa6262c8fc4e`, NFC/trim/case-preserving components and the real U+001F
  delimiter.
- Added the vendor length-prefixed `derived-v1` source identity for deterministic one-to-many
  mappings; business array indexes or random values are not generated.
- Added a common target envelope that preserves source/root identity and hash, produces canonical
  Episode/Run/Segment/Record IDs, keeps UInt64 revisions as decimal strings, and hashes the mapped
  canonical payload separately from the source payload.

## Identity Golden evidence

- RFC reference vector: DNS namespace + `www.widgets.com` =
  `21f7f8de-8051-5b89-8680-0195ef798b6a`.
- Independent Python `uuid.uuid5` precomputation for the frozen Unicode SDAR vector =
  `8ea47267-0799-5640-8359-eb2bab0210f5`.
- Source-key SHA-256 =
  `sha256:50491fb8ee6c07faf6553cad677f0670cdea64840d0287463722c42d80f23c5c`.
- Two independent Node child processes and in-process replay returned the same UUID/name/hash.

## Verification

- `domain-projection-core.test.ts`: 6/6 PASS.
- All ten definitions pass the frozen Domain Projection definition validator.
- Exact catalog/source/target resolution, definition hash, duplicate guards, UTF-8 derived ID,
  source mismatch, revision bounds and mapped-payload replay were covered.
- `npm run verify`: 104 PASS, 0 failed; 2 Control PostgreSQL tests explicitly skipped in the
  generic gate because their dedicated database URL was absent. Typecheck, build, RC2 lock, Domain
  Source lock and static verification passed.

## Gate

| Gate | Result | Evidence |
| --- | --- | --- |
| G13 UUIDv5 identities stable across process/replay | PASS | standard + independent Golden vectors; two child processes; replay equality |

## Truthful scope

- Phase 5 definitions are not the ten mapping documents required by G11.
- No DP-C/N mapper, SourceReader, target row, lineage, checkpoint or DLQ was executed.
- No ClickHouse read/write and no Benchmark scoring occurred.
- All projections remain disabled; Phase 5 does not change lifecycle state.

## Commit / push

Phase 5 implementation commit `3c01af4` (`feat(projection): add deterministic domain core`) was
pushed to `origin/feature/domain-projection-worker-v0.1` and Draft PR #1.

## Next phase

Phase 6 adds the separate checkpointed ClickHouse SourceReader, canonical composite cursors,
30-minute bounded lookback, stable identity/hash deduplication and late-arrival recovery tests.
