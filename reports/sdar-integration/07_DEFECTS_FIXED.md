# 07 — Defects Found and Fixed

记录日期：2026-08-14

## Fixed defects

| ID | Severity | Baseline defect | Fix | Evidence/status |
| --- | --- | --- | --- | --- |
| DEF-001 | P0 | Integration lock represented obsolete v1.3 assumptions. | Reproducible v1.4.1 import/sync/check locks Runtime SHAs, 121 files, canonical hashes and 100/95/5 catalog. | Drift fail-closed；**FIXED** |
| DEF-002 | P0 | Gateway body/validator/ACK were wire-incompatible. | Strict `sdar.evidence/v1`, exact HEAD/POST/header/Bearer and one-field ACK. | tests + fixture + real HEAD 204/2,517 delivery；**FIXED** |
| DEF-003 | P0 | Process-local duplicate authority and incomplete WAL durability. | Immutable checksummed segments, file + parent-directory fsync, atomic rename, durable restart identity/conflict. | duplicate/restart/corruption tests；**FIXED** |
| DEF-004 | P0 | Producer hash/record identity/decimal sequence semantics were missing. | Producer-equivalent payloadHash/recordId/batchHash and BigInt/gapped sequence validation. | contract tests + exact PG/CH tuple hash；**FIXED for current Node producer** |
| DEF-005 | P0 | Generic projection guessed wrong tables/fields and could silently lose records. | Canonical-first 100/100 routing; only 3 lossless specialized mappings; no fallback fabrication. | 100/95/5 coverage；zero silent drop；**FIXED** |
| DEF-006 | P0 | No deployed lossless Evidence v1 table. | Reviewed additive migration 014, 58-column `ReplacingMergeTree(projected_at)`. | 372/13,515 → 373/13,573；**FIXED external** |
| DEF-007 | P1 | ClickHouse connection safety and readonly/write separation were incomplete. | Required-host guard, separate reader/writer credential paths, timeouts, readonly=2, redaction, CA-file fail-closed. | client tests + external snapshots/run；**FIXED** |
| DEF-008 | P0 | ISO timestamps failed real `DateTime64(3,'UTC')` inserts. | Add `date_time_input_format=best_effort` to INSERT requests only. | focused test + subsequent external insert/query；**FIXED** |
| DEF-009 | P1 | Query read v1.3 marts and lacked an independent auth boundary. | Canonical `FINAL` timeline/capability/trace, result caps/readonly=2 and independent Bearer auth. | Query tests + real Query 200/2,517；**FIXED** |
| DEF-010 | P0 | Worker could not safely resume a partially completed multi-write frame. | Durable per-write journal and stable dedup token; checkpoint only after all writes. | exception replay + actual child `SIGKILL` recovery；**FIXED** |
| DEF-011 | P1 | Compose image/volume/secret wiring was incomplete or over-privileged. | Shared persistent WAL, least-privilege services, separate secret files, read-only mounts and loopback binds. | Compose/static/image checks；**FIXED** |
| DEF-012 | P1 | Legacy relay could be mistaken for the v1.4 producer path. | Isolated v1.3 relay behind explicit compatibility profile; forbids consuming v1.4 `evidence_outbox`. | static/config review；**FIXED boundary** |
| DEF-013 | P1 | External evidence harness could equate HTTP 202 with completion. | Unique-run fixture validates HEAD/ACK, pre-Worker WAL, restart dedup, replay, external `FINAL` rows and exact lineage. | fixture 8/8 checks；**FIXED** |
| DEF-014 | P1 | Failure harness did not prove actual process death or external transport recovery. | Added unreachable-port transport outage/recovery and independent child actual `SIGKILL` harness. | v2 schema/status passed, all checks true；**FIXED** |
| DEF-015 | P0 | Runtime terminal Evidence projection depended on `runtime_terminal_outcome`, omitting failed/canceled agent tasks. | Project terminal task phase even without outcome; emit episode/request/a2a-task and available goal/plan lineage. | 7 failed + 5 canceled tasks observed in real corpus；**FIXED** |
| DEF-016 | P1 | Runtime Experience polling could reproject forever due to missing cursors and PostgreSQL microsecond vs Node millisecond precision. | Change-driven pending SQL, millisecond-normalized max time, process-mining cursor, revision excludes observed time, no-op keeps checkpoint. | source pending converged to zero；focused tests/typecheck/lint；**FIXED for observed sources** |
| DEF-017 | P0 | DLQ recovery used `first_unacked - 1` despite globally sparse per-partition sequences, creating an impossible ACK frontier. | Derive predecessor from the actual prior sent/ACKed row using eligible CTE/lateral lookup. | unit scenario `2060/2089` + real second operation delivered 451 and cleared DLQ；**FIXED** |
| DEF-018 | P1 | Recovery via a full Runtime process risked unrelated physical/task execution. | Added one-shot evidence-delivery runner using official Evidence operations/export/transport only, active config recheck, lease/lock/probe and fail-fast credential validation. | negative no-token test + safe real recovery；**FIXED for integration operation** |
| DEF-019 | P1 | Enum/const supplementary skill inputs were rejected in some continuation profiles. | Accept exact enum/const scalar/object supplementary values. | focused resolver tests；**FIXED for enum/const cases** |
| DEF-020 | P1 | A Node Control migration rollback test compared `to_regclass(...)::text`, whose schema qualification changes with PostgreSQL `search_path`; the first false failure then caused cascading missing-migration failures. | Assert relation existence as a boolean instead of a search-path-dependent display name. | ordinary healthy PostgreSQL full integration rerun；**FIXED test portability** |
| DEF-021 | P1 | The current development branch ranked physical-control authority by filtering out consumed/revoked confirmations, so a repeat dispatch was denied with generic `AUTHORITY_NOT_FOUND` instead of the durable single-consumption contract error. | Rank unrevoked/unconsumed confirmation first, but fall back to the latest inactive row so application validation still rejects before Provider transport with the precise consumed/revoked state. | repository unit + governed-control restart integration；**FIXED fail-closed semantics** |

