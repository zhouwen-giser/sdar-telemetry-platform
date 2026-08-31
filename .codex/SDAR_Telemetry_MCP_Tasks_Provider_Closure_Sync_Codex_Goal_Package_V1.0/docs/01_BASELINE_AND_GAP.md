# 01 — Baseline and Gap Audit

## Observed baseline

At package generation, target `main` is `3e43350dd0d0e37fe65ec318d0d9881820a88f5a`.

Existing Provider Closure v2 already:

- selects facts using exact tenant/project/environment plus Remote Task/Provider tuple;
- treats origin/trace/relation hints as non-authoritative;
- publishes detail rows before manifest;
- pins `asOfProjectedAt`;
- retries source capture to detect drift;
- exposes `ready/not_ready/degraded/conflict/blocked_drift`;
- forces `goalSuccessProven=false` and `physicalSuccessProven=false`.

## Confirmed code-level gap

Current closure readiness marks a binding resolved when *any* selected Provider fact matches the binding. That is weaker than the required `Remote Task -> Provider Execution` closure.

Current ProviderClosureFact does not carry a typed Provider execution / uncertainty / reconciliation / business terminal semantic model.

Current external relation handling normalizes all relation rows as reconciliation hints; it therefore cannot distinguish an approved Provider-internal execution relation from a generic correlation hint.

## T0 deliverable

Produce a fresh audit with four columns:

`item, observed, required, unresolved`

At minimum inspect:

- ProviderOps payload catalog and mapper
- shared warehouse fact/relation field inventory
- actual Runtime `sdar.evidence/v1` registry
- `mcp_task.remote_binding` payload
- reconciliation evidence payload
- Provider business terminal payload
- provider execution identity source
- optional mission identity source
- Benchmark v2 consumer contract

If any required identity is only available through heuristic correlation, stop.
