# Codex Goal — Complete SDAR Telemetry Domain Projection and Benchmark Handoff

## Goal identity

```text
Repository: zhouwen-giser/sdar-telemetry-platform
Resume branch: feature/domain-projection-worker-v0.1
Observed resume HEAD: 301189599a9cf63ee7b51ee594aa1714441dee9d
Existing Draft PR: #1
Target Telemetry release candidate: 1.1.0-rc.1
Required ClickHouse authority: 1.5.1-rc.2 / migrations 00..26
Completion marker: SDAR_TELEMETRY_DOMAIN_PROJECTION_BENCHMARK_HANDOFF_GOAL_COMPLETE
```

## Mission

Continue the existing Domain Projection work from Phase 1 and autonomously complete the missing implementation. The result must provide a reliable path:

```text
Commander / NPC producer
→ sdar.domain-source/v1 durable Gateway + WAL
→ exact 10 Domain Source Contract tables + 2 Episode Seal tables
→ checkpointed deterministic Domain Projection Worker
→ sdar_embodied standardized facts
→ sdar_meta checkpoint / lineage / DLQ / readiness
→ stable handoff consumed by sdar-benchmark-server
```

Do not rebuild the existing `sdar.evidence/v1` path. Preserve it and prove it has no regression.

## First actions — mandatory

1. Read every file in this task package, including `SOURCE_LOCK.json`, `DECISIONS.json`, all docs, matrices and references.
2. Inspect the repository, `AGENTS.md` if one exists at execution time, current branch, current PR, dirty worktree and remote heads.
3. Continue the existing branch and Draft PR when they still exist. Do not create a parallel implementation branch merely to avoid the current history.
4. Re-run the current repository gates before changing code.
5. Connect to the rebuilt ClickHouse using the repository environment variables and perform the exact preflight in `docs/03_CLICKHOUSE_1_5_1_RC2_PREFLIGHT.md`.
6. If the live release or hashes differ from the source lock, stop mapper/writer activation, produce a blocker report, and do not silently adapt to near-name objects.

## Non-negotiable architecture

- SDAR Runtime PostgreSQL remains execution authority.
- Existing Telemetry Gateway/WAL remains the only durable ingestion substrate.
- ClickHouse remains fact, projection-governance and analytical storage; it is not a workflow engine or lease authority.
- Domain Projection stays in `sdar-telemetry-platform` and extends the existing Projection Registry; do not create another projection platform.
- Domain Worker is not the WAL-dependent `TelemetryWorker`; it is a separate process role.
- No Kafka, Redis requirement, arbitrary scripts, dynamic SQL mappers, LLM mappers or Benchmark scoring logic.
- Never write `sdar_mart.evaluation_*` or implement M1–M15, F1–F7, HG1–HG7, Baseline or Comparison here.
- Existing auth/secret behavior is preserved; this goal does not redesign it.

## Compatibility decisions now in force

The old packet was intentionally non-authorizing. It stated that it did not authorize near-name selection, migrations, ClickHouse writes or Worker start. That restriction remains historically correct, but the rebuilt ClickHouse now supplies the exact source contracts. The implementation may resume only after live preflight verifies them.

- D1: exact 10 source tables and 2 seals are authoritative; legacy near-name tables remain non-authoritative.
- D2: ten independent projection IDs.
- D3: exact `1.5.1-rc.2` hashes are the schema authority.
- D4: durable Domain Source ingestion is added through the existing Gateway/WAL.
- D5: bounded lookback + identity/hash dedup + fail-closed conflicts.
- D6: all projections remain disabled by default and after qualification.
- D7: Benchmark receives readiness/fact/lineage contracts, not scores.

## Required implementation

### A. Close stale repository state

Update the stale `SOURCE_LOCK.json`, `WORK_COMPLETION_REPORT.md`, ExecPlan, README, PR body and machine-readable reports. Preserve historical evidence; do not rewrite old reports to pretend their earlier observations were wrong.

