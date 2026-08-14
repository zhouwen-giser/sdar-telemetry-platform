# 04 — SDAR Evidence v1 Projection Coverage

Generated: 2026-08-14T06:46:48.071Z

## Result

| Assertion | Result | Meaning |
| --- | ---: | --- |
| Frozen registry recognized | **100/100** | All unique registry entries and their schema assets were found. |
| Canonical projection | **100/100** | Every Evidence v1 recordType was exercised through `canonicalProjection` and landed on `sdar_core.sdar_evidence_v1_record`. |
| Queryable by target code path | **100/100** | The Query API reads the same canonical table and can address every row by mandatory `record_id`. |
| Evaluation role `required` | **95/95** | No required recordType is dropped. |
| Evaluation role `diagnostic` | **5/5** | No diagnostic recordType is dropped. |
| Conditional specialized projection | **3/3** | Only the three lossless Node Control mappings listed below are eligible. |
| Canonical-only | **97/97** | Every other type remains queryable from canonical storage without a guessed specialized row. |
| Silent drop | **0** | Specialized ineligibility never removes the canonical row. |

This matrix is a static 100-type target-code assertion. Deployment and live write/read are separately evidenced: reader-pre-014 showed the target absent, reader-post-014 shows the reviewed 58-column table present, fixture run `codex_it_20260814T065452Z_710cb25d_e149888a` exercised replay, and real Runtime run `codex_it_20260814T065032Z_710cb25_e149888` reconciled 2,517 PostgreSQL-derived records with 2,517 Query rows. The real corpus contains 22 observed record types, so it proves the >=100-record path but not live occurrence of all 100 catalog types.

## Deployed/live evidence boundary

| Claim | Evidence | Status |
| --- | --- | --- |
| Target DDL exists on required external host | `reader-post-014/{tables,columns,show-create}.json` | PASS: 58-column `ReplacingMergeTree` |
| Canonical external insert/query works | fixture E2E evidence report | PASS for 2 `runtime.episode` records |
| Effective identity survives fresh-state replay | same report: 2 rows before/after, stable IDs/hashes/WAL lineage | PASS for fixture |
| Real Runtime source-to-query reconciliation | runtime E2E report: 2,517 PG and CH tuples share one exact hash | PASS |
| Real failed/canceled task projection | 7 failed + 5 canceled tasks; 63 task-linked records | PASS |
| Real completed task projection | completed task count is zero | **PENDING — E2E-03** |
| All 100 schemas validate in one generated corpus | `evidence-v1-full-registry.test.js` 3/3 | PASS local: 100/95/5 |
| All 100 types project to target code path | projection coverage JSON/CSV and 7/7 projection tests | PASS static |
| All 100 types observed in external ClickHouse | No such live corpus | **PENDING** |
| At least 100 real Runtime-derived records | 2,517 records, sequence `1..2517`, unique record/row IDs 2,517 | **PASS** |

## Routing policy

- `node_control.capability_revision` conditionally projects to `sdar_core.node_capability_version_fact`.
- `node_control.a2a_exposure` conditionally projects to `sdar_core.a2a_exposure_revision_fact`.
- `node_control.agent_card_revision` conditionally projects to `sdar_core.agent_card_revision_fact`.
- Conditional means the complete frozen payload and required tenant/project/node scope are present. If not, the canonical row remains and specialized output is empty.
- The 97 other types are canonical-only. In particular, `capability.*`, readiness, task binding, and task attempt payloads are not padded with invented values to satisfy older specialized DDL.
- Query coverage is generic rather than a 100-item SQL allowlist: `/v1/evidence/trace?recordId=...` filters the mandatory canonical `record_id`; task routes and the `episodeId` trace filter use lineage columns on the same table.

## Complete 100-type matrix

