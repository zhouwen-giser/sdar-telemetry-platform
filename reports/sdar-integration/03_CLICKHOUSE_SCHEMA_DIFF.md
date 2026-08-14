# 03 — ClickHouse Schema Snapshot and Additive Diff

## Decision summary

The observed server is ClickHouse `24.10.2.1`. The reader-authenticated pre-migration snapshot contains 6 allowlisted databases, 372 tables/views, and 13,515 columns; it does **not** contain `sdar_core.sdar_evidence_v1_record`, proving migration 014 was an additive new-table change rather than a modification of an existing object. The post-migration reader snapshot contains 373 objects and 13,573 columns and shows exactly one new 58-column target table with the reviewed `ReplacingMergeTree` DDL.

Migration decision: APPROVED_ADDITIVE

The approval marker records the pre-write review decision. Deployment is closed by separate post-014 reader evidence. Live behavior is closed both by the controlled deterministic fixture and by a PostgreSQL-derived Runtime export whose 2,517 rows reconcile exactly with Query results.

## Evidence and observation boundary

| Evidence | Observation |
| --- | --- |
| `reports/clickhouse/192.168.1.7-schema-snapshot/reader-pre-014/server.json` | Server `24.10.2.1`; current database `default`. |
| `reports/clickhouse/192.168.1.7-schema-snapshot/reader-pre-014/snapshot-manifest.json` | Observed `2026-08-14T06:39:56.567Z`; phase `reader-pre-014`; 6 databases / 372 objects / 13,515 columns / 372 SHOW CREATE results. |
| `reader-pre-014/{databases,tables,columns,show-create}.json` | Read-only deployed-schema evidence used for this diff. |
| `reports/clickhouse/192.168.1.7-schema-snapshot/reader-post-014/snapshot-manifest.json` | Observed `2026-08-14T06:48:01.217Z`; phase `reader-post-014`; 6 databases / 373 objects / 13,573 columns / 373 SHOW CREATE results. |
| `reader-post-014/{tables,columns,show-create}.json` | Shows exactly one `sdar_core.sdar_evidence_v1_record`, 58 columns, `ReplacingMergeTree(projected_at)`, `PARTITION BY toYYYYMM(occurred_at)`, `ORDER BY (record_type, record_id, row_id)`. |
| `vendor/sdar-clickhouse-schema/sdar_clickhouse_schema_v1_0/migrations/13_sdar_v1_4_capability_chain.sql` | Frozen migration 13 specialized-table DDL. |
| `migrations/clickhouse/014_sdar_evidence_v1_canonical.sql` | Reviewed additive canonical landing table; byte SHA-256 `fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9`. |
| `packages/telemetry-projection-registry/src/index.ts` | Current canonical and exact specialized routing. |
| `apps/query-api/src/server.ts` | Canonical-table query path. |
| `reports/sdar-integration/evidence/codex_it_20260814T065452Z_710cb25d_e149888a-fixture-e2e.json` | Controlled external write/read/replay evidence: 2 effective rows before and after replay, exact identity/hash/WAL lineage. |
| `reports/sdar-integration/evidence/codex_it_20260814T065032Z_710cb25_e149888-runtime-e2e.json` | Real Runtime PostgreSQL → Query evidence: 2,517 rows, 2,517 unique record/row IDs and exact PG/CH tuple-hash equality. |
| `reports/sdar-integration/evidence/codex_it_20260814T080120Z_710cb25_e149888_v2-fixture-e2e.json` | Controlled external transport outage and independent Worker `SIGKILL` recovery invariants; schema v2 status passed. |

No secret values are included in this report or snapshot. The snapshot queried only `version()`, `currentDatabase()`, `system.databases`, `system.tables`, `system.columns`, and allowlisted `SHOW CREATE` statements.

## Reader endpoint discovery and correction

1. The initial reader URL used host `192.168.1.7` with port `8443`. That TCP endpoint refused the connection; no SQL was executed on that path. This was a port configuration defect, not evidence of a credential or authorization failure.
2. Port `8123` on the same required host was reachable. The initial snapshot at `reports/clickhouse/192.168.1.7-schema-snapshot/` used the writer-side connection configuration, but every request still carried explicit `readonly=2` and a result-row ceiling. It executed no DDL or DML.
3. The local reader URL was corrected from `8443` to `8123`. The snapshot was then repeated with the reader credential and explicit `readonly=2`, producing `reader-pre-014/` with the same 372 objects and 13,515 columns.
4. `server.json`, `databases.json`, `tables.json`, `columns.json`, and `show-create.json` are byte-identical between the two snapshots. The reader-port issue is therefore **resolved configuration**, not an active blocker.

## Deployed pre-014 canonical state

### Existing table

`sdar_core.canonical_evidence_record` exists as a 40-column `MergeTree`:

