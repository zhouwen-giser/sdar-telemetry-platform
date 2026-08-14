# 06 — Failure and Recovery

记录日期：2026-08-14

## Decision

Gate I is **PASS** for the task-authorized controlled ClickHouse transport outage and actual independent Worker process crash. Real Runtime DLQ retry/restart delivery also passes. A real partial-ACK exchange remains pending under Gate E and is not inferred from full ACK or DLQ recovery.

## Recovery invariants

1. Gateway returns ACK only after the complete Evidence v1 batch is a committed WAL frame.
2. Exact duplicate does not append WAL; identity/hash conflict returns 409 without changing durable state.
3. Committed corruption is preserved and fails closed; it is never silently truncated or skipped.
4. Worker advances a frame checkpoint only after all projection writes succeed.
5. Each successful write has a stable dedup identity and durable journal; restart runs only unfinished writes.
6. Acceptance compares effective rows and exact record/row/payload/WAL identity, not merely eventual row presence.

## Observed scenarios

| Scenario | Injection/trigger | Observed evidence | Status |
| --- | --- | --- | --- |
| Invalid contract/header/auth/hash | HTTP negatives before WAL append | Gateway tests reject without credential disclosure | **PASS — local** |
| WAL high-water | limit below next segment | no commit/ACK；state unchanged | **PASS — local** |
| Worker absent at ingest | fixture Gateway accepted while Worker idle | committed WAL exists before projection; ACK `2` | **PASS — external** |
| Gateway restart + duplicate | recreate Gateway over same WAL, resend | ACK stable；frames 1→1；bytes 3,254→3,254 | **PASS — external** |
| Record/sequence conflict | same identity with different content | 409；no append | **PASS — local** |
| Committed corruption | mutate committed tail | preserve bytes；recovery fail-closed | **PASS — local** |
| Multi-projection exception | A succeeds, B throws | checkpoint remains `-1`; restart only B; then checkpoint 0 | **PASS — local** |
| ClickHouse timestamp incompatibility | ISO timestamp to strict `DateTime64(3,'UTC')` | INSERT-only `date_time_input_format=best_effort`; real rerun passes | **PASS — fixed external** |
| Controlled ClickHouse transport outage | after durable ACK, Worker targets allowed host `192.168.1.7` on fixed unreachable port 1 | unauthenticated preflight unreachable; checkpoint `-1→-1`; WAL 1 frame/3,271 bytes unchanged; restore → checkpoint 0/write 1 | **PASS — external controlled** |
| Worker actual process death | independent child journals A, blocks before B commit, parent sends `SIGKILL` | restart skips A and completes only B with stable identity | **PASS — actual OS process** |
| Runtime DLQ retry/restart | real outbox held 57 open DLQ and 369 pending | all 57 requeued; final recovery delivered 451; pending/DLQ 0; frontier `2517` | **PASS — real Runtime** |
| Sparse partition recovery | global sequences have gaps inside export partition | old predecessor formula exposed check violation; fixed lookup uses actual prior sent/ACKed row; live recovery succeeds | **PASS — fixed real Runtime** |
| Real partial ACK | producer receives a cursor below batch lastSequence | no actual partial cursor exchange captured | **PENDING — Gate E** |
| Gateway crash at fsync/rename | OS kill exactly at commit boundary | atomic design/tests only; no dedicated killpoint run | **PENDING follow-up** |
| Persistent volume exhaustion | real filesystem capacity fault | high-water unit proxy only | **PENDING follow-up** |

## External v2 evidence

Evidence file: `reports/sdar-integration/evidence/codex_it_20260814T080120Z_710cb25_e149888_v2-fixture-e2e.json`.

| Check | Failure state | Recovered state | Result |
| --- | --- | --- | --- |
| Endpoint preflight | `192.168.1.7:1` unreachable without authentication | original writer restored | controlled transport fault only |
| WAL | 1 frame / 3,271 bytes | same committed frame | no loss/growth |
| Worker checkpoint | `-1` before and during failure | `0` | advances only after success |
| Projection writes | 0 committed during transport failure | 1 after restore | eventual completion |
| Worker crash | independent child receives actual `SIGKILL` | new child runs only unfinished B | durable journal respected |

The report schema is v2, status is `passed`, and every recorded boolean check is true. This evidence does **not** claim that the real ClickHouse server process was killed, nor that the Worker was killed after a real ClickHouse commit.

## Real Runtime delivery recovery

Evidence file: `reports/sdar-integration/evidence/codex_it_20260814T065032Z_710cb25_e149888-runtime-e2e.json`.

| State | Records | ACK/pending/DLQ |
| --- | ---: | --- |
| Before recovery | 2,435 | ACKed 2,066；pending 369；open DLQ 57 |
| First operation | 22 requeued | exposed one sparse-partition frontier failure；35 remained |
| Final operation `codex_it_20260814T082118Z_evidence_recovery2` | 35 requeued；451 delivered across 395 drain cycles | pending 0；DLQ 0；frontier `2517`；high-water false |
| Final PG/CH reconciliation | 2,517 | exact tuple hash equal |

The one-shot recovery path used official Runtime Evidence operation/export/repository/transport boundaries while the full task Runtime remained deliberately stopped. It did not load task/workflow/MCP/model/A2A execution.

## Partial ACK semantics

The contract allows `contiguous_with_partial_ack`. This receiver atomically commits a whole batch frame, so normal success returns a full ACK and pre-commit failure returns non-2xx with no ACK. That behavior is contract-compatible, but it does not prove how the real producer resumes from a partial ACK emitted by another receiver path. Gate E therefore remains **PARTIAL**.

## Acceptance statement

- Gate I: **PASS** — controlled external transport outage + actual independent Worker `SIGKILL` + verified recovery.
- Runtime retry/restart/DLQ: **PASS** — no pending or DLQ records at frontier 2,517.
- Gate E: **PARTIAL** — full ACK/retry/restart pass; real partial ACK pending.
