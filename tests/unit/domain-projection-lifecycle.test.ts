import assert from "node:assert/strict";
import test from "node:test";

import {
  DOMAIN_PROJECTION_SET_DEFINITIONS,
  domainProjectionMaxModeFromEnv,
  evaluateDomainProjectionSetReadiness,
  transitionDomainProjectionLifecycle,
  type DomainProjectionActivationGuard,
  type DomainProjectionLifecycle,
  type DomainProjectionReadinessMember,
} from "../../packages/telemetry-projection-registry/src/lifecycle.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("lifecycle follows the frozen transition graph with revision/action idempotency", () => {
  assert.equal(domainProjectionMaxModeFromEnv(undefined), "shadow");
  assert.equal(domainProjectionMaxModeFromEnv("active"), "active");
  assert.throws(
    () => domainProjectionMaxModeFromEnv("production"),
    (error: unknown) => hasCode(error, "PROJECTION_MODE_CAP_INVALID"),
  );
  let state = initialLifecycle();
  const guard = activationGuard("active");
  state = transitionDomainProjectionLifecycle(
    state,
    { actionId: "approve-1", expectedRevision: 0, action: "approve_definition" },
    guard,
  );
  assert.equal(state.state, "APPROVED_DISABLED");
  state = transitionDomainProjectionLifecycle(
    state,
    { actionId: "shadow-1", expectedRevision: 1, action: "set_shadow" },
    guard,
  );
  state = transitionDomainProjectionLifecycle(
    state,
    { actionId: "dry-1", expectedRevision: 2, action: "set_dry_run" },
    guard,
  );
  state = transitionDomainProjectionLifecycle(
    state,
    { actionId: "active-1", expectedRevision: 3, action: "set_active" },
    guard,
  );
  assert.equal(state.state, "ACTIVE");
  assert.equal(state.revision, 4);
  const duplicate = transitionDomainProjectionLifecycle(
    state,
    { actionId: "active-1", expectedRevision: 3, action: "set_active" },
    guard,
  );
  assert.equal(duplicate, state);
  assert.throws(
    () => transitionDomainProjectionLifecycle(
      state,
      { actionId: "active-1", expectedRevision: 4, action: "suspend" },
      guard,
    ),
    (error: unknown) => hasCode(error, "PROJECTION_ACTION_ID_CONFLICT"),
  );

  state = transitionDomainProjectionLifecycle(
    state,
    { actionId: "suspend-1", expectedRevision: 4, action: "suspend" },
    guard,
  );
  state = transitionDomainProjectionLifecycle(
    state,
    { actionId: "resume-1", expectedRevision: 5, action: "resume" },
    guard,
  );
  assert.equal(state.state, "SHADOW_READ_ONLY", "resume must return through the safe shadow lane");
});

test("default shadow cap, stale revisions, skipped transitions and hash drift fail closed", () => {
  const initial = initialLifecycle();
  const shadow = transitionDomainProjectionLifecycle(
    initial,
    { actionId: "approve-2", expectedRevision: 0, action: "approve_definition" },
    activationGuard("shadow"),
  );
  const shadowMode = transitionDomainProjectionLifecycle(
    shadow,
    { actionId: "shadow-2", expectedRevision: 1, action: "set_shadow" },
    activationGuard("shadow"),
  );
  assert.equal(shadowMode.state, "SHADOW_READ_ONLY");
  assert.throws(
    () => transitionDomainProjectionLifecycle(
      shadowMode,
      { actionId: "dry-2", expectedRevision: 2, action: "set_dry_run" },
      activationGuard("shadow"),
    ),
    (error: unknown) => hasCode(error, "PROJECTION_MODE_CAP_EXCEEDED"),
  );
  assert.throws(
    () => transitionDomainProjectionLifecycle(
      shadowMode,
      { actionId: "stale", expectedRevision: 1, action: "set_dry_run" },
      activationGuard("active"),
    ),
    (error: unknown) => hasCode(error, "PROJECTION_REVISION_CONFLICT"),
  );
  assert.throws(
    () => transitionDomainProjectionLifecycle(
      shadow,
      { actionId: "skip", expectedRevision: 1, action: "set_active" },
      activationGuard("active"),
    ),
    (error: unknown) => hasCode(error, "PROJECTION_TRANSITION_FORBIDDEN"),
  );
  assert.throws(
    () => transitionDomainProjectionLifecycle(
      initial,
      { actionId: "hash", expectedRevision: 0, action: "approve_definition" },
      { ...activationGuard("shadow"), actualSchemaHash: HASH_A },
    ),
    (error: unknown) => hasCode(error, "PROJECTION_ACTIVATION_HASH_MISMATCH"),
  );
});

