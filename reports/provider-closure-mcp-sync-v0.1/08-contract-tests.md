# T8/T9 Contract Test Evidence

Status: PASS (the final post-sync rerun is also recorded in `11-final-acceptance.md`)

Executed evidence so far:

| command | result |
|---|---|
| `npm run typecheck` | PASS |
| focused `provider-closure-v2.test.js` | 26/26 PASS |
| `npm test` with the 105-record SDAR contract import | 204 tests, 200 PASS, 4 configured integration skips, 0 FAIL |
| `SDAR_TEST_CONTROL_POSTGRES_URL=… npm run test:domain-projection-control` | 2/2 PASS against real PostgreSQL |
| `npm run check:sdar-clickhouse-contract` | PASS; 472 objects, 15,949 columns, 31 required objects, zero drift |
| `npm run clickhouse:smpp-preflight` | PASS; release 1.5.1-rc.2, 81 target columns, 97 view columns, readonly=2 |
| `npm run check:smpp-providerops-release` | PASS; 28/28 |
| `npm run check:smpp-benchmark-handoff` | PASS; v2, 8 byte-locked assets |
| `npm run check:smpp-benchmark-handoff:live` | PASS against shared ClickHouse |
| live Benchmark consumer qualification at `30a3aa2cfaafb48a1aa8da72d19f65bef3034d72` | PASS; two live handoffs |

Migration 015 remains byte-identical at
`dba7693c2ee3fe52bc4ea61182cce87244c6f83dbf2f5a94048da9fb9ed9740a`.
Migration 016 is additive and reviewed at
`bb55fff94bce66ec9e72d5a53dca8d338d4efeab48d4a9e05d9f606e14708ff4`.
