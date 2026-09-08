# 07 — Four-axis Terminal and Readiness

## Axes

### Axis 1 — MCP Task Control State

Examples: waiting_external / input_required / completed / failed / cancelled.

Source: Runtime canonical authoritative control evidence.

### Axis 2 — Dispatch / Transport Certainty

Examples: certain / uncertain / recovered / unresolved / conflict.

Source: Runtime dispatch semantics plus exact reconciliation evidence.

### Axis 3 — Provider Execution State

Examples: created / running / terminal_succeeded / terminal_failed / cancelled / unknown.

Source: selected Provider task facts.

### Axis 4 — Provider Business Outcome

Examples: succeeded / failed / cancelled / rejected / unknown.

Source: Provider business terminal facts.

## Prohibited fifth axis

Do not derive:

- Goal achieved
- physical arrival
- physical success

Keep both exported proof flags false.

## Readiness principle

`ready` means Provider evidence closure is structurally complete enough for a downstream evaluator to decide. It does not mean the Provider succeeded.

A complete failure episode can be `ready`.

An incomplete success-looking episode must be `not_ready`.
