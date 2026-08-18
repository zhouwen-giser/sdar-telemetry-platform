# Phase 14 — Compose and operational documentation

## Changes

- Added `domain-projection-worker` to the external-ClickHouse Compose topology. The service receives
  only the writer credential and Control PostgreSQL URL secret, keeps the frozen code target
  allowlist, binds its published health port to loopback by default and starts with the `shadow`
  maximum mode.
- Completed Admin deployment with an independent Bearer secret and Control PostgreSQL URL secret.
  No service receives the complete `.env` or the complete secrets directory.
- Replaced permissive numeric parsing with centralized fail-closed configuration for every Domain
  variable, including batch, poll, lookback, lease/heartbeat, worker identity, health port,
  environment-map version and mode cap.
- Added the Domain worker entry point and dependency/readiness/metrics snapshot against the exact
  RC2 release/hash plus Control PostgreSQL health. Added `CONTROL_POSTGRES_URL_FILE` support without
  logging or committing the URL.
- Updated `.env.example`, static deployment assertions and operator documentation. The external
  Compose topology still contains no ClickHouse server.

## Commands actually run

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| config + Domain API focused suite | PASS — 2 compiled test files; 5 source-level cases |
| `python3 scripts/static_verify.py` | PASS |
| `docker compose --env-file /dev/null -f deploy/compose.external-clickhouse.yaml config --quiet` | PASS |
| `git diff --check` | PASS |
| Docker service smoke | NOT_RUN — Docker API permission denied |
| Domain/Admin live probe | NOT_RUN — required Control PostgreSQL URL and Admin Bearer secret files absent |

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G28 health/readiness/metrics | PARTIAL | production entry point and probe contracts pass; live process probe unavailable |
| G29 external Compose runs all processes | PENDING | static Compose parse passes; actual services were not run |

## Evidence and limitations

The repository does not contain or generate credentials. Static Compose success is not process
smoke evidence. The Domain worker process currently exposes safe operational/dependency state; its
controlled projection data-plane execution is qualified separately in Phase 15 and must not be
inferred from `/ready`. All projection definitions remain disabled and the maximum mode remains
`shadow` unless an explicit authenticated action changes the deployment cap.

## Exact resume input

Provide untracked `deploy/secrets/control_postgres_url`, `admin_api_bearer_token` and the existing
ClickHouse writer secret, plus Docker API access. Then run the Compose smoke and probe `/health`,
`/ready`, `/metrics` and authenticated Admin routes before closing G28/G29.

## Next phase

Phase 15 runs controlled real ClickHouse 24.10.2.1 data-plane E2E, replay and crash-boundary
recovery. Fixtures and port tests cannot satisfy G14/G30/G31.
