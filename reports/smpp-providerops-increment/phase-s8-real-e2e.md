# SMPP Increment Phase Report

- Phase: S8 — Cross-repo real E2E and restart/conflict tests
- SDAR Telemetry SHA: `8ab9e7c`
- SMPP Telemetry SHA: `9142610d244b248508844abcc0cd20f7eb12e810`
- ClickHouse release/hash: `24.10.2.1 / 1.5.1-rc.2 / 00..26`; schema `sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8`; descriptor `sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335`
- Commands run: companion real send/parity/outage/restart; `npm run test:smpp-providerops-consumer-e2e`; live handoff and Query SQL compilation gates
- Tests passed/failed/skipped: real producer/consumer E2E PASS; actual 17 facts/48 relations/16 types consumed; zero reconciliation issues; no skipped E2E assertion
- Live vs fixture boundary: the producer used fixture payload material, but every asserted delivery, WAL, target, restart, outage, live row, Consumer and Benchmark handoff boundary was real. No mock result is reported as E2E.
- Gate changes: G-SMPP-11–18 PASS; G-SMPP-19–23 PASS; G-SMPP-26 PASS
- Blockers/resume point: none for S8; companion PR review/merge remains an activation step, not an E2E gap.
- Commit/push/PR updates: both phase commits pushed; final PR metadata update recorded in S9

Machine evidence: `evidence/codex-smpp-s8-20260818T023207Z.json`.

The Consumer queried the live external fact/relation tables only after the producer-owned durable checkpoint reached pending zero. It did not poll Query API as a projection mechanism. The resulting readiness was `ready`, but both `goalSuccessProven` and `physicalSuccessProven` remained `false`; the handoff decision contained no score.
