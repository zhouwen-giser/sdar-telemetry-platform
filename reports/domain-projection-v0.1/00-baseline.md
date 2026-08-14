# Domain Projection Worker v0.1 — Phase 0 Baseline

Generated: 2026-08-14T13:16:21.953Z

## Decision

Current state: **PHASE_0_COMPLETE / BLOCKED_SCHEMA_COMPATIBILITY**.

The repository has reusable Evidence v1 ingestion, ClickHouse, Projection Registry, Query API and crash-recovery patterns, but no Domain Projection Worker implementation or contract artifacts. Mapper coding is prohibited until the exact source contracts, target schema 1.5.x compatibility and projection identity model are explicitly resolved.

## Git baseline

| Item | Value |
| --- | --- |
| Branch | `feature/domain-projection-worker-v0.1` |
| Tracking branch | `origin/feature/domain-projection-worker-v0.1` |
| Domain Projection base SHA | `44fb583034d350d429c45ab065bd95e8792b74c1` |
| Baseline maintenance commit | `40b269b` (pushed) |
| `origin/main` | `44fb583034d350d429c45ab065bd95e8792b74c1` |
| Draft PR | PENDING / no authoritative evidence |
| Phase 0 commit | PENDING |

Baseline maintenance was intentionally isolated from the Domain Phase 0 commit:

- `integrations/skill-driven-agent-runtime/v1.4.1/README.md`
- `integrations/skill-driven-agent-runtime/v1.4.1/source-lock.json`
- `tests/fixtures/worker-crash-child.ts`
- `tests/unit/sdar-contract-lock.test.ts`

## Baseline command matrix

| Command required by Phase 0 | Current evidence | Status |
| --- | --- | --- |
| `npm ci` | No `package-lock.json` or `npm-shrinkwrap.json`; repository has `pnpm-lock.yaml` | NOT_APPLICABLE_NO_NPM_LOCK |
| `npm run check:sdar-evidence-contract` | 121 files; 100 records; 95 required/5 diagnostic; canonical hashes unchanged | PASS |
| `npm run verify` | Root-task baseline rerun: typecheck/build/static plus 70/70 tests | PASS |
| `npm run clickhouse:preflight` | ClickHouse `24.10.2.1` | PASS |
| `npm run clickhouse:verify` | `database_count 6` | PASS |
| `npm run clickhouse:smoke` | `SELECT 1` returned `1` | PASS |

No prior test result is relabeled as Domain Projection E2E.

## Runtime contract baseline

| Item | Value |
| --- | --- |
| Contract | `sdar.evidence/v1` |
| Runtime execution SHA | `7246c263bbb5554d01a7aa343ef6f857378e7bf4` |
| Runtime main SHA | `34ce7a7a43971de37566b24f969b4f0aeadec2b2` |
| Canonical contract hash | `sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f` |
| Canonical registry hash | `sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71` |

Domain Projection reads ClickHouse application facts and does not alter this Runtime wire contract.

## Repository architecture inventory

| Area | Current implementation | Domain status |
| --- | --- | --- |
| Projection Registry | `ProjectionRegistry` over `CanonicalFact`; central package exists | REUSE/EXTEND; no Domain registry yet |
| ClickHouse | host guard, reader/writer prefixes, timeouts, readonly, redaction, stable insert token | REUSE through allowlisted Domain stores |
| Validation | Evidence AJV 2020 loader and canonical hash; small generic validation helpers | REUSE primitives; Domain runtime schemas absent |
| Worker | WAL-driven `TelemetryWorker` with durable journal/checkpoint and crash tests | REUSE design/tests only; Domain Worker must not use WAL |
| Reconciliation | two ID-array count comparison | INADEQUATE for Domain requirements |
| Data quality | in-memory issue list with random UUID | NOT suitable for persistent Domain DLQ |
| Query model | generic envelope with watermark/freshness/coverage | REUSE where semantics remain observational |
| Config | WAL/gateway/query/admin/telemetry-worker fields only | Domain settings absent |

## API inventory

### Query API

Current routes:

