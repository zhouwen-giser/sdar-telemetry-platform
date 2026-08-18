# SMPP Increment Phase Report

- Phase: S4 — SDAR consumer/readiness/reconciliation
- SDAR Telemetry SHA: pending phase commit (parent `e2e9bec`)
- SMPP Telemetry SHA: `d7931b84960827eecb46f9e803bbd96797ec1a52`
- ClickHouse release/hash: `1.5.1-rc.2`; schema `sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8`; descriptor `sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335`
- Commands run: `npm run clickhouse:smpp-preflight`; `npm run build`; focused Node unit tests
- Tests passed/failed/skipped: live preflight PASS (2 targets/81 columns, 6 views/97 columns); focused result recorded at commit time
- Live vs fixture boundary: schema and View compilation are live read-only checks; readiness/reconciliation behavior is deterministic unit coverage. No fixture is claimed as cross-repo E2E.
- Gate changes: G-SMPP-03 PASS; G-SMPP-19 PASS; G-SMPP-20 local contract PASS, real E2E pending S8; G-SMPP-21–23 PASS
- Blockers/resume point: consumer reads only frozen external fact/relation contracts. Full OTLP-to-consumer proof remains S8.
- Commit/push/PR updates: pending phase commit on Draft PR #1

## Contract decisions

- Episode assembly requires an explicit SDAR task binding, a typed entity relation, and the relation's `evidence_fact_ids`. It never infers association from a time window.
- Readiness is one of `not_required`, `not_ready`, `degraded`, `ready`, or `conflict`.
- Provider lifecycle `completed` remains provider-side evidence only. Every readiness result fixes `goalSuccessProven=false` and `physicalSuccessProven=false`.
- Query API polling is not a checkpoint or durable projection mechanism. The companion SMPP worker owns the independent durable target checkpoint.