`tenant_id, project_id, environment, record_id, evidence_record_id, source_system, source_table, source_record_id, source_revision, correlation_id, causation_id, payload_hash, contract_version, schema_name, schema_version, record_family, record_type, delivery_guarantee, evaluation_role, tenant_scope_id, user_scope_id, task_id, context_id, episode_id, run_id, goal_id, goal_version, plan_id, plan_version, skill_execution_id, capability_binding_id, remote_task_binding_id, node_id, evidence_sequence, evidence_refs, artifact_refs, payload_json, occurred_at, recorded_at, ingested_at`

It remains a valid pre-existing warehouse object, but it is not a lossless landing table for the current `sdar.evidence/v1` batch/WAL contract.

### Missing contract lineage in the existing table

| Gap | Existing `canonical_evidence_record` | Required by current Evidence v1 landing |
| --- | --- | --- |
| Exact evidence identity | `record_id UUID` plus separate `evidence_record_id String` | `record_id String` preserves the exact `evidence_<64hex>` identity; deterministic `fact_id` and `row_id` are separate. |
| Export identity | Absent | `export_id`, `export_revision`. |
| Export source/node | No export source ID or batch node | `source_id`, `source_type`, `batch_node_id`. |
| Batch integrity | Absent | `batch_hash`, `first_sequence`, `last_sequence`. |
| Sequence fidelity | `Nullable(UInt64)` | String `evidence_sequence`, preserving the canonical decimal representation without narrowing. |
| Full record | Payload JSON only | Both `payload_json` and full `record_json`. |
| Observation policy | No observation generation | `observation_generation`. |
| Receiver time | Only `ingested_at` | `received_at` and `ingested_at`. |
| WAL lineage | Absent | `wal_partition`, `wal_offset`, `wal_written_at`, `wal_payload_hash`. |
| Projection lineage | Absent | `projected_at`, `projection_id`, `projection_version`. |
| Replay semantics | Plain `MergeTree`; identity includes occurrence time | `ReplacingMergeTree(projected_at)` keyed by stable evidence identity, so a later delivery updates lineage instead of creating a semantic duplicate. |

### Pre-014 absence and post-014 closure

The reader pre-014 `system.tables` and `system.columns` snapshots contain no object named `sdar_core.sdar_evidence_v1_record`. At that observation point the Projection/Query target was not live, no write/query was claimed, and the old `canonical_evidence_record` was not treated as an equivalent substitute.

The post-014 snapshot closes that deployment gap:

- object count changed only from 372 to 373 and column count from 13,515 to 13,573;
- the only new target is `sdar_core.sdar_evidence_v1_record` with exactly 58 reviewed columns;
- its observed engine, partition key, primary/sorting key, codecs and column types match migration 014;
- the controlled fixture inserted and queried two canonical rows, and the real Runtime run inserted/query-reconciled 2,517 canonical rows on the required external host.

This closure does not turn the existing 40-column `canonical_evidence_record` into an alias. The Runtime evidence contains real failed/canceled task rows; it contains zero completed tasks and therefore does not close E2E-03.

## Deployed migration 13 specialized tables

All seven frozen migration 13 physical tables are present as `ReplacingMergeTree` objects. Their observed names and column sets match the vendor DDL:

| Deployed table | Columns observed in the reader snapshot |
| --- | --- |
| `sdar_core.node_capability_version_fact` (22) | `tenant_id, project_id, environment, node_id, record_id, capability_id, capability_version, domain, name, capability_status, risk_level, definition_hash, success_criteria_hash, evidence_requirement_hash, source_record_id, source_record_hash, payload_json, occurred_at, received_at, projected_at, projection_id, projection_version` |
| `sdar_core.capability_implementation_binding_fact` (22) | `tenant_id, project_id, environment, node_id, record_id, binding_id, capability_id, capability_version, implementation_type, implementation_id, implementation_version, binding_role, priority, binding_status, provider_policy_hash, source_record_id, source_record_hash, occurred_at, received_at, projected_at, projection_id, projection_version` |
| `sdar_core.capability_readiness_fact` (20) | `tenant_id, project_id, environment, node_id, record_id, capability_id, capability_version, snapshot_version, readiness_status, catalog_hash, policy_hash, reasons_json, available_implementation_refs, unavailable_implementation_refs, evaluated_at, valid_until, received_at, projected_at, projection_id, projection_version` |
| `sdar_core.a2a_exposure_revision_fact` (21) | `tenant_id, project_id, environment, node_id, record_id, exposure_id, exposure_version, agent_skill_id, capability_id, capability_version, visibility, exposure_status, readiness_publication_policy, exposure_hash, source_record_id, source_record_hash, occurred_at, received_at, projected_at, projection_id, projection_version` |
| `sdar_core.agent_card_revision_fact` (18) | `tenant_id, project_id, environment, node_id, record_id, agent_card_revision, card_status, content_hash, capability_catalog_hash, exposure_refs, source_record_id, source_record_hash, occurred_at, activated_at, received_at, projected_at, projection_id, projection_version` |
| `sdar_core.task_capability_binding_fact` (25) | `tenant_id, project_id, environment, node_id, record_id, episode_id, run_id, a2a_task_id, task_id, binding_id, capability_id, capability_version, exposure_id, exposure_version, binding_hash, success_criteria_hash, evidence_requirement_hash, initial_implementation_refs, source_record_id, source_record_hash, occurred_at, received_at, projected_at, projection_id, projection_version` |
| `sdar_core.task_capability_attempt_fact` (25) | `tenant_id, project_id, environment, node_id, record_id, episode_id, run_id, task_id, binding_id, attempt_id, attempt_no, attempt_reason, attempt_status, plan_id, plan_template_ref, skill_version_refs, provider_binding_refs, source_record_id, source_record_hash, occurred_at, completed_at, received_at, projected_at, projection_id, projection_version` |