- `GET /health`;
- `GET /v1/tasks/{taskId}/timeline`;
- `GET /v1/tasks/{taskId}/capability-chain`;
- `GET /v1/evidence/trace` with bounded filters.

Current strengths: independent Bearer auth, fixed route builders, readonly=2, maximum-result cap and caller-value hex encoding.

Missing Domain routes:

- `GET /v1/domain/episodes/{episodeId}/facts`;
- `GET /v1/domain/facts/{recordId}/lineage`;
- `GET /v1/domain/source/{sourceDatabase}/{sourceTable}/{sourceRecordId}/projections`.

### Admin API

`apps/admin-api/src/main.ts` is an in-memory placeholder with generic list keys and a caller-supplied `x-role`. It has no Domain projection service, persistent command model, schema validation or production-grade authorization.

All required Domain GET, pause/resume/reconcile/replay endpoints are missing. Replay dry-run default behavior is also missing.

## Compose and configuration inventory

`deploy/compose.external-clickhouse.yaml` correctly keeps ClickHouse external, uses per-service environment allowlists and separate secret files, and publishes API ports to loopback by default.

Missing:

- `domain-projection-worker` service;
- Domain reader/writer credential bindings with least privilege;
- all seven required `DOMAIN_PROJECTION_*` settings;
- Domain health/readiness/metrics port wiring;
- static assertion that Domain Worker has no WAL volume.

The generic Dockerfile already copies apps, packages and the whole `integrations` directory, so it can package the new app and projection set without a second image framework.

## Metrics and readiness inventory

- required metrics implemented: `0/11`;
- Domain `/health`: missing;
- Domain readiness: missing;
- projection/registry/set/source/target/checkpoint readiness checks: missing;
- high-cardinality label rejection tests: missing.

## ClickHouse schema authority

| Evidence | Result |
| --- | --- |
| Required authority | SDAR ClickHouse Schema 1.5.x |
| RC1 package integrity | **FAIL**: `all.sql` checksum mismatch; `all.sql` and `manifest.json` stale |
| Repository vendor bundle | Embodied Schema 1.0.0; not accepted as 1.5 authority |
| Goal-specific live snapshot | `reports/clickhouse/192.168.1.7-schema-snapshot/domain-projection-v0-1-phase0/` |
| Observed / query policy | `2026-08-14T13:17:39.818Z`; `readonly=2`; max 100,000 rows |
| ClickHouse version | `24.10.2.1` |
| Current object/column counts | 430 objects (310 non-View + 120 Views) / 14,885 columns |
| Live warehouse release row | `1.4.1-rc.1`; migrations `00..17`; `candidate` |
| 1.5 DDL footprint | Present, but inconsistent with the live release marker |

Current contract coverage:

- exact required source tables: **0/10**;
- required target tables: **6/6**;
- required projection-governance tables: **6/6**.

The same ten exact source names are absent from the supplied RC1 migrations.
Near-name tables in the snapshot are observations only and are not selected as
compatibility aliases.

## Required decisions before implementation

1. **D1 — exact source → physical contract:** approve authoritative physical sources for all ten mappings, or leave individual mappings blocked.
2. **D2 — projection identity:** choose ten DP-C/N projection IDs or explicitly approve one coarse `application_to_embodied` projection with ten mapping-rule IDs.

Until both decisions and the 1.5 schema compatibility record exist, every mapping remains `MAPPING_CONTRACT_BLOCKED`.

## Phase 0 acceptance matrix

| Requirement | Status |
| --- | --- |
| Branch and base SHA recorded | PASS |
| Repository/API/Compose/reconciliation inventory | PASS |
| Required Phase 0 files created | PASS for local files; commit pending |
| Baseline `npm run verify` | PASS 70/70 |
| Fresh live ClickHouse snapshot | PASS (read-only evidence captured) |
| 1.5/RC1 authority integrity | FAIL |
| Exact source contracts | FAIL 0/10 |
| Target/governance table presence | PASS 6/6 + 6/6 in current live snapshot |
| D1/D2 compatibility decisions | PENDING |
| Draft PR | PENDING |
| Permission to begin Mapper coding | **DENIED** |
