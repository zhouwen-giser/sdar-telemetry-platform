# 02 — Scope and Authority Boundary

## Ownership

Telemetry owns:

- ingestion durability;
- normalization;
- provider/task identity closure;
- lineage;
- data quality;
- readiness;
- immutable closure snapshots;
- Benchmark handoff.

Telemetry does not own:

- Runtime business Task state;
- Provider business state;
- Device state authority;
- Benchmark case rules;
- scoring;
- physical ground truth.

## Authority lattice

### Level A — Runtime Binding

`mcp_task.remote_binding` establishes the selected:

- Remote Task
- Provider Source
- Provider
- Provider Instance if frozen

Nothing else may replace it.

### Level B — Provider Internal Identity

Within the already selected Provider Task, a frozen ProviderOps payload or relation may establish:

- Provider Execution
- Device Mission if explicitly provided

This evidence is authoritative only for the Provider-internal edge.

### Level C — Hints

Origin IDs, trace IDs, correlation IDs and generic relation hints may explain/reconcile but never:

- add a Provider fact to the closure;
- switch Provider;
- switch Remote Task;
- resolve an ambiguity by heuristic.

## Consequence

`hintsUsedForAuthority=false` remains true even when a frozen provider-internal relation is used for `selected task -> execution`, because that relation is not used to select facts or override the Runtime binding. If the current contract defines `hintsUsedForAuthority` more broadly, do not reinterpret it silently; add a separately named field and document the semantics.