| # | recordType | family | evaluation | applicability | canonical | queryable | specialized | silent drop |
| ---: | --- | --- | --- | --- | :---: | :---: | --- | :---: |
| 1 | `runtime.episode` | runtime | required | required | yes | yes | canonical-only | no |
| 2 | `runtime.request` | runtime | required | required | yes | yes | canonical-only | no |
| 3 | `runtime.a2a_task` | runtime | required | conditional | yes | yes | canonical-only | no |
| 4 | `runtime.goal` | runtime | required | required | yes | yes | canonical-only | no |
| 5 | `runtime.goal_contract` | runtime | required | required | yes | yes | canonical-only | no |
| 6 | `runtime.goal_patch` | runtime | required | conditional | yes | yes | canonical-only | no |
| 7 | `runtime.plan` | runtime | required | required | yes | yes | canonical-only | no |
| 8 | `runtime.plan_step` | runtime | required | conditional | yes | yes | canonical-only | no |
| 9 | `runtime.state_transition` | runtime | required | conditional | yes | yes | canonical-only | no |
| 10 | `runtime.decision` | runtime | required | conditional | yes | yes | canonical-only | no |
| 11 | `runtime.policy_decision` | runtime | required | conditional | yes | yes | canonical-only | no |
| 12 | `runtime.execution_gate` | runtime | required | conditional | yes | yes | canonical-only | no |
| 13 | `runtime.human_confirmation` | runtime | required | conditional | yes | yes | canonical-only | no |
| 14 | `runtime.action` | runtime | required | conditional | yes | yes | canonical-only | no |
| 15 | `runtime.receipt` | runtime | required | conditional | yes | yes | canonical-only | no |
| 16 | `runtime.verification` | runtime | required | conditional | yes | yes | canonical-only | no |
| 17 | `runtime.outcome` | runtime | required | conditional | yes | yes | canonical-only | no |
| 18 | `runtime.run_seal` | runtime | required | conditional | yes | yes | canonical-only | no |
| 19 | `skill.usage_snapshot` | skill | required | conditional | yes | yes | canonical-only | no |
| 20 | `skill.candidate` | skill | required | conditional | yes | yes | canonical-only | no |
| 21 | `skill.applicability` | skill | required | conditional | yes | yes | canonical-only | no |
| 22 | `skill.context_resolution` | skill | required | conditional | yes | yes | canonical-only | no |
| 23 | `skill.selection` | skill | required | conditional | yes | yes | canonical-only | no |
| 24 | `skill.mode_selection` | skill | required | conditional | yes | yes | canonical-only | no |
| 25 | `skill.composition` | skill | required | conditional | yes | yes | canonical-only | no |
| 26 | `skill.composition_edge` | skill | required | conditional | yes | yes | canonical-only | no |
| 27 | `skill.capability_slot_resolution` | skill | required | conditional | yes | yes | canonical-only | no |
| 28 | `skill.procedure_compilation` | skill | required | conditional | yes | yes | canonical-only | no |
| 29 | `skill.plan_compliance` | skill | required | conditional | yes | yes | canonical-only | no |
| 30 | `skill.execution` | skill | required | conditional | yes | yes | canonical-only | no |
| 31 | `skill.execution_event` | skill | required | conditional | yes | yes | canonical-only | no |
| 32 | `skill.execution_reference` | skill | required | conditional | yes | yes | canonical-only | no |
| 33 | `skill.failure_propagation` | skill | required | conditional | yes | yes | canonical-only | no |
| 34 | `skill.evidence_requirement` | skill | required | conditional | yes | yes | canonical-only | no |
| 35 | `mcp_task.tool_call` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 36 | `mcp_task.availability` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 37 | `mcp_task.remote_binding` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 38 | `mcp_task.observation` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 39 | `mcp_task.control_event` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 40 | `mcp_task.poll_attempt` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 41 | `mcp_task.input_link` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 42 | `mcp_task.cancel` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 43 | `mcp_task.reconciliation` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 44 | `mcp_task.continuation_snapshot` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 45 | `mcp_task.continuation_attempt` | mcp_task | required | conditional | yes | yes | canonical-only | no |
| 46 | `capability.definition` | capability | required | conditional | yes | yes | canonical-only | no |
| 47 | `capability.implementation_binding` | capability | required | conditional | yes | yes | canonical-only | no |
| 48 | `capability.readiness` | capability | required | conditional | yes | yes | canonical-only | no |
| 49 | `capability.task_binding` | capability | required | conditional | yes | yes | canonical-only | no |
| 50 | `capability.execution_attempt` | capability | required | conditional | yes | yes | canonical-only | no |
| 51 | `capability.a2a_exposure` | capability | required | conditional | yes | yes | canonical-only | no |
| 52 | `capability.agent_card_revision` | capability | required | conditional | yes | yes | canonical-only | no |
| 53 | `experience.episode` | experience | required | conditional | yes | yes | canonical-only | no |
| 54 | `experience.trace` | experience | required | conditional | yes | yes | canonical-only | no |
| 55 | `experience.trace_event` | experience | required | conditional | yes | yes | canonical-only | no |
| 56 | `experience.activity` | experience | required | conditional | yes | yes | canonical-only | no |
| 57 | `experience.process_variant` | experience | required | conditional | yes | yes | canonical-only | no |
| 58 | `experience.workflow_pattern` | experience | required | conditional | yes | yes | canonical-only | no |
| 59 | `experience.workflow_pattern_dependency` | experience | required | conditional | yes | yes | canonical-only | no |
| 60 | `experience.recovery_pattern` | experience | required | conditional | yes | yes | canonical-only | no |
| 61 | `experience.planning_correction` | experience | required | conditional | yes | yes | canonical-only | no |
| 62 | `experience.interaction_episode` | experience | required | conditional | yes | yes | canonical-only | no |
| 63 | `replay.dataset` | replay | required | conditional | yes | yes | canonical-only | no |
| 64 | `replay.case` | replay | required | conditional | yes | yes | canonical-only | no |
| 65 | `replay.run` | replay | required | conditional | yes | yes | canonical-only | no |
| 66 | `replay.case_result` | replay | required | conditional | yes | yes | canonical-only | no |
| 67 | `replay.metric_result` | replay | required | conditional | yes | yes | canonical-only | no |
| 68 | `replay.counterexample` | replay | required | conditional | yes | yes | canonical-only | no |
| 69 | `artifact.lifecycle` | artifact | required | conditional | yes | yes | canonical-only | no |
| 70 | `artifact.validation` | artifact | required | conditional | yes | yes | canonical-only | no |
| 71 | `artifact.retrieval` | artifact | required | conditional | yes | yes | canonical-only | no |
| 72 | `artifact.usage` | artifact | required | conditional | yes | yes | canonical-only | no |
| 73 | `artifact.feedback` | artifact | required | conditional | yes | yes | canonical-only | no |
| 74 | `artifact.promotion` | artifact | required | conditional | yes | yes | canonical-only | no |
| 75 | `node_control.profile_revision` | node_control | required | conditional | yes | yes | canonical-only | no |
| 76 | `node_control.health_observation` | node_control | diagnostic | optional | yes | yes | canonical-only | no |
| 77 | `node_control.configuration_revision` | node_control | required | conditional | yes | yes | canonical-only | no |
| 78 | `node_control.configuration_apply_ack` | node_control | required | conditional | yes | yes | canonical-only | no |
| 79 | `node_control.configuration_lkg_transition` | node_control | required | conditional | yes | yes | canonical-only | no |
| 80 | `node_control.llm_provider_revision` | node_control | required | conditional | yes | yes | canonical-only | no |
| 81 | `node_control.model_route_revision` | node_control | required | conditional | yes | yes | canonical-only | no |
| 82 | `node_control.smpp_source_revision` | node_control | required | conditional | yes | yes | canonical-only | no |
| 83 | `node_control.mcp_provider_binding_revision` | node_control | required | conditional | yes | yes | canonical-only | no |
| 84 | `node_control.skill_governance` | node_control | required | conditional | yes | yes | canonical-only | no |
| 85 | `node_control.plan_template_governance` | node_control | required | conditional | yes | yes | canonical-only | no |
| 86 | `node_control.capability_revision` | node_control | required | conditional | yes | yes | conditional → `sdar_core.node_capability_version_fact` | no |
| 87 | `node_control.capability_readiness` | node_control | required | conditional | yes | yes | canonical-only | no |
| 88 | `node_control.a2a_exposure` | node_control | required | conditional | yes | yes | conditional → `sdar_core.a2a_exposure_revision_fact` | no |
| 89 | `node_control.agent_card_revision` | node_control | required | conditional | yes | yes | conditional → `sdar_core.agent_card_revision_fact` | no |
| 90 | `node_control.management_operation` | node_control | required | conditional | yes | yes | canonical-only | no |
| 91 | `node_control.audit_event` | node_control | required | conditional | yes | yes | canonical-only | no |
| 92 | `node_control.node_event` | node_control | required | conditional | yes | yes | canonical-only | no |
| 93 | `node_control.telemetry_configuration` | node_control | required | conditional | yes | yes | canonical-only | no |
| 94 | `node_control.telemetry_delivery` | node_control | required | conditional | yes | yes | canonical-only | no |
| 95 | `node_control.telemetry_ack` | node_control | required | conditional | yes | yes | canonical-only | no |
| 96 | `evidence.episode_manifest` | evidence | required | conditional | yes | yes | canonical-only | no |
| 97 | `evidence.quality_issue` | evidence | diagnostic | optional | yes | yes | canonical-only | no |
| 98 | `evidence.projection_issue` | evidence | diagnostic | optional | yes | yes | canonical-only | no |
| 99 | `evidence.source_checkpoint` | evidence | diagnostic | optional | yes | yes | canonical-only | no |
| 100 | `evidence.export_status` | evidence | diagnostic | optional | yes | yes | canonical-only | no |

## Machine-readable evidence

- `reports/sdar-integration/evidence/projection-coverage-100.json`
- `reports/sdar-integration/evidence/projection-coverage-100.csv`

Regenerate with:

```bash
npm run build
node dist/scripts/generate-projection-coverage-report.js
```
