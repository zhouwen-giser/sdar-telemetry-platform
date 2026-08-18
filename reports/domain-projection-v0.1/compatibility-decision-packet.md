# Domain Projection v0.1 — Compatibility Decision Packet

Observed at: `2026-08-14T14:12:43.193Z`

Status: `BLOCKED_PENDING_EXPLICIT_COMPATIBILITY_DECISIONS`

This packet turns the Phase 0 schema mismatch into reviewable decisions. It is
not an authorization to select near-name tables, create migrations, write
ClickHouse data, or start the Domain Projection Worker.

## Frozen evidence

| Item | Evidence |
| --- | --- |
| Base | `origin/main@44fb583034d350d429c45ab065bd95e8792b74c1` |
| Review HEAD | `72b35c35700d038ab1c80729dfabc8a704947b80` |
| Live snapshot time | `2026-08-14T13:17:39.818Z` |
| ClickHouse | `24.10.2.1`; six Atomic databases; 430 objects; 14,885 columns |
| Exact task source tables | `0/10` |
| Required embodied targets | `6/6` |
| Required projection-governance tables | `6/6` |
| Live release marker | `1.4.1-rc.1`; migrations `00..17`; `candidate` |
| Live snapshot fingerprint | `sha256:c3b9e327b1072c8063db5c65220f848890c7da6e4390afdce68f93e706e05170` |
| Supplied package | claims `1.5.0-rc.1`; integrity is not clean |

The live fingerprint is SHA-256 over canonical JSON containing the six
snapshot file paths and their individual byte SHA-256 values, sorted by path.
It proves the captured schema shape only. It does not prove a fresh-install or
upgrade path, source semantics, data quality, or runtime permissions.

## D1 — Logical source to physical source contracts

### Common candidate capabilities

Every reviewed physical candidate is a `MergeTree` table with a stable source
identity envelope:

- identity: `tenant_id + project_id + record_id`;
- source content hash: Collector `payload_sha256 FixedString(64)`;
- ordinary event cursor: `occurred_at + sequence + record_id`;
- ordinary ordering key:
  `tenant_id, project_id, episode_id, occurred_at, sequence, record_id`.

Most ordinary event candidates do not have an explicit revision. They may use
`revision=1` only if an approved source contract declares them immutable. A
repeated identity with a different `payload_sha256` must then be a
`SOURCE_CONTENT_CONFLICT`, not a revision update. State-like candidates use
their explicit version fields.

An incremental reader will still need an approved late-arrival policy. A pure
`occurred_at` high-water mark can lose late rows whose event time moves
backwards; a bounded lookback plus stable identity/hash dedup is required.

### Candidate matrix

| ID | Required logical source | Physical candidate(s) | Assessment | Unresolved semantic contract |
| --- | --- | --- | --- | --- |
| DP-C01 | `sdar_commander.mcp_action` | `action_record` + bounded `mcp_call_detail` | `SEMANTICALLY_INSUFFICIENT` | no authoritative `resource_channel`; `device_id` requires an approved target-entity predicate |
| DP-C02 | `sdar_commander.mcp_receipt` | `receipt_record` | `SAFE_CANDIDATE_FOR_REVIEW` | freeze immutable revision and the three independent status enumerations |
| DP-C03 | `sdar_commander.capability_track_sample` | `capability_track_detail` + `verification_record` | `SEMANTICALLY_INSUFFICIENT` | no stable one-to-one relation; missing device/channel/timestamp physical-proof contract; `verify_failed=0` is not physical pass |
| DP-C04 | `sdar_commander.error_recovery` | `failure_record` + `recovery_record` | `SEMANTICALLY_INSUFFICIENT` | missing preemption identity, phase, device, trigger, deadline, stop confirmation and versioned basis relations |
| DP-C05 | `sdar_commander.ugv_state_snapshot` | `state_snapshot` | `SAFE_CANDIDATE_FOR_REVIEW` | freeze check granularity, threshold policy and enum mapping; use `quality_observed_at`, never ingest/project time |
| DP-N01 | `sdar_npc.mission_tool_call` | `mission_tool_call_detail` + bounded `action_record` | `SEMANTICALLY_INSUFFICIENT` | no authoritative `resource_channel`; device relation is not frozen |
| DP-N02 | `sdar_npc.mcp_receipt` | `receipt_record` | `SAFE_CANDIDATE_FOR_REVIEW` | freeze immutable revision and three independent status enumerations |
| DP-N03 | `sdar_npc.hmi_approval` | `hmi_approval_detail` + bounded `mission_tool_call_detail` | `SAFE_CANDIDATE_FOR_REVIEW` | lookup must match the same tenant/project/episode and exactly one non-empty `action_id_ref` by `approval_id`; zero/many is DLQ |
| DP-N04 | `sdar_npc.preemption_record` | `preemption_detail` + bounded `action_record` | `SEMANTICALLY_INSUFFICIENT` | missing phase and frozen device/basis/trigger-event relations |
| DP-N05 | `sdar_npc.blackboard_snapshot` | `blackboard_snapshot_detail` | `SEMANTICALLY_INSUFFICIENT` | no `observed_at`; `occurred_at` or `ingested_at` cannot be substituted; no stable relation to state snapshot identity |

