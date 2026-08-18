# Phase 17 — Final acceptance

## Outcome

**BLOCKED — 23/35 gates pass; 12 required gates remain open.**

The implementation and all phase reports are pushed to
`feature/domain-projection-worker-v0.1`; Draft PR #1 remains Draft. The release verifier is
fail-closed and therefore exits non-zero. No completion marker is emitted.

## Final local verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:sdar-clickhouse-contract` | PASS — 472 objects / 15,949 columns / zero diff |
| `npm run check:domain-source-contracts` | PASS — 4 schemas / 10 source IDs / 16 fixtures |
| `npm run check:sdar-evidence-contract` | PASS — 121 files / 100 records / 95 required / 5 diagnostic / a99/eac |
| `npm run verify:domain-projection-contracts` | PASS — 5 schemas / 21 fixtures |
| `npm run check:benchmark-handoff` | PASS static — 8 assets / 10 projections / 7 views / 5 readiness fixtures |
| focused Domain/recovery suite | PASS — 15 files / 78 source-level cases |
| `python3 scripts/static_verify.py` | PASS |
| `docker compose ... config --quiet` | PASS static |
| `npm run verify` | FAIL in restricted sandbox — 27/30 test files pass; 3 loopback-listener files fail under `EPERM` |
| `npm run check:benchmark-consumer` | EXPECTED BLOCK — baseline lacks Domain path |
| `npm run check:domain-projection-release` | EXPECTED BLOCK — 23 pass / 12 open |

The three full-verify failures are `domain-source-ingestion`, `ingestion-gateway` and `query-api`,
all of which open a loopback listener. Their non-listener contracts pass, but this report does not
convert the restricted run into a full PASS.

## Open blocking gates

- G14/G30/G31: run the real ClickHouse 10/10 mapping/replay/SIGKILL harness.
- G19/G27: run authenticated Admin HTTP integration against real Control PostgreSQL.
- G28/G29: provide untracked secrets and Docker API access, then run process/Compose probes.
- G23/G24: implement the formal Domain consumer path in the actual Benchmark Server.
- G32: after consumer implementation, run all seven handoff queries against the rebuilt database.
- G33: update Draft PR #1 body when GitHub connector access is available.
- G35: all prior blockers plus the complete verification command must pass.

## Safety state

- No near-name legacy source is accepted.
- No Benchmark scoring logic is implemented in Telemetry.
- No projection was left active; default cap remains `shadow`.
- No secret or connection value is present in reports.
- Static/mock/fixture results are not described as real ClickHouse E2E.

## Exact resume sequence

1. Run `SDAR_DOMAIN_PHASE15_RUN_ID=codex_dp15_<unique> npm run test:domain-projection-e2e`.
2. Supply Control PostgreSQL/Admin secrets and Docker access; run Compose and API probes.
3. Implement and commit the Benchmark consumer path, update its locked baseline, then run
   `npm run check:benchmark-consumer` and `npm run check:benchmark-handoff:live`.
4. Update Draft PR #1 body and rerun `npm run verify` with loopback permission.
5. Run `npm run check:domain-projection-release`; only a 35/35 PASS permits completion.
