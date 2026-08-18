# SMPP Increment Phase Report

- Phase: S5 — Query APIs and metrics
- SDAR Telemetry SHA: `8a6be00`
- SMPP Telemetry SHA: `d7931b84960827eecb46f9e803bbd96797ec1a52`
- ClickHouse release/hash: `1.5.1-rc.2`; schema `sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8`; descriptor `sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335`
- Commands run: `npm run build`; focused Query API/consumer tests; 11-route live read-only SQL compile; live schema/View preflight from S4
- Tests passed/failed/skipped: 17/17 focused tests PASS; 11/11 generated SQL statements compile on the live RC2 server with `readonly=2`; full repository gate deferred to S10
- Live vs fixture boundary: SQL targets, View descriptors, and all generated statements were checked live. HTTP response behavior uses a fake read client and is not claimed as cross-repo E2E.
- Gate changes: G-SMPP-20 local exact-association contract PASS; G-SMPP-23 PASS; G-SMPP-24 PASS
- Blockers/resume point: none; the companion projection supplied real rows in S8.
- Commit/push/PR updates: pushed to Telemetry Draft PR #1

## Endpoint contract

All 11 delta GET endpoints are allowlisted. Caller values are UTF-8 hex encoded and decoded by ClickHouse constant expressions; caller text never enters SQL verbatim. Every query uses the existing read-only ClickHouse client limits.

Episode endpoints start from `sdar_core.remote_task_binding`, enumerate its explicit local/remote task identifiers, follow typed `external_entity_relation_fact` identities, then load the relation's exact `evidence_fact_ids`. No time-window inference is present.

`/v1/smpp/projection-status` exposes target watermark and declares `producer_owned_independent_checkpoint`; it does not turn Query API polling into a durable projection checkpoint.
