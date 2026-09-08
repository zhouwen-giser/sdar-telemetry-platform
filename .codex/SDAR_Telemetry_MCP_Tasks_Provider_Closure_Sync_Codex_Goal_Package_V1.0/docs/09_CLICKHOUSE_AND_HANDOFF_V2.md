# 09 — ClickHouse and Benchmark Handoff v2

## Existing handoff

Keep `sdar.telemetry-smpp-providerops-handoff/v2` as the only formal Provider handoff and keep v1 fallback disabled.

## Existing formal checks remain mandatory

- expectedFactCount == selectedFactCount
- foreignFactCount == 0
- unresolvedBindingCount == 0
- truncated == false
- hasMore == false
- hintsUsedForAuthority == false
- status == ready

## Add semantic completeness

The handoff must also expose enough fields/detail to prove:

- exact Task→Execution closure;
- uncertainty/reconciliation;
- terminal axes;
- identity conflicts;
- optional Mission status.

## Schema evolution

Prefer additive fields and companion generic detail tables/views.

Do not rename the contract to v3 simply to add fields.

If a breaking contract change is unavoidable:

- stop;
- write a compatibility report;
- do not implement v3 without explicit approval.

## No UGV warehouse fork

No `ugv_*` Provider closure table. The model must remain reusable for other physical/device providers.
