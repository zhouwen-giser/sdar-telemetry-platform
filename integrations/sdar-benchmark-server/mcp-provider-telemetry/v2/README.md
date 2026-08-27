# SDAR Episode Provider Evidence Closure v2

`sdar.telemetry-smpp-providerops-handoff/v2` is the only formal Provider handoff.
It starts from the exact tenant/project/environment/Episode `remote_task_binding`
set, pages every selected Provider fact at one `asOfProjectedAt`, and returns
origin claims and SMPP relations only as reconciliation material.

The contract has no v1 fallback. A Provider fact is selected only when its
remote task, Provider Source, Provider identity, environment, tenant, and
project match an authoritative binding. `origin*`, trace, correlation, and
relation hints never add facts or override bindings.

Every page is pinned to the `closure_snapshot_id` captured from the readiness
manifest. Detail rows are written first; the manifest is the only publication
marker, so a partially written snapshot is never a formal input.

Formal consumption requires equal expected/selected counts, zero foreign facts,
zero unresolved bindings, `truncated=false`, `hasMore=false`, and
`hintsUsedForAuthority=false`. Missing executable Benchmark rules or live input
remains a downstream blocker.
