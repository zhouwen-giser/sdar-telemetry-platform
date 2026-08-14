# 08 — Final Integration Report

Decision: **CONDITIONAL_PASS**

记录日期：2026-08-14（Asia/Shanghai）

真实 Runtime PostgreSQL evidence 已穿过 Runtime Evidence export/transport、Telemetry Gateway、durable WAL、Worker、指定外部 ClickHouse 与 Query API。最终 2,517 条 source tuples 与 2,517 条 Query tuples 精确同哈希，真实 failed/canceled task evidence 可追踪；受控 ClickHouse transport outage 与独立 Worker `SIGKILL` 恢复也已通过。completed task count 为 0，且没有真实 partial ACK exchange，因此不能声明 `INTEGRATION_PASS`。

## Baselines

| Repository/artifact | Value |
| --- | --- |
| Telemetry review/execution commit | `e149888ae0e548baf2b973e237b4c3e64849db2d` + shared uncommitted implementation |
| Runtime review/main | `34ce7a7a43971de37566b24f969b4f0aeadec2b2` |
| Runtime local development execution | `710cb25d9e365c6a1a30a532d22deac787a7c3b0`（contains main baseline） |
| Contract | `sdar.evidence/v1` |
| Canonical contract hash | `sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f` |
| Canonical registry hash | `sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71` |
| Catalog | 100 record types；95 Required；5 Diagnostic |

## Architecture and authority

`Runtime PostgreSQL → RuntimeEvidenceExportService → HttpEvidenceExportTransport → Evidence v1 Gateway → durable segment WAL → Telemetry Worker → ClickHouse 192.168.1.7 → Query API`

- Runtime PostgreSQL owns run facts, export/retry/checkpoint/DLQ/ACK ledger.
- WAL owns receiver durable ACK and restart/replay state.
- ClickHouse/Query are observational only and never mutate Runtime control state.
- v1.3 relay remains an isolated compatibility profile and must not consume v1.4 `evidence_outbox`.
- The full Runtime task process was deliberately stopped during safe recovery. The one-shot path used official Evidence service/repository/transport boundaries and did not load task/workflow/MCP/model/A2A execution.

## Contract compatibility

| Concern | Result |
| --- | --- |
| Exact HEAD/POST path, contract header and Bearer | PASS receiver + real probe HEAD 204 |
| Strict batch and 100 record schemas | PASS 100/100 |
| Canonical payloadHash/recordId/batchHash | PASS for current Node producer |
| Decimal/gapped sequence semantics | PASS, including sparse partition recovery |
| Exact one-field ACK after durable WAL | PASS full-ACK path |
| Durable restart dedup/conflict | PASS |
| Real retry/restart/DLQ recovery | PASS；57 requeued，pending/DLQ 0 |
| Real partial ACK | **PENDING** |
| `secret:` credential resolver consistency | **OPEN**；run safely used `env:` |

## ClickHouse 192.168.1.7

| Item | Evidence/result |
| --- | --- |
| Server | ClickHouse `24.10.2.1` on the only permitted external host |
| Pre-014 | reader `readonly=2`；372 objects / 13,515 columns；target absent |
| Review | `APPROVED_ADDITIVE`；migration 014 contains only idempotent CREATE statements |
| Post-014 | 373 objects / 13,573 columns；one new 58-column `ReplacingMergeTree` table |
| Target | `sdar_core.sdar_evidence_v1_record` |
| Real Runtime write/read | 2,517 rows；2,517 unique record IDs；2,517 unique row IDs |
| Exact reconciliation | PG/CH tuple hash both `sha256:3d8fd06dc9f4bb09b7aa4de518800eaa63c514417ad11e2006ac07e01af537f8` |

No local ClickHouse substitute was started. No database/table was dropped, truncated, deleted from, destructively altered or history-rewritten.

## Runtime E2E

Run/export/source: `codex_it_20260814T065032Z_710cb25_e149888`.

