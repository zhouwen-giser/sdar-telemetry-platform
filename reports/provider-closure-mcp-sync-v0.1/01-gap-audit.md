# T0 Gap Audit

Status: PASS — gaps identified; implementation tracks the pinned live Runtime payloads.

| item | observed | required | unresolved |
|---|---|---|---|
| Target Provider Closure v2 | Baseline resolved a Binding from any matching Provider fact and omitted execution/task semantics | exact selected Task→Execution closure, uncertainty/reconciliation, four axes | implemented and qualified |
| ProviderOps catalog | schema 1.1.0, 16 record types, payload catalog v1.1 | additive semantics; no new record family | none |
| Provider execution authority | `external_execution_id` plus `task_execution_binding`; only committed runtime or identity-validated found reconciliation creates it | 0/1/>1 exact closure after Runtime binding selection | implemented; complete tuple isolation and conflicts tested |
| Dispatch uncertainty | `provider.recovery.lifecycle`, `runtimeSemantic.uncertainty`, committed PostgreSQL authority | uncertain is first-class and never automatically failed | implemented from Provider and Canonical Runtime Evidence |
| Reconciliation | statuses `found`, `not_found`, `conflict`, `transient_unavailable`, `deferred`; found requires `identityValidated=true` | found_exact/recovered vs unresolved/conflict | implemented; recovered Task and Runtime instance must repeat binding authority |
| Provider terminal | `provider.task.lifecycle.runtimeSemantic.businessTerminal` contains MCP/transport/execution/business axes | preserve four independent axes | implemented and published as independent columns |
| Mission identity | exact `execution_mission_binding` and mission semantic only when Provider supplies ID | optional exact/unresolved/conflict, no synthesis | implemented; unresolved is non-blocking in phase one |
| Shared Provider fact fields | exact scope/source/provider/instance/task/execution, payload/provenance JSON, occurred/observed/received/normalized/projected times, source hashes | typed normalization with provenance and time separation | reader preserves execution, typed payload semantics and distinct observedAt |
| Shared relation fields | exact source/target entity types and IDs, binding source, confidence class, fact IDs and source hash | distinguish provider-internal authority from origin hints | approved Provider-internal relations close only the preselected Task; other hints remain non-authoritative |
| Runtime binding | immutable provider authority exposes source/provider, `externalServerId`, `runtimeServerId`, and the envelope Task ID | populate only fields actually frozen by Runtime | mapped exactly; no invocation ID fabrication |
| Runtime reconciliation/control | new `dispatch_uncertain`, `dispatch_reconciliation`, and `provider_execution_link` payloads plus existing `control_event` | exact uncertain/reconcile/control semantics | payloads pinned and mapped |
| Snapshot | as-of capture, drift retry, detail-first/manifest-last exist | same input/asOf/contracts = same hash; late data creates new snapshot | add semantic inputs and regression coverage |
| Benchmark consumer | current v2 contract checks ready, counts, foreign, unresolved bindings, truncation and hints | additive semantic counts and fail-closed exact closure | current consumer must remain source-compatible |
| Live ClickHouse endpoint | production remains pinned to `192.168.1.7`; qualification may explicitly select the exact loopback endpoint | retain fail-closed host pinning while allowing an explicitly configured exact local qualification host | implemented; shared warehouse preflight and live handoff passed |

## Shared warehouse field inventory

`sdar_core.external_provider_fact` supplies the required generic fields: `external_task_id`, `external_execution_id`, `provider_id`, `provider_instance_id`, `smpp_source_id`, `payload_json`, `provenance_json`, `entity_refs_json`, `fact_id/hash`, `source_record_id/hash`, and distinct `occurred_at`, `observed_at`, `received_at`, `normalized_at`, `projected_at`.

`sdar_core.external_entity_relation_fact` supplies `relation_type`, exact source/target entity types and IDs, `binding_source`, `confidence_class`, `evidence_fact_ids`, source record identity/hash, and projection identity/version.

## Authority conclusion

No heuristic is required. Runtime selection authority remains `mcp_task.remote_binding`; the Runtime companion link and provider-internal relations may only close the already-selected complete Provider tuple. The 105-record Runtime contract, including the five additive Consumer Sync record types, is byte-locked by the final imported snapshot.