### B. Synchronize the ClickHouse contract

Create a checked, reproducible integration snapshot under:

```text
integrations/sdar-clickhouse/1.5.1-rc.2/
```

It must lock release hashes, 10 source tables, 2 seals, 10 projections, 4 sets, 6 targets, governance columns and Benchmark-facing views. Generate the snapshot from live read-only metadata and compare it with the supplied RC2 package.

### C. Implement `sdar.domain-source/v1`

Add strict JSON Schema/TypeScript contracts and Golden fixtures for:

- ten exact source record types;
- Commander and NPC Episode Seals;
- batch request and durable acknowledgement;
- producer identity/version;
- canonical source identity, cursor and content hash.

Extend the existing Gateway/WAL boundary with:

```http
POST /v1/domain-source/batches
POST /v1/domain-source/episode-seals
```

ACK only after WAL fsync. Same source identity + same hash is duplicate; same identity + different hash is conflict.

### D. Route Domain Source WAL records

Extend the existing Telemetry worker/projection path to write exact contract rows to the 10 source tables and 2 seal tables. Use a strict allowlist and bound insert values. Do not accept arbitrary table names.

### E. Build the Domain Worker

Create:

```text
apps/domain-projection-worker
```

and the minimal additive packages/ports required for:

- projection definition loading;
- per-projection lease;
- checkpointed source reading;
- bounded lookback;
- deterministic mapper decision `produce | skip | fail`;
- target validation;
- idempotent target write;
- lineage and DLQ;
- replay/reconciliation;
- schema drift detection;
- health and readiness.

### F. Implement all ten mappings

Implement DP-C01..DP-C05 and DP-N01..DP-N05 only against exact source tables. Use the field and payload contracts in this package. A source record that cannot satisfy the approved mapping must be skipped with a registered reason or written to DLQ; never invent device, resource channel, physical success, observation time or approval linkage.

### G. Benchmark handoff

Generate a frozen handoff under:

```text
integrations/sdar-benchmark-server/domain-projection/v1/
```

It must include release locks, projection-set catalog, reason codes, readiness semantics, queries, TypeScript/JSON examples and an automated consumer-contract verifier. Benchmark must be able to distinguish:

```text
not_required | not_ready | degraded | ready | blocked_drift
```

General profiles are not blocked by Domain Projection. Domain formal profiles require `ready`.

### H. APIs and operations

Extend Query/Admin without arbitrary SQL. Provide the endpoints in `matrices/api-endpoint-matrix.csv`. Add Compose wiring and environment variables. Default safety cap is shadow; production target writes require explicit Admin action plus matching definition/release hashes.

## Git discipline

- No force-push, rebase, amend or history rewrite.
- Commit and push after each phase with a focused message.
- Update the existing Draft PR after each major phase.
- Do not merge or tag automatically.
- Convert the PR from Draft only when every required gate is truly passed.

## Testing truthfulness

- Fixtures, mocks and fake adapters do not count as real ClickHouse E2E.
- A successful static check does not count as live schema compatibility.
- A source table existing does not prove a producer is live.
- Do not claim Benchmark handoff passed until the consumer-contract queries run against the actual rebuilt database.
- Leave a gate blocked with a precise resume point when an external producer or Benchmark deployment is unavailable.

## Final completion requirements

All acceptance gates in `matrices/acceptance-gates.csv` must pass. The final state must include:

- 10/10 source writer paths;
- 10/10 deterministic mappers;
- target/lineage/checkpoint/DLQ closure;
- crash/replay/late-arrival/conflict/drift tests;
- real ClickHouse 24.10.2.1 E2E;
- Benchmark handoff verification;
- existing Evidence v1 regression pass;
- updated docs, source locks, SBOM/manifest as applicable;
- pushed commits and updated PR.

Only then output:

```text
SDAR_TELEMETRY_DOMAIN_PROJECTION_BENCHMARK_HANDOFF_GOAL_COMPLETE
```
