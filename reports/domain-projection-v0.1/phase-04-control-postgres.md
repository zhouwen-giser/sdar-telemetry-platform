# Phase 4 — Domain projection control PostgreSQL and leases

## Baseline and authority

- Phase 3 publication HEAD: `73a6eda`.
- D10 limits Control PostgreSQL to worker leases, management actions, replay requests and producer
  registration.
- ClickHouse remains the projection checkpoint, lineage, run, DLQ and analytical-governance
  authority. Phase 4 did not create a second governance family.

## Changes

- Added additive migration `002_domain_projection_runtime.sql`; existing `001_init.sql` is
  unchanged.
- Added per-projection lease identity over target, projection ID/version, mapping hash, exact
  Domain Source stream and partition.
- Added atomic claim, database-clock renewal, explicit release, bounded lease duration, opaque
  owner token and monotonically increasing fencing token.
- A released or expired lease row is retained so fencing never resets to one for the same key.
- Added idempotent repositories for management actions and bounded replay requests. Reusing an
  operation ID with a different request hash fails closed.
- Added exact `sdar.domain-source/v1` producer registration and heartbeat storage.
- Kept the existing `ControlPostgres` API compatible and exposed the new repository through
  `domainProjections`.

## Real PostgreSQL concurrency evidence

Run `codex_dp4_20260817t082842z` created a dedicated temporary database on a real PostgreSQL
server, applied migrations `001` and `002`, ran the focused integration test, and removed the
database afterward. No connection string or credential was recorded.

- 12 independent pools attempted the same lease concurrently;
- exactly one writer acquired fencing token 1;
- another writer was blocked while the lease was active;
- renewal preserved token and fence;
- after explicit release, two contenders raced and exactly one acquired fencing token 2;
- the stale first owner could neither renew nor release the new lease;
- a different partition acquired independently;
- action, replay and producer/heartbeat repository tests passed.

Machine evidence:
`reports/domain-projection-v0.1/evidence/codex_dp4_20260817t082842z-phase-04-control-postgres.json`.

This is real PostgreSQL coordination evidence, not ClickHouse E2E and not Domain mapping E2E.

## Verification

- `npm run test:domain-projection-control` against the isolated database: 2/2 PASS, 0 skipped.
- `npm run verify` with loopback permission: 98 PASS, 0 failed; the two database-dependent tests
  were explicitly skipped because `SDAR_TEST_CONTROL_POSTGRES_URL` was intentionally absent from
  the generic gate.
- TypeScript typecheck, build, RC2 contract lock, Domain Source contract lock and static
  verification passed.
- The first sandboxed full run had only the known local-listener restriction; the identical
  command passed after loopback permission was granted.

## Gate

| Gate | Result | Evidence |
| --- | --- | --- |
| G09 Control PG lease prevents concurrent projection writers | PASS | real 12-contender integration; single winner; fence 1→2; stale owner rejected |

## Safety and limitations

- No ClickHouse read or write occurred in Phase 4.
- No projection, mapper or target writer was started; active projection count remains zero.
- No near-name table and no Benchmark scoring code was introduced.
- The production Control PostgreSQL migration is additive and was not applied to any shared
  production database by this phase.

## Commit / push

Phase 4 implementation commit `c082942` (`feat(control): add domain projection coordination`) was
pushed to `origin/feature/domain-projection-worker-v0.1` and Draft PR #1.

## Next phase

Phase 5 adds the DomainProjectionRegistry, deterministic identity primitives and common target
envelope while keeping every mapping disabled.