Summary:

- `SAFE_CANDIDATE_FOR_REVIEW`: 4;
- `SEMANTICALLY_INSUFFICIENT`: 6;
- `NO_CANDIDATE`: 0;
- approved mappings: 0;
- current mapping status: 10/10 `MAPPING_CONTRACT_BLOCKED`.

### What is needed to close D1

The following is a safe partial compatibility decision, but it does not close
the full ten-mapping gate:

> Approve D1-PARTIAL: permit field-level Mapping Contract review for DP-C02
> against `sdar_commander.receipt_record`, DP-C05 against
> `sdar_commander.state_snapshot`, DP-N02 against `sdar_npc.receipt_record`,
> and DP-N03 against `sdar_npc.hmi_approval_detail` with the exact bounded
> approval-to-action lookup described in this packet. This approval does not
> activate a mapper or authorize ClickHouse writes. DP-C01, C03, C04, N01,
> N04 and N05 remain blocked until their missing authoritative fields and
> relations are supplied.

Closing D1 for the full goal requires one of the following:

1. authoritative DDL and semantics for all ten literal source contracts; or
2. an approved compatibility package that both binds each logical source to a
   physical contract and adds/provides the six missing semantic contracts.

A blanket authorization such as "use the closest table" is not sufficient.
In particular, it cannot authorize physical success from MCP success or state
freshness from ingestion/project time.

## D2 — Projection identity and governance compatibility

### Decision recommendation

Use ten independent projection IDs:

| Task | Projection ID | Target |
| --- | --- | --- |
| C01 | `application_to_embodied.dp-c01` | `control_action` |
| C02 | `application_to_embodied.dp-c02` | `control_receipt` |
| C03 | `application_to_embodied.dp-c03` | `physical_verification` |
| C04 | `application_to_embodied.dp-c04` | `preemption_recovery` |
| C05 | `application_to_embodied.dp-c05` | `state_freshness_check` |
| N01 | `application_to_embodied.dp-n01` | `control_action` |
| N02 | `application_to_embodied.dp-n02` | `control_receipt` |
| N03 | `application_to_embodied.dp-n03` | `human_confirmation` |
| N04 | `application_to_embodied.dp-n04` | `preemption_recovery` |
| N05 | `application_to_embodied.dp-n05` | `state_freshness_check` |

Each starts at Domain `projectionVersion=1`, persisted as the strict decimal
warehouse string `"1"`. Mapper IDs are `domain.mapper.dp-c01` through
`domain.mapper.dp-n05`, initially at mapper version `0.1.0`.

The existing `application_to_embodied@1.1.0` seed remains an unchanged legacy
umbrella for the vendor P1 contract. It is not a scheduling, checkpoint, DLQ,
replay or metrics unit for this worker and is not a member of
`embodied-standard/1`.

Ten independent IDs are required because the task requires independent
checkpoint, lag, error, schema-drift, DLQ and replay state. A mapping-rule ID
cannot substitute for a projection ID without breaking those isolation
boundaries.

### Existing governance tables

Reuse all six existing `sdar_meta.projection_*` tables. Their physical keys
already include `projection_id + projection_version`; no parallel governance
tables are allowed.

The frozen Domain contracts have fields that the live/reference tables cannot
represent explicitly. After D2 and D3 approval, the smallest additive schema
proposal is:

- `projection_version`: `source_table`, `target_table`, `mapper_id`,
  `mapper_version`, `definition_hash`;
- `projection_run`: `definition_hash`, `mapper_id`, `mapper_version`,
  `projection_set_id`, `projection_set_version`, `projection_set_hash`;
- `projection_checkpoint`: `source_database`, `source_table`,
  `last_source_revision`, `checkpoint_version`, `produced_count`,
  `skipped_count`, `failed_count`;
- `projection_lineage`: `mapper_id`, `mapper_version`, `source_revision`;
- `projection_dead_letter`: `source_revision`, `failure_class`,
  `first_failed_at`, `last_failed_at`, `management_action_id`,
  `resolution_action`.

No column is removed, renamed or type-changed. `projection_definition` needs no
new column; `status='active'` maps to enabled and every other status maps to
disabled.

`sha256:<64 lowercase hex>` Domain hashes map to warehouse `FixedString(64)`
only through a strict prefix adapter. The adapter validates and removes/adds
the prefix; it never re-hashes or silently normalizes case.

