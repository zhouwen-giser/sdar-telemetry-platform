# T5/T6 Four-axis Terminal and Readiness

Status: PASS

The closure publishes four independent axes:

1. MCP Task control state from Runtime `mcp_task.control_event` (Provider terminal is only a fallback
   observation when Runtime control evidence is absent);
2. dispatch/transport certainty from uncertainty and reconciliation;
3. Provider execution state from ProviderOps business-terminal semantics;
4. Provider business outcome from the independent ProviderOps business status.

Required Task→Execution unresolved is `not_ready`; execution/reconciliation/terminal contradictions are
`conflict`. Optional Mission `unresolved` remains phase-one ready, while Mission conflict is still
fail-closed. Existing foreign-fact, truncation, capture-drift and hint-authority gates remain intact.

Both `goalSuccessProven` and `physicalSuccessProven` are hard-coded false in every closure and the
Benchmark consumer contract. A Provider success, ACK, projection success or fresh `projectedAt` cannot
promote either flag.
