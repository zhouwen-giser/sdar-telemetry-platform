# T11 Benchmark Consumer Qualification

Status: PASS

The handoff remains `sdar.telemetry-smpp-providerops-handoff/v2`; v1 fallback is false. The v2 consumer
formal gate now additionally requires zero unresolved/conflicting Task→Execution, zero unresolved
reconciliation, zero terminal conflict and zero immutable-identity conflict.

Focused consumer tests prove:

- an exact ready snapshot is accepted;
- `not_ready` with unresolved execution is rejected;
- conflict with multiple execution candidates is rejected;
- unresolved reconciliation is rejected.

The byte-lock verifier passed for all eight v2 assets. Its live mode verified all six manifest-gated
views and one exact ready snapshot on the shared ClickHouse using `readonly=2`. Benchmark source ref
`30a3aa2cfaafb48a1aa8da72d19f65bef3034d72` is a descendant of the minimum baseline; the combined
qualification passed both Domain and Provider live handoffs.
