# Domain Projection v0.1 — Schema Inventory

Generated: 2026-08-14T13:16:21.953Z

## Authority classification

| Source | Classification | Result |
| --- | --- | --- |
| Goal requirement | Required production authority | SDAR ClickHouse Schema 1.5.x |
| RC1 authority package | Candidate authority | **INTEGRITY FAIL** |
| Repository vendor bundle | Historical/reference only | Embodied Schema 1.0.0 |
| Goal-specific live snapshot | Current real-environment evidence | ClickHouse 24.10.2.1; observed 2026-08-14T13:17:39.818Z |
| Snapshot path | Immutable report input | `reports/clickhouse/192.168.1.7-schema-snapshot/domain-projection-v0-1-phase0/` |
| Live warehouse release row | Schema-version marker | `1.4.1-rc.1`, migrations `00..17`, candidate |
| Live DDL footprint | Object inventory | 1.5 Benchmark objects are present despite the 1.4.1 marker |

The current snapshot is authoritative for object presence, but the warehouse
release marker and DDL footprint conflict. It cannot authorize Mapper
implementation or migration without an explicit compatibility decision.

## Current live database inventory

The read-only Goal-specific snapshot contains all six required Atomic databases:

| Database | Present | Authority |
| --- | :---: | --- |
| `sdar_meta` | yes | projection governance |
| `sdar_core` | yes | general facts; Domain Worker must not write |
| `sdar_commander` | yes | read-only application authority |
| `sdar_npc` | yes | read-only application authority |
| `sdar_embodied` | yes | Domain projection target |
| `sdar_mart` | yes | analytical/evaluation plane; out of scope |

Snapshot totals: 430 objects (310 non-View objects and 120 Views), 14,885
columns and 430 `SHOW CREATE` records.

## Projection governance tables — 6/6 current presence

| Table | Columns | Present | Important observed axes | Contract disposition |
| --- | ---: | :---: | --- | --- |
| `sdar_meta.projection_definition` | 17 | yes | projection ID/stage/name, source databases, target database, contract version, status | Reuse; per-mapping source table/mapper details need frozen Domain definition |
| `sdar_meta.projection_version` | 24 | yes | projection/version, source/target schema, mapping hash/document, namespace/environment versions | Reuse candidate |
| `sdar_meta.projection_run` | 29 | yes | run mode, source/target checkpoints, watermarks, counts, status | Reuse candidate |
| `sdar_meta.projection_checkpoint` | 21 | yes | offset, watermark, last source ID/hash, token, processed count | Gap: explicit revision and produced/skipped/failed counters not proven |
| `sdar_meta.projection_lineage` | 31 | yes | mapping rule, source/target identity/hash, relationship, projection time | Gap: explicit source revision and mapper naming axis require decision |
| `sdar_meta.projection_dead_letter` | 33 | yes | source/target, error stage/code/message, retryability/count, resolution status | Gap: first/last failure and task status semantics require mapping decision |

No parallel governance table may be introduced. If a required contract field cannot be represented losslessly, an additive compatibility migration requires a reviewed schema-gap decision.

## Required target tables — 6/6 current presence

| Target | Columns | Present | Engine observed | Status |
| --- | ---: | :---: | --- | --- |
| `sdar_embodied.control_action` | 79 | yes | `ReplacingMergeTree(projection_revision)` | PRESENT_LIVE |
| `sdar_embodied.control_receipt` | 60 | yes | `ReplacingMergeTree(projection_revision)` | PRESENT_LIVE |
| `sdar_embodied.physical_verification` | 64 | yes | `ReplacingMergeTree(projection_revision)` | PRESENT_LIVE |
| `sdar_embodied.preemption_recovery` | 64 | yes | `ReplacingMergeTree(projection_revision)` | PRESENT_LIVE |
| `sdar_embodied.state_freshness_check` | 58 | yes | `ReplacingMergeTree(projection_revision)` | PRESENT_LIVE |
| `sdar_embodied.human_confirmation` | 58 | yes | `ReplacingMergeTree(projection_revision)` | PRESENT_LIVE |

All six targets partition by `cityHash64(canonical_episode_id) % 64` and sort
by `(tenant_id, project_id, canonical_episode_id, projection_id,
projection_version, canonical_record_id)`. They require a common envelope that
includes canonical episode/run/segment identity, environment mapping,
root-source provenance, projection/mapping versions and hashes. Their mere
presence does not prove a source mapping is feasible.

`physical_verification` has independent verification/criterion/action/device
identity plus expected, actual, comparator, result and device/verification
times; MCP success cannot fill those fields. `state_freshness_check` has an
explicit nullable `observed_at`, so any future mapper must use that source
observation time rather than `ingested_at` or projection time.

## Exact required source tables — 0/10

| Projection | Required exact source | Exact presence | Status |
| --- | --- | :---: | --- |
| DP-C01 | `sdar_commander.mcp_action` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-C02 | `sdar_commander.mcp_receipt` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-C03 | `sdar_commander.capability_track_sample` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-C04 | `sdar_commander.error_recovery` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-C05 | `sdar_commander.ugv_state_snapshot` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-N01 | `sdar_npc.mission_tool_call` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-N02 | `sdar_npc.mcp_receipt` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-N03 | `sdar_npc.hmi_approval` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-N04 | `sdar_npc.preemption_record` | no | `MAPPING_CONTRACT_BLOCKED` |
| DP-N05 | `sdar_npc.blackboard_snapshot` | no | `MAPPING_CONTRACT_BLOCKED` |

## Near-name observations — not compatibility aliases

The live snapshot contains similarly named tables:

- Commander: `action_record`, `mcp_call_detail`, `receipt_record`, `capability_track_detail`, `recovery_record`, `state_snapshot`;
- NPC: `action_record`, `mission_tool_call_detail`, `receipt_record`, `hmi_approval_detail`, `preemption_detail`, `blackboard_snapshot_detail`.

These names are recorded only to support a future user-approved D1 compatibility decision. No near-name table is selected by this report, and no field-level mapping is authorized.

## Existing coarse projection definition

The vendored seed declares a broad `application_to_embodied@1.1.0` P1 projection. The Goal requires ten DP-C/N projections and a projection set containing ten formal projection identities. This is an unresolved identity-model gap, not an implementation detail.

## Authority incompatibilities

1. The RC1 release lock is invalid: `all.sql` fails SHA-256 verification, and
   the package builder reports stale `all.sql` and `manifest.json`.
   The observed `all.sql` SHA-256 is
   `5a175b8749f911ae862482908ed8ef4bf179bbfa7f404140bb424394129c80ea`,
   while the lock declares
   `bd7534a250429fa1202a2c53962dce6e5c5b0e908b0efa3fe6055f4259f38f0f`.
2. Live DDL includes the 1.5 Benchmark footprint, but the latest warehouse
   release row declares `1.4.1-rc.1` / `00..17`.
3. The exact ten source names exist in neither the live server nor the RC1
   migrations.
4. The live targets and governance tables are structurally present, but that
   does not resolve the missing source semantics or projection identity model.

Until D1/D2 and the release-marker decision are explicit:
`BLOCKED_SCHEMA_COMPATIBILITY`.
