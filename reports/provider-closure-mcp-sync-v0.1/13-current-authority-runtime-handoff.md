# Current Authority Runtime Handoff

Status: ready for the P9A Provider Closure consumer.

## Closure correction

SDAR Telemetry now selects the current Provider Mission authority by Provider `observedAt`, with
stable `sourceRecordId` as the tie-breaker. When the selected fact is `unresolved` or `conflict`,
historical exact Mission facts and relations remain audit evidence but cannot be returned as the
current Execution-to-Mission binding. An exact current fact accepts only authoritative relations
whose `evidenceFactIds` include that exact selected fact.

- Implementation commit: `cceea2b88b697dcaef33dba0bd7679b15b3b28d3`.
- Repository verification: 207 tests; 203 passed, 4 explicit external-database skips, 0 failed.
- New regression coverage proves newer unresolved hides historical exact, newer exact survives an
  older conflict regardless of input order, and equal observation times use the stable source record
  identity.

## Immutable deployment identity

- Image: `sdar-telemetry:cceea2b88b697dcaef33dba0bd7679b15b3b28d3`.
- Image digest: `sha256:34b75ac34cf67bc0ad4d392a4589a8c67fbc1118df96eda279e0857ded3971b1`.
- OCI revision: `cceea2b88b697dcaef33dba0bd7679b15b3b28d3`.
- Runtime project: `sdar-telemetry-latest`; existing PostgreSQL and WAL volumes were retained.

| Service | Start time (UTC) | Endpoint | Result |
| --- | --- | --- | --- |
| Ingestion Gateway | `2026-09-01T01:39:01.733713020Z` | `http://127.0.0.1:18080` | HTTP 200, healthy, restart count 0 |
| Telemetry Worker | `2026-09-01T01:39:03.036699360Z` | internal | running, restart count 0 |
| Query API | `2026-09-01T01:39:01.731922008Z` | `http://127.0.0.1:18081` | HTTP 200, healthy, restart count 0 |
| Admin API | `2026-09-01T01:39:03.033883715Z` | `http://127.0.0.1:18082` | HTTP 200, healthy, restart count 0 |

All published ports remain loopback-only. Protected Query access returns 401 without authentication
and 200 with the already mounted secret-file credential. No credential value is present here.

## Current SMPP Telemetry upstream

- Source commit: `bbadebccd146a639cb38e610a8c931a0257289c3`.
- Image: `smpp-telemetry-processor:bbadebccd146a639cb38e610a8c931a0257289c3`.
- Image digest: `sha256:28d80af3f3b16527c7444224fbadf0b73b7b8f985b3e04692133c7438dd24a04`.
- Processor start: `2026-08-31T14:07:31.428361223Z`; Current Authority API start:
  `2026-08-31T14:08:31.032628018Z`.
- Processor readiness: `ready`, pending writes 0, write failure false.
- Both projection targets reached segment 2 / offset `14887971`, pending 0, `lastError=null`.
- Current Authority API: `http://127.0.0.1:18083`; health HTTP 200.

The failed sample task `15588c56-7ede-4b7d-abf0-87031271c28c` returns one authoritative
Task-to-Execution relation and zero current Execution-to-Mission relations because record
`9d48a6c8-d8f0-5dc0-9dc4-b4229008a0b8` is the latest `unresolved` authority. The normal sample task
`ffcca9cc-7f1b-42d0-97c4-8309d19fec03` returns one Task-to-Execution and one current exact Mission
`64212` relation, `d3575d99-38e5-531e-aacc-52f3f4822bcf`. Audit history is preserved in both cases.

## End-to-end qualification

- `SMPP_BENCHMARK_HANDOFF_V2_LIVE_PASS assets=8`.
- Shared ClickHouse preflight passed release `1.5.1-rc.2`, two targets, six views, readonly level 2.
- Fresh run `codex_it_authority_1788226891329` exercised Gateway -> durable WAL -> Worker -> shared
  ClickHouse -> Query API with two canonical Evidence records.
- Initial and duplicate delivery both returned 202. WAL grew from 3,016 to 6,083 bytes on initial
  delivery and remained 6,083 bytes on the duplicate.
- Query returned both records with HTTP 200, watermark `2026-09-01T01:41:31.703Z`, and exact
  `sdar.evidence/v1` source coverage.
- The protected SMPP task timeline returned HTTP 200 with 11 rows and exact
  `smpp.providerops/v1.1` source coverage; anonymous access returned 401.

## Safety and qualification boundary

No navigation, UGV/device command, cancellation, Runtime MCP mutation, Simulator mutation, direct
shared-table INSERT/DELETE, or historical WAL/ClickHouse deletion was performed. Provider terminal
state and Mission authority remain non-Goal and non-physical evidence; no Goal or physical success is
inferred. There is no remaining P9A handoff blocker.
