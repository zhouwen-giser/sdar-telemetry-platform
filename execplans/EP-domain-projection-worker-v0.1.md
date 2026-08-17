# ExecPlan — SDAR Telemetry Domain Projection Worker v0.1

Last updated: 2026-08-17T07:28:12.565Z

## Goal

Add a production-ready, deterministic, checkpointed and auditable Domain Projection Worker to the existing Telemetry Platform. The worker will read application facts from `sdar_commander` and `sdar_npc`, map only semantically supported facts, and write standardized domain facts plus lineage to `sdar_embodied` and existing `sdar_meta.projection_*` governance tables.

This goal does not implement benchmark, scoring, M1–M15, hard-gate, fatal or release-evaluation logic.

## Current state

| Item | Value |
| --- | --- |
| Phase state | `PHASE_2_IMPLEMENTED_PUBLICATION_PENDING` |
| Implementation state | `DOMAIN_SOURCE_V1_FROZEN_PROJECTIONS_DISABLED` |
| Branch | `feature/domain-projection-worker-v0.1` |
| Branch tracking | `origin/feature/domain-projection-worker-v0.1` |
| Domain Projection base SHA | `44fb583034d350d429c45ab065bd95e8792b74c1` |
| Current HEAD before the Phase 1 contract commit | `3c8b22b0e3bc6430eca292cd7651e34b8bdb52bd` |
| Current `origin/main` | `44fb583034d350d429c45ab065bd95e8792b74c1` |
| Draft PR | [#1](https://github.com/zhouwen-giser/sdar-telemetry-platform/pull/1) — confirmed draft/open |
| Phase 0 documentation commit | `be086281cef5c2c65c7d22acbbc8bfdb086d09f9` (pushed) |
| Phase 0 publication commit | `3c8b22b0e3bc6430eca292cd7651e34b8bdb52bd` (pushed) |
| Phase 1 contract commit | `4d47235f5e3ffdeffda4eede94023c3755ca1f4e` (pushed) |
| Phase 1 publication commit | `72b35c35700d038ab1c80729dfabc8a704947b80` (pushed) |
| Decision closure | `reports/domain-projection-v0.1/decision-closure.md` and `.json` |
| RC2 live evidence | `reports/clickhouse/192.168.1.7-schema-snapshot/domain-projection-rc2-preflight/` |
| Mapper coding allowed | **After Phase 1 contract synchronization; projections remain disabled** |

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
| Goal package | Benchmark Handoff V1.0: 40/40 files checksum-valid; bundled verifier PASS (10 projections / 35 gates) |
| `README.md`, `package.json`, apps, packages, migrations, deploy, scripts, tests | Read-only inventory complete |
| `AGENTS.md`, nested `AGENTS.md`, `CONTRIBUTING.md` | Not present in this repository |
| Runtime Evidence contract | `sdar.evidence/v1` remains unchanged |
| Runtime main lock | `2275bc52759914bc80113358a9083e6f00d59e6d` (remote re-read exact) |
| Benchmark consumer lock | `ee7f73735595382072b8205b891af554e8496582` (remote re-read exact) |
| Canonical contract hash | `sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f` |
| Canonical registry hash | `sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71` |

## ClickHouse authority

The obsolete RC1 snapshot remains historical evidence. The execution authority is now the
read-only snapshot at
`reports/clickhouse/192.168.1.7-schema-snapshot/domain-projection-rc2-preflight/`,
observed at `2026-08-17T07:28:12.565Z`.

- live ClickHouse is the locked `24.10.2.1`;
- release is `1.5.1-rc.2`, migrations `00..26`;
- schema contract hash is `sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8`;
- release descriptor hash is `sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335`;
- all six databases are Atomic;
- 472 objects and 15,949 columns exactly match the locked `fresh_all.sql` rebuilt under
  isolated ClickHouse local 25.3;
- table descriptor hash is `sha256:40ff8c3e8c162df6c9a5007859b4b4345253e66f087618b9359777dc9bfd2c49`;
- column descriptor hash is `sha256:a0aa5014f4e26f1ec90166a38e5661ea3f457fb5e0acf7fc59ad9b58853987d8`;
- table and column diff counts are both zero;
- all ten exact source tables, two seals, six targets, six governance tables and required views
  exist; seven critical views compile at `LIMIT 0` with no dotted output columns;
- ten source definitions, ten projection definitions and four sets exist; active projections are
  exactly zero.

No remote DDL or DML was executed during this preflight.

## Existing Projection Registry

`packages/telemetry-projection-registry/src/index.ts` provides `Projection`, `ProjectionRegistry`, canonical Evidence v1 projection and existing specialized projections. Its input is `CanonicalFact`, and its `project()` result has no auditable skip decision, checkpoint contract, schema drift or per-projection state.

The expected additive design is a `DomainProjectionRegistry` inside the same package, sharing stable identity/hash/validation primitives but using an explicit application-fact source model and `project | skip(reasonCode)` decision.

## Existing reconciliation

`packages/telemetry-reconciliation/src/index.ts` currently compares two ID arrays and reports only counts. It does not cover checkpoint lag, target/lineage asymmetry, conflicts, blocked projections, DLQ, dry-run repair or bounded replay. It is an extension point, not an accepted Domain reconciler.

## Current migrations

- repository-owned ClickHouse migration: `migrations/clickhouse/014_sdar_evidence_v1_canonical.sql`;
- control migration: `migrations/control-postgres/001_init.sql`;
- vendored historical DDL: `vendor/sdar-clickhouse-schema/sdar_clickhouse_schema_v1_0/migrations/00..13`.

The vendored historical bundle remains non-authoritative. The immutable
`SDAR_ClickHouse_Schema_1.5.1_RC2_Clean_Rebuild.zip` locked by `SOURCE_LOCK.json` is the schema
authority. Telemetry must not execute its destructive rebuild aggregate; it consumes the exact
live source/target/governance contracts and keeps operational authority in Control PostgreSQL.

## Closed compatibility decisions

### D1 — Exact source contract

D1 is approved for the ten exact RC2 `domain_*_source_v1` tables and two exact Episode Seal
tables only. Every near-name legacy candidate remains non-authoritative and must never be used as
an alias.

### D2 — Projection identity model

D2 is approved for ten independent projection identities
`application_to_embodied.dp-c01` through `application_to_embodied.dp-n05`, projection version
`1`, with mapper identities `domain.mapper.dp-*` at `0.1.0`. The coarse historical definition is
legacy umbrella metadata only.

### D3 — Schema authority

D3 is approved only for an exact live match to the checksum-clean RC2 authority. The Phase 0
live comparison passed release, schema hash, release descriptor hash, all object descriptors and
all column descriptors with zero differences.

## Hard stop

**Cleared on `2026-08-17T07:28:12.565Z` by the exact RC2 live preflight.** This does not activate
any projection. A future release/hash/object/column drift must fail closed as
`CLICKHOUSE_SCHEMA_CONTRACT_DRIFT` and suspend affected projection work.

## Phase progress

| Phase | Status | Exit requirement |
| --- | --- | --- |
| Resume Phase 0 — audit/decision closure | COMPLETE | package/heads/decisions/live RC2 exact-match evidence frozen |
| Resume Phase 1 — RC2 contract sync | COMPLETE_PUBLISHED | immutable integration contract and repeatable preflight verifier |
| Phase 2 — Domain Source v1 contracts | COMPLETE_UNPUBLISHED | 10 exact types, 2 seals, batch/ACK, Golden fixtures |
| Phases 3–14 — implementation | NOT_STARTED | implement in order with projections disabled by default |
| Phase 15 — real ClickHouse E2E | NOT_STARTED | must use real 24.10 and must not be replaced by fixtures |
| Phase 16 — Benchmark consumer qualification | NOT_STARTED | contract/readiness/fact consumption only; no scoring code here |
| Phase 17 — release acceptance | NOT_STARTED | G01–G35, reports, PR and final delivery |

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

## Phase 2 contract evidence

Phase 2 adds `sdar.domain-source/v1` under `integrations/domain-source/contracts/v1`. Four
hash-locked JSON Schemas cover batch, Episode Seal, batch acknowledgement and seal
acknowledgement. The batch has ten exact source-contract variants with strict per-source payloads;
two five-record Golden batches cover all ten variants. Six valid and ten adversarial fixtures
prove exact-source-only routing, application isolation, canonical UInt64 revisions, payload/batch
hashes and the prohibition on arbitrary table identifiers. These assets are not live ingestion or
ClickHouse E2E evidence.

## Resume point

Publish Phase 2, then resume at Phase 3 durable Domain Source ingestion and WAL routing. Keep all
projections disabled and preserve the existing Evidence v1 path unchanged.
