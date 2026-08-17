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
| Phase 9 | in progress — target writer, lineage, DLQ and conflicts |
| Phases 10–17 | not yet complete |
| Real Domain Projection E2E | not run; reserved for Phase 15 |
| Benchmark Server handoff qualification | not run; reserved for Phase 16 |

Authority remains split correctly: SDAR Runtime PostgreSQL owns execution, the Gateway WAL owns
accepted-batch durability, Control PostgreSQL owns operational leases/actions, and ClickHouse is
fact/projection/analytical storage. This repository will not implement Benchmark scoring.

Current status: `IN_PROGRESS_TEN_MAPPERS_VERIFIED_PROJECTIONS_DISABLED`.

The completion marker must not be emitted until Phases 0–17 and G01–G35 all pass.
