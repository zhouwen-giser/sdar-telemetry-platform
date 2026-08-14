# ExecPlan — SDAR Telemetry Domain Projection Worker v0.1

Last updated: 2026-08-14T14:00:53.159Z

## Goal

Add a production-ready, deterministic, checkpointed and auditable Domain Projection Worker to the existing Telemetry Platform. The worker will read application facts from `sdar_commander` and `sdar_npc`, map only semantically supported facts, and write standardized domain facts plus lineage to `sdar_embodied` and existing `sdar_meta.projection_*` governance tables.

This goal does not implement benchmark, scoring, M1–M15, hard-gate, fatal or release-evaluation logic.

## Current state

| Item | Value |
| --- | --- |
| Phase state | `PHASE_1_COMPLETE` |
| Implementation state | `BLOCKED_SCHEMA_COMPATIBILITY` |
| Branch | `feature/domain-projection-worker-v0.1` |
| Branch tracking | `origin/feature/domain-projection-worker-v0.1` |
| Domain Projection base SHA | `44fb583034d350d429c45ab065bd95e8792b74c1` |
| Current HEAD before the Phase 1 contract commit | `3c8b22b0e3bc6430eca292cd7651e34b8bdb52bd` |
| Current `origin/main` | `44fb583034d350d429c45ab065bd95e8792b74c1` |
| Draft PR | [#1](https://github.com/zhouwen-giser/sdar-telemetry-platform/pull/1) — confirmed draft/open |
| Phase 0 documentation commit | `be086281cef5c2c65c7d22acbbc8bfdb086d09f9` (pushed) |
| Phase 0 publication commit | `3c8b22b0e3bc6430eca292cd7651e34b8bdb52bd` (pushed) |
| Phase 1 contract commit | `4d47235f5e3ffdeffda4eede94023c3755ca1f4e` (pushed) |
| Mapper coding allowed | **No** |

## Repository architecture

The existing ingestion path remains unchanged:

`SDAR Runtime → sdar.evidence/v1 Gateway → durable WAL → telemetry-worker → central Projection Registry → external ClickHouse → Query API`

The Domain Projection path must be additive and remain inside this repository:

`sdar_commander / sdar_npc → DomainProjectionRegistry → checkpointed Domain Worker → deterministic mapper → target validation → sdar_embodied → sdar_meta.projection_lineage`

Constraints:

- extend `packages/telemetry-projection-registry`; do not create a second projection-platform package;
- reuse `packages/telemetry-clickhouse`, configuration, validation and query infrastructure where their contracts are sufficient;
- do not reuse the WAL-dependent `TelemetryWorker` as the Domain Worker runtime;
- do not add Kafka, an LLM mapper, arbitrary mapper scripts or evaluation logic;
- application facts are read-only; target and projection-governance facts are append/project only.

## Authoritative inputs

| Input | Observation |
| --- | --- |
| Goal package | Domain Projection Worker v0.1 task package read completely |
| `README.md`, `package.json`, apps, packages, migrations, deploy, scripts, tests | Read-only inventory complete |
| `AGENTS.md`, nested `AGENTS.md`, `CONTRIBUTING.md` | Not present in this repository |
| Runtime Evidence contract | `sdar.evidence/v1` remains unchanged |
| Runtime execution lock | `7246c263bbb5554d01a7aa343ef6f857378e7bf4` |
| Runtime main lock | `34ce7a7a43971de37566b24f969b4f0aeadec2b2` |
| Canonical contract hash | `sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f` |
| Canonical registry hash | `sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71` |

## ClickHouse authority

The Goal-specific read-only snapshot is frozen at
`reports/clickhouse/192.168.1.7-schema-snapshot/domain-projection-v0-1-phase0/`.
It was observed at `2026-08-14T13:17:39.818Z` with `readonly=2` and records:

- ClickHouse `24.10.2.1`;
- all six allowlisted Atomic databases;
- 430 objects: 310 non-View objects and 120 Views;
- 14,885 columns and 430 `SHOW CREATE` records;
- exact requested source tables `0/10`;
- required `sdar_embodied` targets `6/6`;
- required `sdar_meta.projection_*` governance tables `6/6`.

The DDL footprint contains the 1.5 Benchmark objects, but the latest live
`sdar_meta.warehouse_release_definition FINAL` row still declares
`1.4.1-rc.1`, migration range `00..17`, status `candidate`. The server thus
has no internally consistent 1.5 release marker.

The supplied `1.5.0-rc.1` package is not release-lock clean:
`sha256sum -c` fails for `all.sql`, while `tools/build_package.py --check`
reports stale `all.sql` and `manifest.json`. Its authoritative migrations also
contain none of the ten exact source table names.

Implementation is blocked until an explicit compatibility decision exists.
Observed near-name tables are not substitutes for the missing exact source contracts.

## Existing Projection Registry

`packages/telemetry-projection-registry/src/index.ts` provides `Projection`, `ProjectionRegistry`, canonical Evidence v1 projection and existing specialized projections. Its input is `CanonicalFact`, and its `project()` result has no auditable skip decision, checkpoint contract, schema drift or per-projection state.

The expected additive design is a `DomainProjectionRegistry` inside the same package, sharing stable identity/hash/validation primitives but using an explicit application-fact source model and `project | skip(reasonCode)` decision.

## Existing reconciliation

`packages/telemetry-reconciliation/src/index.ts` currently compares two ID arrays and reports only counts. It does not cover checkpoint lag, target/lineage asymmetry, conflicts, blocked projections, DLQ, dry-run repair or bounded replay. It is an extension point, not an accepted Domain reconciler.

## Current migrations

- repository-owned ClickHouse migration: `migrations/clickhouse/014_sdar_evidence_v1_canonical.sql`;
- control migration: `migrations/control-postgres/001_init.sql`;
- vendored historical DDL: `vendor/sdar-clickhouse-schema/sdar_clickhouse_schema_v1_0/migrations/00..13`.

The vendor bundle is not accepted as the target 1.5.x authority. No Domain migration may be authored or applied until the schema-gap report is resolved. Any approved change must be additive, idempotent and reuse existing `sdar_meta.projection_*` tables.

## Mandatory compatibility decisions

### D1 — Exact source contract

The ten source names required by the task are absent from both the fresh live snapshot and the supplied RC1 migrations. A user-approved compatibility decision must bind each exact logical source to an authoritative physical table/schema, or keep the mapping blocked. Similar names must not be selected implicitly.

### D2 — Projection identity model

The vendored seed models P1 as one coarse `application_to_embodied@1.1.0` projection, while the Goal requires ten formal DP-C/N projections and a set containing ten projection IDs/versions. A user-approved decision must choose:

1. ten independent projection IDs; or
2. one coarse projection ID plus ten mapping-rule IDs, with an explicit task-book compatibility exception.

### D3 — Schema authority

The supplied 1.5 RC1 package is not integrity-clean and the live release row
still declares `1.4.1-rc.1` despite a 1.5-like DDL footprint. A user-approved
decision must repair the package/release marker or explicitly accept the frozen
live per-table schema fingerprints as the compatibility authority.

## Hard stop

**Do not start Mapper, SourceReader, TargetWriter or Domain Worker implementation until D1 and D2 are explicitly resolved and the inconsistent live/reference 1.5 schema authority is accepted or repaired.**

## Phase progress

| Phase | Status | Exit requirement |
| --- | --- | --- |
| 0 — Baseline/discovery | COMPLETE | evidence frozen; implementation remains behind the compatibility gate |
| 1 — Domain contracts | COMPLETE | five immutable types + schemas + validator + 7 valid/14 invalid fixtures; canonical schema hashes frozen |
| 2–9 — Runtime/mappings/reconcile | BLOCKED | Phase 0 hard stop cleared |
| 10 — Query/Admin/Metrics | NOT_STARTED | endpoints, config, permissions, Compose, health/readiness/metrics |
| 11 — Projection Set | NOT_STARTED | `embodied-standard/1` immutable artifact and hash |
| 12–13 — Acceptance/adversarial | NOT_STARTED | deterministic/restart/conflict/replay/drift and 10/10 mapping evidence |
| 14 — Release acceptance | NOT_STARTED | required scripts, reports and real ClickHouse pass |

## Baseline command evidence

| Command | Result |
| --- | --- |
| `npm run verify` | PASS on current baseline rerun: 70/70 tests, typecheck, build and static gate |
| `npm ci` | NOT_APPLICABLE: no npm lockfile; repository locks with `pnpm-lock.yaml` |
| `npm run check:sdar-evidence-contract` after the current lock refresh | PASS: 121 files, 100 records, 95 required, 5 diagnostic; a99/eac hashes unchanged |
| `npm run clickhouse:preflight` | PASS: `24.10.2.1` |
| `npm run clickhouse:verify` | PASS: `database_count 6` |
| `npm run clickhouse:smoke` | PASS: `1` |

The prior SDAR integration evidence is reusable context but is not Domain Projection acceptance evidence.

## Phase 1 contract evidence

Phase 1 extends the existing `packages/telemetry-contracts` package. The five
readonly contracts, one AJV loader, canonical hash helpers, five hash-locked
JSON Schemas, 21 fixtures and the independent verifier are frozen under
`integrations/domain-projection/contracts/v1/`. No DP-C/N definition or source
alias was created.

| Command | Result |
| --- | --- |
| `npm run verify:domain-projection-contracts` | PASS: 5 schemas; 21 fixtures; 7 valid/14 invalid |
| focused `domain-projection-contracts.test.ts` | PASS: 13/13 adversarial groups |
| `npm run check:sdar-evidence-contract` | PASS: 121 files; 100 records; 95/5; a99/eac unchanged |
| `npm run verify` | PASS with loopback permission: 83/83 tests, typecheck, build and static gate |
| ClickHouse reads/writes in Phase 1 | NOT_RUN / zero; Phase 0 snapshot remains the authority evidence |

Detailed evidence: `reports/domain-projection-v0.1/01-domain-contracts.md` and
`01-domain-contracts.json`.

## Worktree preservation

The following baseline maintenance changes were isolated in commit `40b269b` and pushed before this Phase 0 documentation commit:

- `integrations/skill-driven-agent-runtime/v1.4.1/README.md`
- `integrations/skill-driven-agent-runtime/v1.4.1/source-lock.json`
- `tests/fixtures/worker-crash-child.ts`
- `tests/unit/sdar-contract-lock.test.ts`

## Resume point

Resume at the compatibility gate after Phase 1. Obtain D1/D2/D3 before Phase 2
or any mapper/source/target implementation. Do not resume from mapper code.