## Projection drift disposition

The prior registry used a record-family prefix plus a generic `base + fact_type` row and a default fallback. That behavior could select nonexistent names and could not satisfy the deployed DDL columns. Current code has removed that fallback and repaired the known name drift:

| Previous code target | Deployed/vendor target | Current disposition |
| --- | --- | --- |
| `sdar_core.node_capability_implementation_binding_fact` | `sdar_core.capability_implementation_binding_fact` | Legacy explicit map corrected; Evidence v1 remains canonical-only because its frozen payload cannot fill every DDL column. |
| `sdar_core.node_capability_readiness_fact` | `sdar_core.capability_readiness_fact` | Legacy explicit map corrected; Evidence v1 readiness remains canonical-only. |
| `sdar_core.a2a_agent_card_revision_fact` | `sdar_core.agent_card_revision_fact` | Corrected; `node_control.agent_card_revision` has an exact conditional mapper. |
| `sdar_core.node_control_configuration_revision_fact` | No such deployed migration 13 table | Default fallback removed; configuration records remain canonical-only. |

The other two exact Evidence v1 specialized routes are `node_control.capability_revision → sdar_core.node_capability_version_fact` and `node_control.a2a_exposure → sdar_core.a2a_exposure_revision_fact`. Unit coverage compares each emitted row key set with the vendor DDL. If a frozen payload or required tenant/project/node scope is incomplete, specialized output is suppressed while the canonical row remains.

## Migration 014 safety review

`migrations/clickhouse/014_sdar_evidence_v1_canonical.sql` was reviewed as follows:

- statement 1: `CREATE DATABASE IF NOT EXISTS sdar_core`;
- statement 2: `CREATE TABLE IF NOT EXISTS sdar_core.sdar_evidence_v1_record`;
- creates exactly one table, with 58 columns and `ReplacingMergeTree(projected_at)`;
- uses `record_id String`, preserving `evidence_<64hex>` without UUID coercion;
- uses a deterministic `row_id` stable across export revision, batch, partition, and WAL-offset changes;
- contains no `DROP`, `ALTER`, `DELETE`, `TRUNCATE`, `INSERT`, `UPDATE`, `RENAME`, `REPLACE`, or `OPTIMIZE` statement;
- does not modify or alias the existing `sdar_core.canonical_evidence_record`;
- is guarded by `scripts/apply-evidence-v1-migration.ts`, which requires explicit operator authorization and this report's exact approval marker before it can execute.

## Deployment state and evidence boundary

| Item | State at this report |
| --- | --- |
| Reader port correction | Complete; reader snapshot succeeded on `8123` with `readonly=2`. |
| Pre-014 snapshot | Complete and preserved. |
| Migration 014 static review | Approved additive. |
| Deployed migration result | **VERIFIED** by reader-post-014: one new 58-column table matching reviewed DDL. The report does not invent an unrecorded shell command; it relies on deployed-state evidence. |
| Live `sdar_evidence_v1_record` existence | **VERIFIED** in post-014 snapshot as `ReplacingMergeTree`. |
| Live Evidence v1 fixture writes | **PASS**: 2 controlled rows on `192.168.1.7`; no destructive cleanup. |
| Live Query API fixture result | **PASS**: 2 effective rows before/after fresh-state replay with stable identity/hash/WAL lineage. |
| Real Runtime-derived writes/query | **PASS**: 2,517 PostgreSQL records and 2,517 Query rows; exact tuple hash `sha256:3d8fd06dc9f4bb09b7aa4de518800eaa63c514417ad11e2006ac07e01af537f8`. |

The pre/post snapshots preserve the migration chronology. Schema, real Runtime write/read and authorized failure recovery are closed. Production-level acceptance remains conditional on the completed-task and partial-ACK gaps listed in `05_E2E_MATRIX.md` and `06_FAILURE_RECOVERY.md`.