test("observed drift blocks every operational mode and recovery returns disabled", () => {
  const approved = transitionDomainProjectionLifecycle(
    initialLifecycle(),
    { actionId: "approve-3", expectedRevision: 0, action: "approve_definition" },
    activationGuard("shadow"),
  );
  const blocked = transitionDomainProjectionLifecycle(
    approved,
    { actionId: "drift-3", expectedRevision: 1, action: "block_drift" },
    { ...activationGuard("shadow"), schemaDrift: true },
  );
  assert.equal(blocked.state, "BLOCKED_DRIFT");
  const recovered = transitionDomainProjectionLifecycle(
    blocked,
    { actionId: "resume-3", expectedRevision: 2, action: "resume" },
    activationGuard("shadow"),
  );
  assert.equal(recovered.state, "APPROVED_DISABLED");
});

test("four frozen sets have exact independent membership and locked hashes", () => {
  assert.deepEqual(
    DOMAIN_PROJECTION_SET_DEFINITIONS.map((definition) => [
      definition.setId,
      definition.version,
      definition.members.length,
    ]),
    [
      ["commander-standard", "1", 5],
      ["npc-standard", "1", 5],
      ["embodied-standard", "1", 10],
      ["embodied-diagnostic", "0.1", 4],
    ],
  );
  assert.equal(
    new Set(DOMAIN_PROJECTION_SET_DEFINITIONS.map((definition) => definition.contentHash)).size,
    4,
  );
});

test("empty and disabled required sets never report ready", () => {
  const definition = set("commander-standard");
  const empty = evaluateDomainProjectionSetReadiness({
    definition,
    members: [],
    formalDomainRequired: true,
  });
  assert.equal(empty.status, "not_ready");
  assert.deepEqual(empty.reasonCodes, ["PROJECTION_MEMBER_MISSING"]);

  const disabled = evaluateDomainProjectionSetReadiness({
    definition,
    members: definition.members.map((entry) => member(entry.projectionId, "APPROVED_DISABLED", 0, 0)),
    formalDomainRequired: true,
  });
  assert.equal(disabled.status, "not_ready");
  assert.ok(disabled.reasonCodes.includes("PROJECTION_NOT_ACTIVE"));
  assert.ok(disabled.reasonCodes.includes("SOURCE_EMPTY"));
});

test("required completion is ready, diagnostics degrade, drift blocks and general is not-required", () => {
  const standard = set("commander-standard");
  const active = standard.members.map((entry) => member(entry.projectionId, "ACTIVE", 2, 2));
  assert.equal(evaluateDomainProjectionSetReadiness({
    definition: standard,
    members: active,
    formalDomainRequired: true,
  }).status, "ready");
  assert.equal(evaluateDomainProjectionSetReadiness({
    definition: standard,
    members: active,
    formalDomainRequired: false,
  }).status, "not_required");

  const diagnostic = set("embodied-diagnostic");
  const diagnosticMembers = diagnostic.members.map((entry, index) =>
    member(entry.projectionId, "ACTIVE", index === 0 ? 0 : 1, index === 0 ? 0 : 1),
  );
  assert.equal(evaluateDomainProjectionSetReadiness({
    definition: diagnostic,
    members: diagnosticMembers,
    formalDomainRequired: true,
  }).status, "degraded");

  const drifted = active.map((value, index) => index === 0 ? { ...value, schemaDrift: true } : value);
  assert.equal(evaluateDomainProjectionSetReadiness({
    definition: standard,
    members: drifted,
    formalDomainRequired: true,
  }).status, "blocked_drift");
});

function initialLifecycle(): DomainProjectionLifecycle {
  return Object.freeze({
    projectionId: "application_to_embodied.dp-c01",
    projectionVersion: 1,
    state: "MAPPING_CONTRACT_BLOCKED",
    revision: 0,
    definitionHash: HASH_A,
    mappingHash: HASH_B,
    lastActionId: "",
    lastActionHash: null,
  });
}

function activationGuard(maxMode: DomainProjectionActivationGuard["maxMode"]): DomainProjectionActivationGuard {
  return Object.freeze({
    expectedReleaseHash: HASH_A,
    actualReleaseHash: HASH_A,
    expectedSchemaHash: HASH_B,
    actualSchemaHash: HASH_B,
    expectedDefinitionHash: HASH_A,
    expectedMappingHash: HASH_B,
    sourceContractApproved: true,
    payloadContractApproved: true,
    targetContractApproved: true,
    activeProducerRegistered: true,
    fixtureQualificationMode: false,
    schemaDrift: false,
    maxMode,
  });
}

function set(id: "commander-standard" | "embodied-diagnostic") {
  return DOMAIN_PROJECTION_SET_DEFINITIONS.find((definition) => definition.setId === id)!;
}

function member(
  projectionId: DomainProjectionReadinessMember["projectionId"],
  state: DomainProjectionReadinessMember["state"],
  sourceCount: number,
  terminalCount: number,
): DomainProjectionReadinessMember {
  return Object.freeze({
    projectionId,
    state,
    sourceCount,
    terminalCount,
    blockingDeadLetterCount: 0,
    schemaDrift: false,
    episodeSealVerified: true,
  });
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
