# Phase 7 — Commander mappings DP-C01 through DP-C05

## Baseline

- Phase 6 publication HEAD: `f25dfac`.
- All ten projection definitions remain disabled; Phase 7 adds pure mapping decisions only.
- Source authority is limited to the five exact Commander `domain_*_source_v1` tables frozen by
  RC2. No logical or near-name legacy table is accepted.

## Changes

- Added five independent deterministic mappers for DP-C01 through DP-C05.
- Added an explicit `produce | skip | fail` decision. NPC records are a registered
  `SOURCE_NOT_APPLICABLE` skip; malformed applicable records fail with the frozen taxonomy rather
  than disappearing.
- DP-C01 maps authoritative device, channel, target, capability, basis, risk, input hash and
  idempotency semantics to `control_action`.
- DP-C02 maps receipt/provider/status fields and canonicalizes optional error and metrics JSON.
- DP-C03 maps physical verification proof and derives a non-negative confirmation latency from
  the two source timestamps. It never converts absence of failure into physical success.
- DP-C04 maps explicit preemption, basis, intent, deadline, stop and recovery semantics.
- DP-C05 creates a deterministic state-field check ID and uses source `observedAt` and
  `evaluatedAt`; no ingest/project clock enters mapped semantics.
- Added five immutable mapping documents and five mapped-payload schemas with source schema,
  target descriptor, document and schema hashes. The manifest is intentionally marked incomplete
  until Phase 8 adds the NPC half.

## Verification

- `commander-domain-mappings.test.ts`: 7/7 PASS.
- The five Golden Commander records produced the five expected targets deterministically on
  replay; mapping documents and payload schemas matched their frozen hashes and validated every
  produced payload.
- Missing device identity, unsupported physical-verification enum and negative confirmation
  latency were rejected explicitly. C04 basis fields and C05 source observation timestamps were
  preserved.
- `npm run verify`: 115 PASS, 0 failed; two Control PostgreSQL tests explicitly skipped because
  their dedicated database URL was absent. Typecheck, build, RC2 lock, Domain Source lock and
  static verification passed.

## Gate state

| Gate | Result | Evidence |
| --- | --- | --- |
| G11 10/10 mapping documents and payload schemas frozen | PARTIAL 5/10 | five Commander documents and five hash-locked schemas |
| G12 10/10 deterministic mapper fixtures pass | PARTIAL 5/10 | all five Commander Golden records pass and replay identically |

Neither gate is claimed PASS until the five NPC mappings land in Phase 8.

## Truthful scope

- Phase 7 tests use frozen fixtures; they are not real ClickHouse mapping or target-write E2E.
- No ClickHouse read/write was performed for this phase and no projection was activated.
- No Benchmark scoring, hard-gate or release-evaluation logic was added.

## Commit / push

Phase 7 implementation commit `d19a64d` (`feat(projection): add commander mappings`) was pushed
to `origin/feature/domain-projection-worker-v0.1` and Draft PR #1.

## Next phase

Phase 8 implements DP-N01 through DP-N05, freezes the complete 10/10 mapping manifest and closes
G11/G12 only after all ten deterministic fixtures pass.
