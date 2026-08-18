# S0 — Source locks and cross-repository audit

- Observed at: `2026-08-18`
- Telemetry branch/HEAD: `feature/domain-projection-worker-v0.1@3fc8dea0adee9c4862ee2d3b79e97efb1b0cd738`
- Telemetry PR: `zhouwen-giser/sdar-telemetry-platform#1`, open Draft
- SMPP branch/HEAD: `main@8f500c5743818c776a5f01cca65aa188c3869430`
- ProviderOps schema blob: `dc4c8608249acb29c677b2ea9a4f11e47e7f66b1`
- Parent package SHA-256: `27d37f641477236409ab5bc9d6a8d203c9f89c25edfcfe96302d376ff984ed0e`

## Live ClickHouse preflight

The read-only preflight used the configured query credential with `readonly=2`.
It passed for ClickHouse `24.10.2.1`, release `1.5.1-rc.2`, migrations
`00..26`, 472 objects, 15,949 columns, and the frozen schema/descriptor hashes.
Both external target tables are covered by that complete descriptor lock. All
six SMPP views were additionally compiled with `LIMIT 0` (21, 12, 12, 12, 18,
and 22 columns respectively).

## Structural gap

The locked SMPP `TargetWorker` maps only the output table name with
`tableMap[sourceTable] ?? sourceTable`. `CoreProjectionV1` emits standalone
`telemetry_core.*` rows, whose fields differ from
`sdar_core.external_provider_fact` and
`sdar_core.external_entity_relation_fact`. A table-map-only configuration
therefore cannot satisfy the external row contract. The companion repository
must provide a typed SDAR target projection; Query API polling is not a durable
substitute.

## Baseline gates

- Telemetry `npm run verify`: 155 passed, 0 failed, 2 explicit Control PG skips.
- SMPP `npm run check`: 28 passed, 0 failed.
- No ClickHouse DDL or data was modified during S0.

