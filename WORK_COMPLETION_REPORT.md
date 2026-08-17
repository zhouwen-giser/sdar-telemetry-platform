# Work Completion Report

This repository is actively executing the Domain Projection Benchmark Handoff V1.0 on
`feature/domain-projection-worker-v0.1` and Draft PR #1. It is not yet a final completion report.

| Category | Status |
| --- | --- |
| Existing `sdar.evidence/v1` path | verified — 121 imported files, 100 record types, 95 required / 5 diagnostic, unchanged a99/eac hashes |
| Domain governance contracts | verified — five schemas, 21 fixtures and hostile-input tests |
| ClickHouse schema authority | verified live — `24.10.2.1`, release `1.5.1-rc.2`, migrations `00..26` |
| ClickHouse descriptor comparison | verified — 472 objects / 15,949 columns, zero table and column differences against isolated RC2 reconstruction |
| Exact Domain Source availability | verified — 10 sources + 2 Episode Seals; no near-name alias |
| Domain projection definitions | verified disabled — ten independent IDs, four sets, zero active |
| Phase 0 | complete and pushed |
| Phase 1 | complete and pushed — reproducible ClickHouse contract and live verifier |
| Phase 2 | complete and pushed — `sdar.domain-source/v1`, 10 source types, 2 seals, 16 fixtures |
| Phase 3 | complete and pushed — durable Gateway/WAL, exact 12-table landing, real ClickHouse E2E |
| Phase 4 | complete and pushed — real PostgreSQL lease fencing, action/replay/producer repositories |
| Phase 5 | complete and pushed — ten disabled definitions, RFC 9562 identity, common envelope |
| Phase 6 | complete and pushed — checkpointed exact-source reader, bounded lookback, live read-only 10/10 smoke |
| Phase 7 | complete and pushed — five Commander mappings, five hash-locked documents/schemas |
| Phase 8 | complete and pushed — five NPC mappings; G11/G12 close at 10/10 |
| Phase 9 | complete and pushed — exact target writer, lineage/DLQ terminal closure and checkpoint-last crash tests |
| Phase 10 | complete and pushed — reconciliation, bounded replay, DLQ service and schema-drift fail-closed |
| Phase 11 | complete and pushed — safe lifecycle, four projection sets and no false-ready empty state |
| Phase 12 | complete and pushed — bounded Query contract plus authenticated Admin and worker probe surfaces; live integration gates remain open |
| Phase 13 | complete and pushed — frozen Benchmark handoff assets and static verifier; actual consumer/live query gates remain open |
| Phase 14 | complete and pushed — Domain/Admin Compose and safe configuration; actual process smoke remains open |
| Phases 15–17 | not yet complete |
| Real Domain Projection E2E | not run; reserved for Phase 15 |
| Benchmark Server handoff qualification | not run; reserved for Phase 16 |

Authority remains split correctly: SDAR Runtime PostgreSQL owns execution, the Gateway WAL owns
accepted-batch durability, Control PostgreSQL owns operational leases/actions, and ClickHouse is
fact/projection/analytical storage. This repository will not implement Benchmark scoring.

Current status: `IN_PROGRESS_PHASE_14_DEPLOYMENT_WIRED_LIVE_PROCESS_AND_E2E_GATES_PENDING`.

Phase 9 closed G15–G18 with deterministic port tests covering ten exact target descriptors,
100% produced lineage, skip/fail audit and post-target/pre-lineage crash recovery. G14 remains
explicitly pending for real ClickHouse same-hash replay in Phase 15; no fixture result is counted
as real E2E.

Phase 10 closes G20 with exact mapping/descriptor drift tests. Phase 12 exposes those service
semantics through the authenticated Admin contract, while the required real HTTP/Control
PostgreSQL integration remains explicitly open.

Phase 11 closes G21/G22 without activating a projection. G23 remains a Phase 16 consumer gate.

Phase 12 closes G26 with fixed, typed, bounded Query routes. G19/G27 remain partial until an
authenticated HTTP-to-Control-PostgreSQL integration run succeeds; G28 remains partial until the
wired worker is probed live. The missing database environment and sandbox listener restriction are
recorded as skips/pending work, never as passes.

Phase 13 closes G25 and freezes `sdar.telemetry-domain-handoff/v1`. Its static verifier passes, but
G23/G24 remain assigned to the actual Benchmark consumer and G32 remains partial until all seven
consumer queries run against the rebuilt database. The blocked live attempt is not counted as E2E.

Phase 14 adds the Domain worker/Admin services, independent secrets and fail-closed configuration.
G28/G29 remain open: Docker and required untracked Control PostgreSQL/Admin secrets were not
available, so no process smoke or live runtime probe is claimed.

The completion marker must not be emitted until Phases 0–17 and G01–G35 all pass.
