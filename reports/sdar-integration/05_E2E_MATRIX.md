# 05 — End-to-End Matrix

记录日期：2026-08-14

## Decision boundary

当前 E2E 结论为 **CONDITIONAL_PASS**。真实 Runtime PostgreSQL producer path 已对 failed/canceled tasks 与 2,517-record source-to-query chain 通过；completed-task 与 partial-ACK 场景未闭合。

状态严格区分：

- **PASS — real Runtime**：证据源自真实 Runtime PostgreSQL/outbox 并穿过正式 Evidence delivery boundary。
- **PASS — external controlled**：指定外部 ClickHouse、真实 Gateway/WAL/Worker/Query 或实际 OS crash 参与，但 producer input 可为 fixture。
- **PASS — local**：contract/unit/integration test，不替代真机 Runtime 场景。
- **PARTIAL/PENDING**：只闭合部分条件或无可支持 PASS 的执行证据。

## Real Runtime run

| Field | Observed value |
| --- | --- |
| Export/source ID | `codex_it_20260814T065032Z_710cb25_e149888` |
| Node / revision | `node-codex-it-20260814` / 1 |
| Evidence file | `reports/sdar-integration/evidence/codex_it_20260814T065032Z_710cb25_e149888-runtime-e2e.json` |
| Safety boundary | full Runtime task process stopped；official evidence-only service/repository/transport boundaries only |
| Probe | HEAD 204 |
| PG final | 2,517 records；sequence `1..2517`；pending 0；DLQ 0 |
| WAL | 2,439 frames；6,224,020 bytes；2,517 records |
| Worker | checkpoint 2,438；2,439 journals |
| External Query | 200；2,517 rows；2,517 unique record IDs；2,517 unique row IDs |
| Exact reconciliation | PG and CH tuple hash both `sha256:3d8fd06dc9f4bb09b7aa4de518800eaa63c514417ad11e2006ac07e01af537f8` |
| Task phases | failed 7 tasks / 37 records；canceled 5 / 26；completed 0 |
| DLQ recovery | 57 total requeued；final operation delivered 451；frontier `2517` |

## External fixture and failure runs

| Run | Classification | Result |
| --- | --- | --- |
| `codex_it_20260814T065452Z_710cb25d_e149888a` | Frozen producer fixture | HEAD/POST/restart ACK、WAL non-growth、Worker replay、2-row Query；8/8 checks true |
| `codex_it_20260814T080120Z_710cb25_e149888_v2` | Controlled failure E2E | `192.168.1.7:1` transport failure held checkpoint/WAL；restore advanced checkpoint once；independent child actual `SIGKILL` recovered only unfinished projection |

## Task-book E2E matrix

| ID | Scenario | Evidence observed | Status | Remaining acceptance work |
| --- | --- | --- | --- | --- |
| E2E-01 | Runtime `HttpEvidenceExportTransport.probe()` | Runtime-compatible active config and authenticated HEAD returned 204 before evidence delivery. | **PASS — real Runtime** | None for probe scope. |
| E2E-02 | Handoff fixture → Gateway → WAL → Worker → ClickHouse → Query | Fixture run completed all stages on required external host. | **PASS — external controlled** | None for fixture scope. |
| E2E-03 | Real Runtime completed task | Final task distribution contains zero completed tasks. | **PENDING** | Capture one genuine completed task and reconcile source-to-query evidence. |
| E2E-04 | Real Runtime failed task | 7 failed tasks / 37 task-linked records; known failed IDs are queryable in the 2,517-row corpus. | **PASS — real Runtime** | None for failed-task scope. |
| E2E-05 | Pause/resume/cancel/repair breakpoints | 5 canceled tasks / 26 records are present; pause/resume/repair were not separately exercised. | **PARTIAL** | Run the unobserved breakpoint transitions if required for full scenario closure. |
| E2E-06 | Skill lifecycle | Real corpus contains 49 `node_control.skill_governance` rows, but not the full candidate→execution lifecycle family. | **PARTIAL** | Exercise the complete lifecycle record sequence. |
| E2E-07 | MCP task success/failure | Real corpus includes 3 provider-binding revisions but no `mcp_task.*` record. | **PENDING** | Run MCP success and failure with tool/observation/reconciliation evidence. |
| E2E-08 | Capability chain | Route/schema tests pass; real corpus has no complete definition→attempt chain. | **PENDING** | Produce and query a complete real capability chain. |
| E2E-09 | Duplicate/retry delivery | Fixture restart duplicate kept WAL stable; real DLQ/retry recovery reached pending/DLQ 0 and frontier 2,517. | **PASS** | Partial-ACK is tracked separately. |
| E2E-10 | Gateway restart | Restarted receiver returned same ACK `2`; WAL stayed 1 frame/3,254 bytes. | **PASS — external controlled** | None for receiver restart scope. |
| E2E-11 | ClickHouse outage | Worker used allowed host on fixed unreachable port 1; checkpoint `-1→-1`, WAL 1/3,271 unchanged; restore advanced to 0 with one write. | **PASS — external controlled** | This does not claim the real ClickHouse server process was killed. |
| E2E-12 | Worker crash mid multi-projection | Independent child received actual `SIGKILL`; restart skipped durable A and completed only unfinished B. | **PASS — actual OS process** | This does not claim a kill after a real ClickHouse commit. |
| E2E-13 | Invalid batch hash | Rejected before WAL append. | **PASS — local** | None. |
| E2E-14 | Invalid contract header | Missing/wrong/legacy header rejected. | **PASS — local** | None. |
| E2E-15 | Invalid credential | Missing/invalid Bearer rejected without disclosure. | **PASS — local** | None. |
| E2E-16 | 1000/1001 record boundary | 1,001 rejected; generated 1,000 corpus exceeds independent byte limit. | **PARTIAL** | Add compact schema-valid 1,000-record acceptance. |
| E2E-17 | 262144/262145 byte boundary | Exact limit accepted; one byte over rejected. | **PASS — local** | None. |
| E2E-18 | 100-record catalog / >=100 live records | Static corpus covers 100/95/5; real Runtime chain carries 2,517 records across 22 observed types. | **PASS for contract and >=100 records** | Live occurrence of all 100 types is a separate, unproven claim. |

## Supporting gates

| Gate | Evidence | Status |
| --- | --- | --- |
| Contract lock | 121 sources；100/95/5；drift fail-closed | PASS |
| Pre/post schema | 372/13,515 → 373/13,573；only +1 table/+58 columns | PASS external |
| Projection coverage | 100/100 canonical；zero silent drop | PASS static |
| Telemetry full gate | typecheck/build + 70/70 tests + static | PASS |
| Runtime regression commands | Exact commands/counts recorded in `08_FINAL_INTEGRATION_REPORT.md` Gate J | PASS |

## Filled real-Runtime acceptance slot

| Run | Runtime task evidence | PG/export count | HEAD/ACK | WAL | CH/Query | Failure/retry | Status |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `codex_it_20260814T065032Z_710cb25_e149888` | 7 failed + 5 canceled；0 completed | 2,517 | HEAD 204；frontier `2517` | 2,439 frames / offset `0..2438` | 2,517 exact tuples | 57 DLQ recovered；pending/DLQ 0 | **PASS for failed/canceled real task path** |

This row closes Gate H for real failed/canceled tasks but does not close E2E-03 or real partial ACK.
