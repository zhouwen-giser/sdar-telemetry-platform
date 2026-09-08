# Source Lock Audit

Status: PASS — all producer and consumer inputs are pinned to exact 40-character commits.

## Target

- Repository: `zhouwen-giser/sdar-telemetry-platform`
- Branch: `codex/smpp-mcp-tasks-provider-closure-sync-v0.1`
- Base HEAD/tree: `3e43350dd0d0e37fe65ec318d0d9881820a88f5a` / `1d490722731ad03a66060bf1c53d02e5db07b19d`

## Upstreams

| role | exact ref | result |
|---|---|---|
| SMPP shared warehouse producer | `930ea86294a8d5ccaebffe1237437c5e44fac80d` | compatible descendant of package lock |
| SMPP Provider normal-path producer | `0c1b525d99718d058b1011cf96306d960fd2d326` | exact fixture producer; locked protocol files unchanged from `1e67e6e421d70a3cbce2d41bf5007e99463712fe` |
| Runtime Consumer Sync implementation | `b9a75e3990163e959d91c76d402fe94c8366f5e8` | exact committed implementation |
| Runtime machine-readable handoff | `2c3b0c4628ee09afe5e61559e8a7b9d14481b633` | exact source-import HEAD; imported roots clean |
| Benchmark consumer | `30a3aa2cfaafb48a1aa8da72d19f65bef3034d72` | descendant of minimum consumer baseline and live-qualified |

## Contract fingerprints

| contract | observed | result |
|---|---|---|
| ProviderOps envelope/catalog | `sdar.provider.ops.event/1.1.0`, `smpp.providerops-payload-catalog/v1.1`, 16 record types | unchanged; no local record invented |
| Runtime Evidence | `sdar.evidence/v1`, 105 records (100 Required, 5 Diagnostic), 126 imported files | exact committed import |
| Runtime canonical contract | `sha256:795352dc13cc98f153fb9c413e6830870570af75c92831e28102cabc76a6eefd` | verified |
| Runtime canonical registry | `sha256:7d00320ed21eb89e98abce8ebbdaa7e4aa887e97ee97888ae8e4b62c69adf197` | verified |
| Benchmark handoff | `sdar.telemetry-smpp-providerops-handoff/v2` | v2 preserved; v1 fallback disabled |

Decision: `T0_PASS_EXACT_COMMITTED_SDAR_HANDOFF`.
