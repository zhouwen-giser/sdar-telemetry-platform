# 04 — SMPP ProviderOps Consumer Sync

## Frozen expectation

Current upstream sync work declares ProviderOps `sdar.provider.ops.event` v1.1.0, payload catalog v1.1, 16 record types, with additive payload semantics.

T0 must verify this remains true.

## Required semantic families

Map exact upstream contract fields into typed normalized semantics for:

- task identity closure
- idempotency identity
- dispatch uncertainty
- reconciliation
- provider execution
- provider business terminal
- optional mission relation

## Rules

1. No new ProviderOps record type unless upstream contract itself changes.
2. No free-text parsing.
3. No nearest-time matching.
4. No `resourceId + operationName` matching.
5. No trace/correlation authority.
6. Preserve sourceRecordId/sourceRecordHash/factId/factHash.
7. Verify deterministic identity and reject same-id/different-hash.
8. Preserve producer semantic version/hash in provenance.

## Shared warehouse

Read only from approved shared warehouse objects, normally:

- `sdar_core.external_provider_fact`
- `sdar_core.external_entity_relation_fact`

Do not read SMPP private tables.