Use the reference RFC 9562 UUIDv5 contract for canonical record IDs. The
logical target identity is
`(projection_id, projection_version, canonical_record_id)`. Do not add a
second SHA-based target identity. Definition hash and mapping-document hash
remain distinct values.

### Approval text

> Approve D2-A: model DP-C01 through DP-N05 as ten independent projection IDs
> `application_to_embodied.dp-c01` through
> `application_to_embodied.dp-n05`, each beginning at projection version 1.
> Preserve `application_to_embodied@1.1.0` unchanged as a legacy umbrella only.
> Reuse the six existing `sdar_meta.projection_*` tables and permit a reviewed,
> additive-only migration for the explicit compatibility columns listed in
> this packet. Use the vendor RFC 9562 UUIDv5 identity contract and strict
> prefixed-hash adapters. Do not seed or activate any of the ten projections
> until its D1 Mapping Contract is approved.

The coarse-ID alternative is not recommended. It requires an explicit task
compatibility exception and still cannot satisfy independent projection
state, replay and health semantics without inventing a second hidden identity
axis.

## D3 — Schema package and live release authority

### Reproduced package inconsistency

The reference README claims deterministic package-build PASS, but:

- `sha256sum -c SHA256SUMS.txt` reports only `all.sql` as failed;
- manifest/checksum/generator/migrations agree on `all.sql` as 815,392 bytes,
  SHA-256 `bd7534a250429fa1202a2c53962dce6e5c5b0e908b0efa3fe6055f4259f38f0f`;
- the directory's actual `all.sql` is 815,482 bytes, SHA-256
  `5a175b8749f911ae862482908ed8ef4bf179bbfa7f404140bb424394129c80ea`;
- the actual aggregate file contains `1.5.0-rc.2` markers and a substantive
  readiness-view query that differs from migration 19;
- `python3 tools/build_package.py --check` reports both `STALE all.sql` and
  `STALE manifest.json`;
- migrations 18–21 do not append a 1.5 warehouse release marker, so both the
  package and live instance still expose `1.4.1-rc.1 / 00..17` provenance.

This is a mixed package, not newline-only drift. The repository vendor bundle
is an older historical reference and cannot replace the 1.5 authority.

### D3-A — Upstream immutable rebuild (recommended)

> Approve D3-A: use migrations as the only upstream source and require the
> SDAR ClickHouse Schema maintainer to resolve the RC1/RC2 semantic difference,
> repair the manifest/checksum build closure, append an accurate 1.5 warehouse
> release marker, and publish a new immutable RC. The new package must pass
> checksum, deterministic build, static validation, fresh install, 1.4.1
> upgrade and ClickHouse 24.8/25.3 execution. The Telemetry repository must not
> modify or re-sign the existing RC1; keep `BLOCKED_SCHEMA_COMPATIBILITY` until
> the replacement package is accepted.

This is the only low-risk path that proves reproducible installation,
upgrade, and release provenance.

### D3-B — Frozen live-shape exception

> Approve D3-B as a temporary compatibility exception: accept the read-only
> live DDL snapshot observed at `2026-08-14T13:17:39.818Z`, with combined
> fingerprint
> `sha256:c3b9e327b1072c8063db5c65220f848890c7da6e4390afdce68f93e706e05170`,
> as this task's schema-shape authority. This does not declare RC1 integrity
> valid, authorize a ClickHouse migration or release-marker update, approve
> near-name source aliases, or close D1/D2. Any schema fingerprint drift must
> fail closed, and final acceptance still requires real ClickHouse E2E.

D3-B can unblock code whose only schema dependency is the captured target/meta
shape, once D1 and D2 are separately resolved. It does not prove deployment
reproducibility and carries a higher operational risk.

## Authorization matrix

| Decision state | Contracts/reports | SourceReader/Mapper/TargetWriter/Worker | ClickHouse migration/write |
| --- | --- | --- | --- |
| Current | allowed | blocked | blocked |
| D2-A only | allowed | blocked by D1/D3 | blocked |
| D3-B only | allowed | blocked by D1/D2 | blocked |
| D1-PARTIAL + D2-A + D3-B | four Mapping Contracts may be reviewed | full ten-projection runtime remains blocked | blocked pending reviewed migration/apply approval |
| Full D1 + D2-A + accepted D3 | Phase 2 implementation may begin | allowed according to ExecPlan | migration still requires its own reviewed apply gate |

## Required response

The smallest unambiguous response is:

```text
D1: <authoritative ten-source package, or D1-PARTIAL plus the owner/plan for the six missing semantic contracts>
D2: approve D2-A
D3: approve D3-A or D3-B
```

Until those decisions are recorded, the correct resume point remains the
compatibility gate after Phase 1.
