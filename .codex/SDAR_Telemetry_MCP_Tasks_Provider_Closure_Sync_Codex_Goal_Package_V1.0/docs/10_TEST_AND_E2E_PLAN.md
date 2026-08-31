# 10 — Test and E2E Plan

## Unit fixture matrix

Required positive fixtures:

- one binding + one execution -> exact
- certain dispatch + terminal failure -> ready but business failed
- uncertain + found_exact -> recovered
- late evidence -> new snapshot
- same input -> same snapshot hash

Required negative fixtures:

- no execution -> not_ready
- two execution IDs -> conflict
- provider instance mismatch -> foreign/conflict
- uncertain + not_found -> not_ready
- uncertain + unavailable -> not_ready
- conflicting terminal outcomes -> conflict
- hint-only task association -> not_ready
- provider success with no physical evidence -> physicalSuccessProven=false
- same ID/different hash -> conflict
- source drift during capture -> blocked_drift
- details written / manifest absent -> not formally visible

## Cross-component E2E

Preferred:

Provider Producer fixture
-> smpp-telemetry Collector/Processor
-> shared ClickHouse facts/relations
-> sdar-telemetry closure worker
-> Provider Closure v2 snapshot
-> Benchmark consumer verification

This proves the normal data path.

## Truth labels

Use:

- `contract-e2e`
- `live-provider-e2e`
- `live-ugv-e2e`

only according to what actually ran.

A fixture through the real processor is not a real UGV run.

## Device safety

This task may observe pre-existing live evidence but must not invoke navigation, fire, e-stop, or other device control.
