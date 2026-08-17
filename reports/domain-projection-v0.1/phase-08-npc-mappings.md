# Phase 8 — NPC mappings DP-N01 through DP-N05

## Baseline

- Phase 7 publication HEAD: `31e258f`.
- The Phase 7 full gate passed 115 tests with two explicit database skips before the NPC delta.
- All projections remain disabled and the only authorized NPC inputs are the five exact RC2
  `domain_*_source_v1` contracts.

## Changes

- Added deterministic DP-N01, N02, N04 and N05 mappings using the same frozen target semantics as
  their Commander counterparts while retaining independent projection/source identities.
- Added DP-N03 HMI approval to `human_confirmation`. The action relation is exactly
  `payload.actionId`; an absent relation fails as `HMI_APPROVAL_ACTION_LINK_UNRESOLVED`. The mapper
  never searches a legacy detail table or selects a candidate relation.
- Added exact approval decision mapping, monotonic request/decision/validity timestamps and the
  registered invalidation-condition fallback.
- Added five NPC mapping documents and five mapped-payload schemas. The single manifest now freezes
  10/10 independent mappings, documents and schemas and is marked complete.

## Verification

- Commander mapping suite: 7/7 PASS.
- NPC mapping suite: 8/8 PASS.
- All ten frozen Domain Source records map deterministically and validate against the matching
  mapped-payload schema. All ten document/schema canonical hashes match the manifest.
- N03 missing action linkage, unsupported decision and timestamp reversal fail explicitly.
- Typecheck, build, static verification, RC2 contract lock and Domain Source contract lock passed.

The generic `npm run verify` was also run in the restricted sandbox. Twenty test files passed; the
three existing listener-based files failed at process level because loopback binding is denied.
The request to rerun with loopback permission was rejected before execution because the environment
reported its usage limit. This report therefore leaves the escalated full rerun pending and does
not call the sandbox result a full PASS.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G11 10/10 mapping documents and payload schemas frozen | PASS | complete canonical-hash manifest with ten exact source/target documents and ten schemas |
| G12 10/10 deterministic mapper fixtures pass | PASS | Commander 5/5 and NPC 5/5 produce repeatable validated payloads |

## Truthful scope

- Mapping fixtures and AJV checks are not real ClickHouse E2E.
- Phase 8 performed no ClickHouse target write and did not activate a projection.
- No near-name source alias or Benchmark scoring/evaluation code was introduced.

## Commit / push

Phase 8 implementation commit `fcbadc2` (`feat(projection): add npc mappings`) was pushed to
`origin/feature/domain-projection-worker-v0.1` and Draft PR #1.

## Next phase

Phase 9 adds exact target-row validation/write orchestration plus durable ClickHouse lineage, DLQ
and conflict closure. The full loopback gate remains on the final rerun list.