| Layer | Observed result |
| --- | --- |
| PostgreSQL before recovery | total 2,435；ACKed 2,066；pending 369；open DLQ 57 |
| Sparse-recovery fix | first operation requeued 22 then exposed invalid predecessor frontier；fixed operation requeued remaining 35 |
| Final recovery operation | `codex_it_20260814T082118Z_evidence_recovery2`；delivered 451 in 395 drain cycles |
| PostgreSQL final | 2,517 records；sequence `1..2517`；pending 0；DLQ 0；frontier `2517` |
| WAL | partition `c561d2855735b82a3e1b81d4162f4220d4f387624a83fd9af7e6c7670761579c`；2,439 frames；6,224,020 bytes；2,517 records |
| Worker | checkpoint 2,438；2,439 journal files |
| Query | HTTP 200；2,517 rows；watermark `2026-08-14T08:24:36.141Z`；coverage exact `sdar.evidence/v1` |

### Task phase evidence

| Phase | Tasks | Task-linked records | Decision |
| --- | ---: | ---: | --- |
| failed | 7 | 37 | **PASS — real Runtime** |
| canceled | 5 | 26 | **PASS — real Runtime** |
| completed | 0 | 0 | **PENDING — E2E-03** |

Known evidence includes failed tasks `bdd21f07-8a2b-4ab5-8749-27a79c44a559`, `22479a8a-07bb-415a-ae1f-189d346ad3eb`, `c8c3da6a-c75f-499e-b835-5d7a68cbab64` and canceled task `2c722ad4-e1be-4d0d-9473-7ff7aea2c0e2`. Failed/canceled phases are not presented as completed.

## Failure / recovery

- Gateway restart duplicate returns the same ACK and does not grow WAL.
- Runtime DLQ retry/restart recovered all 57 open dead letters and converged to pending 0 / DLQ 0.
- Controlled external ClickHouse transport outage used the required host with unreachable fixed port 1: checkpoint stayed `-1`, WAL stayed 1 frame / 3,271 bytes, and restoring the writer advanced checkpoint to 0 with one write.
- Independent Worker child was actually terminated by `SIGKILL`; restart skipped the already durable projection and completed only the unfinished projection.

Gate I is **PASS** for this authorized scope. The evidence does not claim the real ClickHouse server was killed or that a Worker was killed after a real ClickHouse commit. Gateway commit-boundary kill and physical disk exhaustion remain hardening follow-ups, not substitutes for the completed Gate I scenarios.

## Defects fixed

The implementation fixes the contract mismatch, probe/auth/ACK wire shape, WAL durability/restart identity, canonical hash/sequence semantics, projection drift, missing canonical DDL, ClickHouse DateTime64 input, Query canonical path and independent auth, Compose least privilege/separate secrets/loopback bind, Worker journaling/replay, Runtime terminal failed/canceled phase coverage, Experience change-loop/cursor millisecond normalization, sparse-partition recovery, safe evidence-only one-shot delivery, PostgreSQL search-path-sensitive migration testing and fail-closed governed-control confirmation lookup. Details and evidence are in `07_DEFECTS_FIXED.md`.

## Regression tests

| Telemetry gate | Observed result |
| --- | --- |
| Contract sync/check + drift | PASS |
| `npm test` | PASS；70/70 tests |
| Unified `npm run verify` | PASS；typecheck、build、70/70 tests、static gate |
| `npm run test:sdar-contract` | PASS；21/21 tests |
| `npm run test:clickhouse-schema` | PASS；2/2 tests |
| External fixture E2E | PASS；8/8 checks |
| External failure v2 | PASS；schema v2/status passed/all checks true |

### Gate J — Runtime required command results

| Required command | Observed result |
| --- | --- |
| `pnpm typecheck` | PASS；exit 0 |
| `pnpm test` | PASS；275 files / 2,002 tests；exit 0 |
| `pnpm test:integration` | PASS；35 files / 215 tests + isolated Evidence acceptance 1 file / 1 test；exit 0 |
| `pnpm test:contract` | PASS；47 files / 305 tests；exit 0 |
| `pnpm verify:evidence-contract` | PASS；100 records / 95 required / 5 diagnostic；exit 0 |
| `pnpm verify:evidence-coverage` | PASS；100/100、95/95、5/5、durable 100/100；exit 0 |
| `pnpm verify:architecture` | PASS；791 TypeScript files；exit 0 |
| `pnpm build` | PASS；exit 0 |

The final commands ran against the current shared worktree. One intermediate full-test run observed a FastGateway load-threshold fluctuation (`p99=785.674ms` versus `750ms`); the focused rerun passed 22/22 at `264.196ms`, and the final full 2,002-test rerun passed at `649.494ms`. The initial PostgreSQL port 55432 environment was unusable because of a `template1` collation error; the required suite therefore used the healthy configured port 55434 with disposable isolated databases and completed normally.

