# T4 Dispatch Uncertainty and Reconciliation

Status: PASS

Runtime `mcp_task.admission` joins an immutable intent to the selected binding.
`mcp_task.dispatch_uncertain` makes uncertainty first-class and preserves `redispatchAllowed=false`.
`mcp_task.dispatch_reconciliation` maps exact upstream states without inference:

| upstream | normalized | dispatch |
|---|---|---|
| no uncertainty | `not_required` | `certain` |
| uncertain, no result | `not_required` | `uncertain` |
| `found_exact`, identity validated, same selected execution | `found_exact` | `recovered` |
| `not_found` | `not_found` | `unresolved` |
| `deferred` | `deferred` | `unresolved` |
| `unavailable` | `unavailable` | `unresolved` |
| conflict, multiple recovered IDs, or recovered ID mismatch | `conflict` | `conflict` |

The two Canonical Evidence rows for uncertainty and reconciliation legitimately share the same
Runtime attempt source ID; identity is namespaced by `recordType + sourceRecordId`, so that pair is not
a false collision. No state is converted into permission for a second dispatch.
