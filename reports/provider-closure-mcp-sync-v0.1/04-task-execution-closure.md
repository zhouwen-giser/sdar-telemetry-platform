# T3 Exact Task to Execution Closure

Status: PASS

`mcp_task.remote_binding` remains the only selector for the Provider tuple
`tenant/project/environment + remoteTaskId + providerSourceId + providerId + providerInstanceId`.
After that tuple is selected, execution candidates may come only from the frozen ProviderOps
`external_execution_id`, an approved authoritative `task_execution_binding`, or the matching Runtime
`mcp_task.provider_execution_link`.

The deterministic result is:

- zero candidate execution IDs: `unresolved` and required closure is `not_ready`;
- one candidate execution ID: `exact`;
- more than one candidate, an explicit upstream conflict, or the same immutable identity with a
  different hash: `conflict`.

The Runtime companion link must repeat the exact Provider ID, SMPP Source, external Server / Provider
instance and remote Task. A mismatch is conflict evidence and cannot override the binding. Same-ID,
same-hash replay is idempotent. Generic hints, trace/correlation fields, timestamps, operation names and
resource IDs never select a Task or Execution.

Evidence: focused unit cases cover 0/1/>1, same-hash duplicate, different-hash conflict, Provider
instance mismatch and provider-internal relation isolation. Migration 016 stores one generic semantic
detail row per binding; no UGV-specific table was introduced.