## Final acceptance gates

| Gate | Decision | Reason |
| --- | --- | --- |
| A — Baseline | PASS | Both Runtime SHAs and Telemetry baseline recorded. |
| B — Contract | PASS | Exact wire/auth/ACK/hash/sequence contract and real probe/delivery pass. |
| C — 100 Records | PASS | 100/95/5 static contract coverage and 2,517 real Runtime records. This does not claim live occurrence of all 100 types. |
| D — Durable ACK | PASS | ACK follows durable WAL; real path reconciles PG→WAL→CH. |
| E — Retry | **PARTIAL** | Real retry/restart/DLQ and external outage recovery pass; real partial ACK is missing. |
| F — Projection | PASS | 100/100 canonical routing, deployed DDL and 2,517 real rows. |
| G — Real Database | PASS | Required external ClickHouse has additive DDL and exact real write/read evidence. |
| H — Runtime E2E | **PASS** | Real failed/canceled Runtime tasks traversed PostgreSQL→Gateway→WAL→Worker→CH→Query. |
| I — Failure E2E | **PASS** | Controlled external transport outage and actual independent Worker `SIGKILL` recovered without loss/duplicate checkpoint advance. |
| J — Regression | **PASS** | Telemetry 70/70 + static and all eight required Runtime commands pass on the final worktree. |

Because E remains partial and E2E-03 has no completed task, the overall decision is **CONDITIONAL_PASS** even though Gate J passes.

## Remaining risks and follow-ups

1. No real completed task was observed.
2. No real partial ACK cursor was exchanged.
3. General non-enum multi-field skill input merge remains beyond the enum/const fix.
4. Future-source mutation gaps remain for orphan correction/interaction, replay dataset membership without a timestamp, and generalized/fused late writes.
5. Runtime `secret:` schema/resolver mismatch and locale-sensitive Unicode key ordering remain.
6. Compact schema-valid 1,000-record acceptance remains unobserved.

## Modified delivery areas

- Telemetry: versioned contract import, Gateway/WAL/Worker/Query, projection and ClickHouse packages, migration 014, deployment wiring, tests, E2E/failure scripts and reports.
- Runtime: Evidence source/projector coverage, skill-input enum/const continuation, Experience change-driven cursors, sparse DLQ frontier recovery, governed-control consumed-confirmation lookup, PostgreSQL test portability, focused tests and safe one-shot evidence delivery runner.
- Existing unrelated shared-worktree changes were preserved and are not claimed by this report.

## Evidence index

| Evidence | Purpose |
| --- | --- |
| `integrations/skill-driven-agent-runtime/v1.4.1/source-lock.json` | Runtime source provenance and per-file hashes |
| `integrations/skill-driven-agent-runtime/v1.4.1/contract-map.json` | 100/95/5 mapping and compatibility boundary |
| `reports/clickhouse/192.168.1.7-schema-snapshot/reader-pre-014/` | Read-only pre-change schema |
| `reports/clickhouse/192.168.1.7-schema-snapshot/reader-post-014/` | Read-only post-change schema |
| `reports/sdar-integration/evidence/projection-coverage-100.json` | Machine-readable 100-type routing |
| `reports/sdar-integration/evidence/codex_it_20260814T065452Z_710cb25d_e149888a-fixture-e2e.json` | Fixture HEAD/ACK/WAL/restart/replay/query evidence |
| `reports/sdar-integration/evidence/codex_it_20260814T080120Z_710cb25_e149888_v2-fixture-e2e.json` | Controlled outage + actual Worker `SIGKILL` evidence |
| `reports/sdar-integration/evidence/codex_it_20260814T065032Z_710cb25_e149888-runtime-e2e.json` | Redacted real Runtime PG→Query, DLQ recovery and exact reconciliation evidence |
| `00_BASELINE.md`–`07_DEFECTS_FIXED.md` | Detailed baseline, compatibility, schema, coverage, E2E, recovery and defect reports |

## Release posture

The implementation is ready for code review as a **CONDITIONAL_PASS** integration result. It must not be advertised as full production acceptance until the completed-task, partial-ACK and documented product follow-ups are closed.
