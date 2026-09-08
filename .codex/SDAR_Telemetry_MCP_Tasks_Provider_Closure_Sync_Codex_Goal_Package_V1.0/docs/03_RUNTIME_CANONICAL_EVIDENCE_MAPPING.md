# 03 — Runtime Canonical Evidence Mapping

## Required audit

Read the execution-time `sdar.evidence/v1` registry and exact record schemas.

Do not assume that this package's suggested record types or field names are current.

## Minimum semantic needs

Telemetry needs evidence sufficient to identify:

- RemoteTaskBinding and its immutable Provider authority snapshot;
- dispatch attempt / tool invocation identity;
- dispatch outcome certainty;
- reconciliation attempt + result;
- continuation attempt/application;
- terminal control event;
- Runtime receipt / verification / outcome boundaries.

## Existing reader deficiency to inspect

`canonicalBinding()` currently materializes:

- bindingId
- a2aTaskId
- remoteTaskId
- providerOriginSourceId
- externalProviderId
- revision
- status
- updatedAt

while its interface already allows:

- externalProviderInstanceId
- authoritativeOriginRuntimeIds
- authoritativeOriginTaskIds
- authoritativeOriginInvocationIds

If upstream binding evidence contains these authoritative fields, populate them from the immutable binding payload and validate hashes. If it does not, keep them absent and mark downstream reconciliation unverifiable; never fill them from Provider hints.

## Time

Record:

- occurred/recorded time for control events
- observedAt for state observations where present
- projectedAt separately

No freshness conversion from projectedAt.
