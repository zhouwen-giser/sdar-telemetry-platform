# Codex Goal Increment — Integrate SMPP ProviderOps Telemetry into SDAR Telemetry and Benchmark Handoff

## Increment identity

```text
Parent goal:
SDAR Telemetry Domain Projection + Benchmark Handoff V1.0

Primary repository:
zhouwen-giser/sdar-telemetry-platform

Resume branch:
feature/domain-projection-worker-v0.1

Observed primary HEAD:
301189599a9cf63ee7b51ee594aa1714441dee9d

Companion repository:
zhouwen-giser/smpp-telemetry-platform

Observed SMPP main HEAD:
8f500c5743818c776a5f01cca65aa188c3869430

ClickHouse authority:
1.5.1-rc.2 / migrations 00..26

Increment completion marker:
SDAR_TELEMETRY_SMPP_PROVIDEROPS_INCREMENT_COMPLETE
```

## Mission

Add the previously omitted MCP Provider telemetry lane without rebuilding either telemetry platform:

```text
SMPP Provider Runtime
→ ProviderOpsEnvelope 1.1.0
→ smpp-telemetry-platform Collector / WAL / Normalizer
→ source-neutral Core Facts + N:N Relations
→ target-specific SDAR shared-warehouse projection
→ sdar_core.external_provider_fact
   + sdar_core.external_entity_relation_fact
→ SDAR Telemetry consumer/readiness/reconciliation API
→ frozen Benchmark consumer handoff
```

This package is an incremental overlay. Preserve and continue every valid parent-goal decision and artifact. Do not restart the full project from zero.

## Mandatory first actions

1. Read the parent Goal and every file in this increment.
2. Verify both repository SHAs, branches, PR state and dirty worktrees.
3. Verify the live ClickHouse release, schema/descriptor hashes, target columns and six SMPP views.
4. Audit `ProviderOpsEnvelope 1.1.0`, current source mappings, normalizer output, CoreProjection output and TargetWorker behavior.
5. Record the known structural fact: current `TargetWorker` applies only `tableMap[table]`, while `CoreProjectionV1` emits standalone `telemetry_core.*` rows. It cannot safely write those rows directly into the differently shaped SDAR external tables.
6. If any source lock or target contract differs, stop activation and produce a blocker report.

## Non-negotiable architecture

- SMPP ProviderOps source authority remains in SMPP Runtime/Telemetry.
- The required standalone SMPP target remains independent and required.
- The SDAR shared-warehouse target is initially optional/shadow and has an independent checkpoint.
- SDAR Telemetry does not duplicate OTLP ingestion, SMPP WAL or ProviderOps normalization.
- SDAR Telemetry does not poll the SMPP Query API as the primary durable path.
- The companion SMPP repository must implement a target-specific, typed SDAR row mapper when its current code cannot satisfy the exact target shape.
- Cross-system task/resource/provider binding is N:N and lives in `external_entity_relation_fact`.
- Provider terminal state cannot be promoted to Goal success or physical verification.
- Do not modify ClickHouse schema files in either telemetry repository. Raise a schema-delta blocker if 1.5.1-rc.2 is incompatible.
- Do not implement M1-M15, F1-F7, HG1-HG7, Baseline, Comparison or Release Gate in either telemetry repository.

## Required cross-repository execution

### Primary repository — sdar-telemetry-platform

Continue the existing branch and Draft PR. Add:

- exact consumer contract lock for `smpp.providerops/v1.1` and SDAR external targets;
- `SmppExternalFactSource` and `SmppRelationSource` read ports;
- schema/hash/release preflight;
- typed query and reconciliation services;
- per-episode MCP Provider telemetry assembly;
- provider telemetry readiness;
- Benchmark handoff package and verifier;
- metrics, docs, Compose/env wiring and E2E consumer tests.

### Companion repository — smpp-telemetry-platform

Inspect current main. If exact SDAR projection support is still absent, create:

```text
branch: feature/sdar-shared-warehouse-handoff-v0.1
Draft PR: base main
```

Implement only the required companion delta:

- Source Mapping v4 with explicit stable `smppSourceId`;
- versioned per-record-type ProviderOps payload catalog;
- `SdarSharedWarehouseProjectionV1` typed mapper;
- exact target preflight for `external_provider_fact` and `external_entity_relation_fact`;
- strict row mapping, URN parsing, N:N relation mapping and hash/identity checks;
- target-specific tests and Shadow target configuration;
- parity/restart/outage qualification.

