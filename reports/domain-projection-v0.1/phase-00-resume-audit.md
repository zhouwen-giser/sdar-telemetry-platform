# Phase 0 — Resume audit and decision closure

## Baseline

- Branch/head: `feature/domain-projection-worker-v0.1` at
  `301189599a9cf63ee7b51ee594aa1714441dee9d`.
- Remote branch was fetched and matched the local head; no rebase, force-push or amend occurred.
- Draft PR: [#1](https://github.com/zhouwen-giser/sdar-telemetry-platform/pull/1).
- Runtime and Benchmark Server remote heads matched `SOURCE_LOCK.json` exactly.
- The adjacent Runtime execution checkout is `0da6075f2581279909efb69fc8e48cb01d95552c`;
  all 121 imported Evidence files are byte-identical to locked `main@2275bc5`, so only generated
  Git metadata changed while a99/eac and 100/95/5 remained unchanged.

## Changes

- Replaced the obsolete RC1-era root source lock with the signed handoff lock.
- Recorded the approved D1–D10 closure without authorizing a near-name alias.
- Captured a new live `readonly=2` ClickHouse schema snapshot.
- Reconstructed the locked RC2 `fresh_all.sql` in an isolated ClickHouse 25.3 local path and
  compared every SDAR object descriptor and every column descriptor with live ClickHouse 24.10.

## Commands actually run

- `python3 tools/verify_task_package.py`
- `sha256sum -c SHA256SUMS.txt` for the outer task package and nested RC2 package
- `git fetch --tags origin`
- `git ls-remote` for the locked Runtime and Benchmark Server refs
- `npm run build`
- `CLICKHOUSE_SCHEMA_SNAPSHOT_LABEL=domain-projection-rc2-preflight npm run clickhouse:snapshot`
- Read-only release/count queries through `ClickHouseClient` with `readonly=2`
- Seven supplied/required view analyses with `SELECT * ... LIMIT 0`
- Isolated `clickhouse local 25.3.14.14 --multiquery --queries-file fresh_all.sql`
- Full live/reference descriptor comparison

## Results

| Gate | Result |
| --- | --- |
| G01 task package/source lock/decision closure | PASS |
| G02 release and migration range | PASS — `1.5.1-rc.2`, `00..26` |
| G03 schema and descriptor hashes | PASS — exact locked values |
| G04 objects/columns/views | PASS — 472 objects, 15,949 columns, zero descriptor diff |

Repository regression also passed: typecheck, build, static verification, 83/83 tests, the
121-file Evidence lock (100/95/5 with unchanged a99/eac), the five-schema/21-fixture Domain
Projection contract verifier, JSON parsing, secret-signature scan and `git diff --check`.

All six databases are `Atomic`. The exact ten source tables, two Episode Seal tables, six
`sdar_embodied` targets, six governance tables and required readiness/handoff views exist.
All five governance tables altered by migration 23 contain every required v2 column. Seven
critical views compile at `LIMIT 0` and expose zero dotted output names.

The full descriptor comparison produced identical hashes:

- tables/engines/keys: `sha256:40ff8c3e8c162df6c9a5007859b4b4345253e66f087618b9359777dc9bfd2c49`;
- columns: `sha256:a0aa5014f4e26f1ec90166a38e5661ea3f457fb5e0acf7fc59ad9b58853987d8`.

## Evidence and limitations

Evidence lives under
[`reports/clickhouse/192.168.1.7-schema-snapshot/domain-projection-rc2-preflight`](../clickhouse/192.168.1.7-schema-snapshot/domain-projection-rc2-preflight/).
No ClickHouse DDL/DML was run remotely. Phase 0 is a real live metadata Preflight, not a Domain
Projection E2E; no source batch or projected target was fabricated.

## Commit / push

Phase 0 evidence commit `52502ae` (`docs(domain-projection): clear RC2 schema gate`) was pushed
to `origin/feature/domain-projection-worker-v0.1` and is visible in Draft PR #1.

## Next phase or exact blocker

The old Schema Compatibility Hard Stop is cleared. Phase 1 may synchronize the immutable RC2
contract into this repository. Every projection remains disabled and `active_projections=0`.
