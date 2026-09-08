# 06 — Dispatch Uncertainty and Reconciliation

## State model

Dispatch:

- certain
- uncertain
- recovered
- unresolved
- conflict

Reconciliation:

- not_required
- attempted
- found_exact
- not_found
- deferred
- unavailable
- conflict

## Required behavior

When Runtime records a mutating dispatch as uncertain:

- do not treat it as failed;
- do not assume no side effect;
- consume exact reconciliation evidence;
- if one original task/execution is recovered, status becomes `recovered`;
- if none can be proven, remain `unresolved`;
- if more than one candidate exists, `conflict`.

## Formal readiness

For an uncertain mutating dispatch:

`ready` requires exact reconciliation to the original Remote Task / Provider Execution.

`not_found`, `deferred`, `unavailable` remain not-ready unless a frozen authoritative protocol proves no dispatch occurred.

## UGV-MCP-003 proof obligations

The closure must make independently reviewable:

- uncertain dispatch happened;
- reconciliation was attempted;
- exactly one original remote task was recovered;
- exactly one provider execution exists;
- no duplicate physical/action identity was synthesized;
- terminal can continue on the original task;
- no blind retry inference is hidden in Telemetry.
