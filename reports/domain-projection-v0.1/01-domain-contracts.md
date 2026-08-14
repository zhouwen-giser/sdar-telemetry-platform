# Domain Projection v0.1 — Phase 1 Contract Freeze

Generated: 2026-08-14T13:56:36.569Z

Phase commit: `4d47235f5e3ffdeffda4eede94023c3755ca1f4e` (pushed)

## Outcome

Phase 1 is complete. Five immutable runtime contracts are implemented through
the existing `packages/telemetry-contracts` validation package; no second
validation framework or projection platform was introduced.

The frozen contract version is `sdar.domain-projection/v1`, with canonical JSON
version `sdar.domain-projection-canonical-json/v1`. Five JSON Schemas are pinned
by canonical SHA-256 in `integrations/domain-projection/contracts/v1/contract-manifest.json`.
The manifest canonical hash is
`sha256:f40ccdae2a7b416395089d1c99042ae16e1a9739256cbeec4677ea5ef73e1364`.

This phase does **not** authorize a Commander/NPC physical source alias, create
a production projection definition, implement a mapper, or write ClickHouse.
All ten DP-C/N mappings remain `MAPPING_CONTRACT_BLOCKED`.

## Frozen contracts

| Contract | Runtime validation highlights |
| --- | --- |
| `DomainProjectionDefinition` | Commander/NPC source authority, six-table Embodied target allowlist, strict SemVer, declared composite cursor and unique tie-breakers, no executable fields |
| `ProjectionCheckpoint` | all-null initial or complete `(occurredAt, recordId, revision)` cursor, non-negative safe counters, accounting and timestamp checks |
| `ProjectionLineage` | deterministic lineage identity, mapper and mapping-rule versions, complete source/target identity and lowercase prefixed SHA-256 |
| `ProjectionDeadLetter` | thirteen frozen failure codes, fixed retryable/non-retryable/blocking classification, missing-identity representation, explicit management resolution for `ignored` |
| `DomainProjectionSet` | one version per projection ID, mapper and definition hash pinning, canonical ordering and immutable set hash |

The target table allowlist is exactly:

- `control_action`
- `control_receipt`
- `human_confirmation`
- `physical_verification`
- `preemption_recovery`
- `state_freshness_check`

## Schema lock

| Kind | Canonical SHA-256 |
| --- | --- |
| definition | `sha256:4ce1aac185d7fc67f7ec93a1a30030f56d6ebbf237ceff9ad839fbea9a7c02d1` |
| checkpoint | `sha256:5ca78b5a81ffa8d47b1605bcc08e570d936b6ac01241bedf6bf2b432ca36255f` |
| lineage | `sha256:bdd33a9759db1f78e4125f0e25d671e5f4f8b39a796ccdec55de97d6e8cf6e2c` |
| dead letter | `sha256:a80443f0c4e1f3d1bd81438961d3287ae8f2d397d26d24e8d1adaea67779ddc3` |
| projection set | `sha256:c6428e67a0b99ce1fee6d7c1094767419a6746277eb73803ad7936f72b0bf3c2` |

The synthetic golden definition hash is
`sha256:704afd437cf8344c6d3fe2c22c22a60fadf5220fac0c849d6464eeb69d57c53e`;
the synthetic golden set hash is
`sha256:ac7bbac3147e41af3a0ab824971c645fc974d19125012be716548e03b609502d`.
These fixtures use `fixture_source_fact` and do not imply a production source
mapping.

## Canonical JSON safety

The v1 canonicalizer is finite and deterministic: 65,536 canonical bytes,
depth 16, 256 array items and 64 object fields. It normalizes negative zero,
uses stable Unicode-key ordering, preserves array order, and rejects cycles,
non-finite values, unsupported scalar types, non-plain objects, Proxies,
sparse arrays, symbols, accessors, non-enumerable/extra array properties, and
executable-code-like field names. Caller accessors and Proxy traps are never
invoked. Validation clones and deep-freezes accepted values without freezing
or mutating the caller.

## Fixtures and verification

- Five schema kinds are represented by both valid and invalid fixtures.
- Fixture corpus: 21 cases — 7 valid and 14 invalid.
- The verifier checks closed directory inventory, safe relative paths, bounded
  assets, no symlinks, kind coverage, schema hash locks, valid acceptance and
  invalid rejection.
- Focused adversarial tests: 13/13 passed.
- `npm run verify:domain-projection-contracts`: passed with a machine-readable
  `domain_projection_contracts.verified` result.
- `npm run check:sdar-evidence-contract`: passed; the producer contract remains
  121 files, 100 record types, 95 required/5 diagnostic, with a99/eac unchanged.
- `npm run verify`: passed after allowing temporary loopback listeners — 83/83
  tests, TypeScript, build and static verification.

The first sandboxed full-verification attempt was unable to bind the gateway
and Query API loopback listeners; the unchanged command was rerun with local
loopback permission and passed. This was an execution-environment restriction,
not a code failure.

## Remaining compatibility gate

Phase 2 and every mapper remain blocked by the Phase 0 decisions:

1. D1 — bind each of the ten exact logical source names to an authoritative
   physical schema, or provide the missing authoritative DDL;
2. D2 — approve ten independent DP-C/N projection IDs (recommended), or grant
   an explicit compatibility exception for the coarse vendor projection;
3. D3 — repair/accept the inconsistent 1.5 RC1 package and live
   `1.4.1-rc.1` release marker as an explicit schema authority decision.

No SourceReader, TargetWriter, worker, mapper, migration, DDL or DML is allowed
before this compatibility gate is resolved.
