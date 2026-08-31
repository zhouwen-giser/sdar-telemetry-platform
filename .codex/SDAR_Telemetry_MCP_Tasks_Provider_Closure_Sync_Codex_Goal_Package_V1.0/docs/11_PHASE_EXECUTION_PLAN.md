# 11 — Phase Execution Plan

## T0 Source Lock and Gap Audit
No code changes.

## T1 ProviderOps Semantic Intake
Add typed parser/normalizer and contract fixtures.

## T2 Runtime Evidence Intake
Extend canonical evidence reading only for exact authoritative semantics required by closure.

## T3 Task→Execution Closure
Implement generic exact identity closure.

## T4 Uncertainty / Reconciliation
Implement deterministic uncertainty and recovery state machine.

## T5 Four-axis Terminal
Compute four independent axes.

## T6 Readiness Hardening
Integrate required semantic completeness into existing status.

## T7 Persistence / Publication
Add additive generic warehouse detail only if needed; preserve manifest-last.

## T8 Handoff v2 Compatibility
Update handoff manifest/types/queries/verify scripts additively.

## T9 Tests / Replay / Crash
Prove idempotency, drift, crash, late data and hash stability.

## T10 Normal-path E2E
Run producer-to-consumer normal path without direct target inserts.

## T11 Benchmark Consumer
Validate downstream exact snapshot consumption and fail-closed behavior.

## T12 Acceptance
Generate all reports and hashes, then decide PASS/PARTIAL/BLOCKED/FAILED.
