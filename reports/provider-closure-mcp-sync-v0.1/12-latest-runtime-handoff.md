# Latest Runtime Handoff

Status: ready for the P9A Provider Closure consumer.

## Immutable deployment identity

- SDAR Telemetry source commit: `2a1e492fd38d9a8524a6d967171ddb79b80e305b`.
- Image: `sdar-telemetry:2a1e492fd38d9a8524a6d967171ddb79b80e305b`.
- Image digest: `sha256:248e696acaacb50f96a0361f63ed85f5baa37aa056bf1f3509a212b4f6e2c1b8`.
- OCI revision label equals the source commit. No deployed service reports an unknown revision.
- Runtime project: `sdar-telemetry-latest`; its new control and WAL volumes do not replace or delete historical volumes.

The release build first failed because the Docker build stage omitted the TypeScript integration
contracts consumed by the Benchmark verifiers. Commit `2a1e492fd38d9a8524a6d967171ddb79b80e305b`
copies those contracts before compilation and adds a regression test for build ordering.

## Services

| Service | Start time (UTC) | Endpoint | Result |
| --- | --- | --- | --- |
| Ingestion Gateway | `2026-08-31T13:54:00.393249192Z` | `http://127.0.0.1:18080` | healthy, restart count 0 |
| Telemetry Worker | `2026-08-31T13:54:04.961247598Z` | internal | running, restart count 0 |
| Query API | `2026-08-31T13:54:00.382921532Z` | `http://127.0.0.1:18081` | healthy, restart count 0 |
| Admin API | `2026-08-31T13:54:04.959509056Z` | `http://127.0.0.1:18082` | healthy, restart count 0 |

All ports are loopback-only. Health endpoints return HTTP 200. Protected Query routes return HTTP
401 without a credential and HTTP 200 with the mounted credential. Credentials remain secret-file
mounted and are not recorded in this handoff.

## Latest SMPP Telemetry upstream

- Source commit: `fb38ffdf7fbd0590128fb722ba008c5bb928f21b`.
- Image: `smpp-telemetry-processor:fb38ffdf7fbd0590128fb722ba008c5bb928f21b`.
- Image digest: `sha256:449445fc7eb5934de6a492d6a526b853b28ba98427890649ff8e9aae11cbf34c`.
- Start time: `2026-08-31T13:53:11.751382472Z`.
- Processor readiness: ready; WAL entries 36,380; pending writes 0; write failure false.
- Standalone and shared checkpoints both reached segment 2 / offset `12840033`; pending 0 and
  `lastError=null` on both targets.

The upstream fix accepts the authoritative scheduler `reasonCode=null`, handles large accepted
`sourceRecordRefs`, and writes cross-partition historical backlog in stable ClickHouse batches without
raising the server partition limit or deleting WAL/history.

## End-to-end verification

- Repository `npm run verify`: 205 total, 201 pass, 4 explicit external-database skips, 0 fail.
- `SMPP_BENCHMARK_HANDOFF_V2_LIVE_PASS assets=8`.
- SMPP ClickHouse preflight: release `1.5.1-rc.2`, two targets, six views, readonly level 2, PASS.
- A fresh two-record Evidence batch used Gateway → durable WAL → Worker → shared ClickHouse → Query
  API. Initial and duplicate delivery returned 202; WAL stayed at 3,016 bytes on duplicate.
- Query returned record `evidence_2369ec092cc9ea1b3a3a95514d8c30222faac7a4108f452b34b718e3c44a5fdf`
  as `runtime.episode`, projected at `2026-08-31T13:55:38.628Z`.
- The latest normal Provider task has 1,227 shared facts and 1,227 non-null `observed_at` values.
  Terminal record `30918822-fd06-503e-9da6-c278bff24872` is `TERMINAL_COMPLETED`; Mission `64212`
  has authoritative relation `d3575d99-38e5-531e-aacc-52f3f4822bcf`.
- The immutable formal closure snapshot
  `sha256:19ed3d76d93fddc0d49a550cf43038e64cd69c3404509f5580d92dd5a2f79ce1`
  remains `ready`, exact/recovered/found_exact, with `goalSuccessProven=false` and
  `physicalSuccessProven=false`.

## Safety and bounded limitations

No navigation, UGV/device command, cancellation, Simulator mutation, or direct shared-table
INSERT/DELETE was issued during this deployment and qualification.

There is no blocker for the P9A Provider Closure handoff. Two boundaries remain explicit:

1. Task `ffcca9cc-7f1b-42d0-97c4-8309d19fec03` was created at the Provider boundary and has no
   authoritative SDAR A2A origin. Its completed Provider terminal and Mission relation must not be
   reported as SDAR Goal success.
2. Three pre-fix exact Mission `64209` relation rows remain immutable for failed task
   `15588c56-7ede-4b7d-abf0-87031271c28c`. The latest unresolved Mission fact does not yet create a
   tombstone/supersession row, so those historical relations must not be used as qualification evidence.
