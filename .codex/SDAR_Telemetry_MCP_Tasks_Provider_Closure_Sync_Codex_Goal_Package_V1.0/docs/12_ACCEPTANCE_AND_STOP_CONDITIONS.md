# 12 — Acceptance and Stop Conditions

## Completion requires

- source locks are current;
- Runtime authoritative binding fields are mapped without heuristic fill;
- SMPP additive semantics are consumed from frozen contract;
- one required binding cannot become ready without exact execution closure;
- uncertainty requires exact reconciliation;
- terminal axes are independent;
- goal/physical proof flags stay false;
- snapshot is deterministic and immutable;
- handoff v2 remains compatible;
- unit/contract/integration tests pass;
- no direct fact insertion or device action was used to manufacture success;
- Benchmark consumer qualification passes or is truthfully documented as an external blocker.

## Stop conditions

Block instead of guessing when:

- only hints can connect task to execution;
- multiple possible execution IDs exist without authoritative disambiguation;
- upstream contract drift changes payload semantics;
- schema drift invalidates selected source objects;
- v2 additive compatibility is impossible;
- required live dependencies are unavailable for a claimed live gate.

A blocked live gate does not invalidate passing unit/contract gates, but completion token remains forbidden.