## Open producer or acceptance issues

| ID | Severity | Open issue | Safe posture |
| --- | --- | --- | --- |
| OPEN-001 | P1 | Runtime schema accepts `secret:` credential references while current transport resolver supports `env:`. | Use `env:<VARIABLE>` until schema/resolver are unified. |
| OPEN-002 | P2 | Canonical object key order uses locale-sensitive `localeCompare`. | Keep Node implementations aligned; add producer-pinned Unicode golden vectors before non-Node receivers. |
| OPEN-003 | P1 | General non-enum multi-field skill input merge is not covered by the enum/const fix. | Retain focused case support; implement/test the generalized merge separately. |
| OPEN-004 | P1 | Some future mutations lack a reliable pending cursor: orphan correction/interaction, replay dataset membership without time, generalized/fused late writes. | Treat current convergence as observed-source evidence, not a proof for every future mutation. |
| OPEN-005 | P0 acceptance | No real completed task was observed. | Keep E2E-03 pending; do not relabel failed/canceled phases. |
| OPEN-006 | P1 acceptance | No real partial ACK was exchanged. | Gate E remains PARTIAL despite successful full ACK/retry/DLQ recovery. |
| OPEN-007 | P1 acceptance | Compact schema-valid 1,000-record acceptance is missing. | Preserve 1,001 reject and byte-boundary proof; add compact acceptance corpus. |
| OPEN-008 | P1 hardening | Evidence-only runner has no continuously shared mutex with a simultaneously running full exporter; deadline may overrun by one bounded query/cleanup. | Keep the full exporter stopped for this workflow; add PG lock/sparse integration and negative tests before general operator use. |

## Scope statement

No fix changes Runtime's formal Evidence domain contract, starts a substitute local ClickHouse, deletes shared ClickHouse history or makes Telemetry an operational authority. Gate H is closed for real failed/canceled tasks and Gate I for authorized failure scope; the open acceptance issues keep the overall result **CONDITIONAL_PASS**.