Do not merge or tag either repository automatically.

## Data contract requirements

### ProviderOps record catalog

Support every record type in ProviderOpsEnvelope 1.1.0. Every accepted record produces one `external_provider_fact`. Specialized semantic fields are extracted only through a versioned payload contract. Unknown or schema-invalid semantic fields remain in payload/provenance or enter the target DLQ; they are never guessed.

### Stable source identity

Freeze `smppSourceId` as an explicit Source Mapping field. Identity must include:

```text
smppSourceId
sourceRecordId
sourceRecordHash
factId
factHash
projectionId
projectionVersion
```

Same identity + same hash is idempotent. Same identity + different hash is `SMPP_SOURCE_CONTENT_CONFLICT`.

### SDAR external provider mapping

Implement the exact field rules in `matrices/sdar-target-field-mapping.csv`. The mapper must populate required provenance, timing, source, provider, task/resource/execution and projection fields. Empty semantic fields are permitted only when the target contract permits them and the source record type does not promise them.

### Relations

Project every canonical relation into `external_entity_relation_fact` with:

- explicit `smpp_source_id` and environment;
- strict URN parser/version;
- source and target entity type/id;
- N:N validity interval;
- evidence facts, binding source and confidence class;
- source record identity/hash and projection provenance.

Never assert unique Provider↔Resource or SDAR Task↔SMPP Task ownership.

## SDAR Telemetry consumer APIs

Implement the delta endpoint set in `matrices/api-endpoint-delta.csv`, including:

```text
GET /v1/smpp/provider-facts
GET /v1/smpp/provider-facts/{factId}
GET /v1/smpp/relations
GET /v1/smpp/tasks/{externalTaskId}/timeline
GET /v1/smpp/resources/{resourceId}/state
GET /v1/smpp/resources/{resourceId}/health
GET /v1/smpp/executions/{externalExecutionId}/progress
GET /v1/smpp/reconciliation
GET /v1/episodes/{episodeId}/mcp-provider-telemetry
GET /v1/episodes/{episodeId}/mcp-provider-readiness
GET /v1/smpp/projection-status
```

All queries are allowlisted and parameter bound. No arbitrary SQL.

## Benchmark handoff

Generate an additive handoff at:

```text
integrations/sdar-benchmark-server/mcp-provider-telemetry/v1/
```

It must include:

- source/release hashes;
- provider fact and relation schemas/types;
- readiness contract;
- query examples;
- reason-code catalog;
- field-level Benchmark evidence mapping;
- fixtures for ready, degraded, not_ready and conflict;
- automated consumer-contract verifier.

Readiness states:

```text
not_required | not_ready | degraded | ready | conflict
```

Provider telemetry may support execution, receipt, dependency, recovery, idempotency and reconciliation evidence. It cannot alone prove physical verification or Goal completion.

## Delta phases

Execute S0-S10 from `matrices/phase-plan-delta.csv`:

```text
S0  Source locks and cross-repo audit
S1  Contract drift and payload-catalog freeze
S2  SMPP Source Mapping v4 and target preflight
S3  SMPP typed SDAR projection adapter
S4  SDAR consumer/readiness/reconciliation
S5  Query APIs and metrics
S6  Benchmark handoff package
S7  Shadow parity and failure isolation
S8  Cross-repo real E2E and restart/conflict tests
S9  Documentation, reports and PR updates
S10 Final delta qualification
```

After each phase: test, update machine-readable gate state, commit and push. Do not rewrite the parent history.

## Truthfulness and fail-closed rules

- A configured but disabled target is not an E2E pass.
- Table existence is not proof of compatible row mapping.
- `tableMap` success is not proof that semantic fields were transformed correctly.
- Mock/provider samples do not replace a real processor-to-SDAR target test.
- An empty reconciliation result is not healthy unless test data was inserted and expected.
- Provider `completed` is not SDAR Goal achieved.
- Missing relation coverage must produce degraded/not_ready, not zero-score Agent failure.
- If the companion PR is required but not merged/deployed, the primary integration remains blocked with an exact resume point.

## Final delta completion

All 28 delta gates in `matrices/acceptance-gates-delta.csv` must pass. Only then output:

```text
SDAR_TELEMETRY_SMPP_PROVIDEROPS_INCREMENT_COMPLETE
```

This marker does not authorize the parent completion marker unless every original parent gate also passes.
