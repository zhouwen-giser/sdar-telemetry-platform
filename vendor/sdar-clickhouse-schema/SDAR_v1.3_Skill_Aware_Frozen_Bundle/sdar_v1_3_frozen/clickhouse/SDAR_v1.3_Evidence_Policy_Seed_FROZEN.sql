-- SDAR v1.3 Skill-aware Evidence Policy Seed（冻结版）
-- 需在 sdar_meta.evidence_policy 建表后执行。

INSERT INTO sdar_meta.evidence_policy
(
    record_type,
    schema_name,
    schema_version,
    delivery_guarantee,
    evaluation_role,
    sampling_allowed,
    evidence_sequence_required,
    retention_class,
    target_table,
    max_payload_bytes,
    policy_version,
    effective_from
)
VALUES
("skill_usage_snapshot", "sdar.skill-usage-snapshot", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_usage_snapshot", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_candidate_record", "sdar.skill-candidate-record", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_candidate_record", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_applicability_record", "sdar.skill-applicability-record", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_applicability_record", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_context_resolution", "sdar.skill-context-resolution", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_context_resolution", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_selection_record", "sdar.skill-selection-record", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_selection_record", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_mode_selection", "sdar.skill-mode-selection", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_mode_selection", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_composition_record", "sdar.skill-composition-record", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_composition_record", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_composition_edge", "sdar.skill-composition-edge", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_composition_edge", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_capability_slot_resolution", "sdar.skill-capability-slot-resolution", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_capability_slot_resolution", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_interpretation_record", "sdar.skill-interpretation-record", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_interpretation_record", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_procedure_compilation", "sdar.skill-procedure-compilation", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_procedure_compilation", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_plan_compliance", "sdar.skill-plan-compliance", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_plan_compliance", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_execution_record", "sdar.skill-execution-record", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_execution_record", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_execution_relation", "sdar.skill-execution-relation", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_execution_relation", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_failure_propagation", "sdar.skill-failure-propagation", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_failure_propagation", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_evidence_requirement", "sdar.skill-evidence-requirement", 1, "transactional", "required", 0, 1, "audit", "sdar_core.skill_evidence_requirement", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("skill_patch_candidate", "sdar.skill-patch-candidate", 1, "transactional", "supporting", 0, 1, "standard", "sdar_core.skill_patch_candidate", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z')),
("evaluation_readiness", "sdar.evaluation-readiness", 1, "transactional", "required", 0, 1, "audit", "sdar_core.evaluation_readiness", 1048576, 1, parseDateTime64BestEffort('2026-07-17T00:00:00Z'));
