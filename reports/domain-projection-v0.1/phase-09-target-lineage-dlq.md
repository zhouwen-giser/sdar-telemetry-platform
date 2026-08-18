# Phase 9 — TargetWriter, lineage, DLQ and conflict closure

## Baseline

- Phase 8 publication HEAD: `5ae5fff`.
- All ten exact RC2 source contracts and mapper definitions were frozen and disabled.
- The Phase 9 implementation commit is `1ac5699` and is pushed to the Draft PR branch.

## Changes

- Added a separate `ClickHouseDomainTargetWriter` for the six exact `sdar_embodied` targets. It
  builds the common RC2 envelope explicitly, omits Alias columns, converts fixed hashes to their
  64-byte representation and rejects any mapped field outside the exact table contract.
- Added existence/hash checks before target insertion. Same identity and same mapped-payload hash
  is an idempotent duplicate. Same identity and a different hash writes a stable blocking DLQ with
  `TARGET_CONTENT_CONFLICT` and does not permit checkpoint advancement.
- Added deterministic RC2 `projection_lineage` rows for produced and skipped decisions. Produced
  replay verifies source hash, target hash and decision; a different existing lineage decision
  blocks as `MAPPER_DETERMINISM_VIOLATION`.
- Added stable RC2 `projection_dead_letter` rows for mapping failures and blocking conflicts. DLQ
  payloads contain only controlled reason/field metadata, never the source payload or credentials.
- Added `DomainProjectionTerminalCloser`, which invokes the checkpoint port only after target plus
  lineage, skipped lineage, or durable mapping DLQ closure. Blocking conflicts and transient target,
  lineage or DLQ failures cannot advance the checkpoint.

## Verification

- TargetWriter focused suite: 8/8 PASS.
- All ten mapper outputs are checked against the locked RC2 table descriptors: no unknown columns,
  no omitted non-null/no-default columns, and 10/10 produced rows have exact lineage.
- Same-hash replay creates one logical target and one lineage row.
- Different-hash target conflict writes a blocking DLQ and commits zero checkpoints.
- Skip and deterministic mapping failure are auditable before checkpoint.
- An injected crash after target insertion and before lineage leaves the checkpoint untouched;
  replay reuses the target, writes lineage and only then commits the checkpoint.
- Commander 7/7, NPC 8/8 and SourceReader 4/4 focused suites passed.
- Typecheck, build, static verification, `git diff --check`, the RC2 ClickHouse contract lock
  (472 objects / 15,949 columns / zero diff) and Domain Source contract lock passed.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G14 real target same-hash replay | PENDING | reserved for Phase 15 real ClickHouse E2E |
| G15 different-hash conflict blocks | PASS | focused conflict closure test; blocking DLQ and no checkpoint |
| G16 produced target lineage coverage | PASS | 10/10 frozen mappings close with exact target plus lineage |
| G17 skip/fail auditable | PASS | reasoned lineage and durable redacted DLQ tests |
| G18 checkpoint only after terminal closure | PASS | ordered closure plus injected post-target/pre-lineage crash test |

## Truthful scope

Phase 9 did not perform ClickHouse DML. Its ClickHouse port tests prove ordering, identities and
fail-closed behavior, but they are not real ClickHouse E2E and are not reported as such. G14 stays
open until Phase 15 writes and replays against the locked live ClickHouse. No projection was
activated, no near-name source table was introduced, and no Benchmark scoring logic was added.

## Next phase

Phase 10 adds reconciliation, bounded replay and schema-drift fail-closed behavior while all
projections remain disabled.
