import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  loadDomainProjectionContractValidator,
  type DomainSourceBatchRequest,
} from "../../packages/telemetry-contracts/src/index.js";
import {
  DOMAIN_CANONICAL_ID_NAMESPACE,
  DOMAIN_PROJECTION_DESCRIPTORS,
  DomainProjectionRegistry,
  createCanonicalDomainIdentity,
  createDerivedDomainSourceId,
  createDomainCommonTargetEnvelope,
  uuidV5,
} from "../../packages/telemetry-projection-registry/src/domain.js";

const expectedCatalog = [
  ["DP-C01", "sdar.domain-source/commander/mcp-action", "sdar_commander.domain_mcp_action_source_v1", "sdar_embodied.control_action"],
  ["DP-C02", "sdar.domain-source/commander/mcp-receipt", "sdar_commander.domain_mcp_receipt_source_v1", "sdar_embodied.control_receipt"],
  ["DP-C03", "sdar.domain-source/commander/capability-track-sample", "sdar_commander.domain_capability_track_sample_source_v1", "sdar_embodied.physical_verification"],
  ["DP-C04", "sdar.domain-source/commander/error-recovery", "sdar_commander.domain_error_recovery_source_v1", "sdar_embodied.preemption_recovery"],
  ["DP-C05", "sdar.domain-source/commander/ugv-state-snapshot", "sdar_commander.domain_ugv_state_snapshot_source_v1", "sdar_embodied.state_freshness_check"],
  ["DP-N01", "sdar.domain-source/npc/mission-tool-call", "sdar_npc.domain_mission_tool_call_source_v1", "sdar_embodied.control_action"],
  ["DP-N02", "sdar.domain-source/npc/mcp-receipt", "sdar_npc.domain_mcp_receipt_source_v1", "sdar_embodied.control_receipt"],
  ["DP-N03", "sdar.domain-source/npc/hmi-approval", "sdar_npc.domain_hmi_approval_source_v1", "sdar_embodied.human_confirmation"],
  ["DP-N04", "sdar.domain-source/npc/preemption-record", "sdar_npc.domain_preemption_record_source_v1", "sdar_embodied.preemption_recovery"],
  ["DP-N05", "sdar.domain-source/npc/blackboard-snapshot", "sdar_npc.domain_blackboard_snapshot_source_v1", "sdar_embodied.state_freshness_check"],
] as const;

test("DomainProjectionRegistry freezes exactly ten disabled independent projections", async () => {
  const validator = await loadDomainProjectionContractValidator();
  const registry = new DomainProjectionRegistry();
  assert.equal(registry.list().length, 10);
  assert.deepEqual(
    registry.list().map((entry) => [
      entry.mappingId,
      entry.sourceContractId,
      entry.sourceQualifiedTable,
      entry.targetQualifiedTable,
    ]),
    expectedCatalog,
  );
  for (const descriptor of registry.list()) {
    assert.equal(validator.assertDefinition(descriptor.definition).enabled, false);
    assert.match(descriptor.definitionHash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(
      registry.get(descriptor.definition.projectionId, descriptor.definition.projectionVersion),
      descriptor,
    );
    assert.equal(registry.resolveSource(descriptor.sourceContractId), descriptor);
    assert.ok(Object.isFrozen(descriptor));
    assert.ok(Object.isFrozen(descriptor.definition));
  }
  assert.equal(new Set(registry.list().map((item) => item.definition.projectionId)).size, 10);
  assert.throws(
    () => new DomainProjectionRegistry([DOMAIN_PROJECTION_DESCRIPTORS[0]!, DOMAIN_PROJECTION_DESCRIPTORS[0]!]),
    (error: unknown) => hasCode(error, "DOMAIN_PROJECTION_DUPLICATE"),
  );
});

test("RFC 9562 UUIDv5 matches the independent standard and SDAR Golden vectors", () => {
  assert.equal(
    uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.widgets.com"),
    "21f7f8de-8051-5b89-8680-0195ef798b6a",
  );
  const identity = createCanonicalDomainIdentity({
    tenantId: " tenant-α ",
    projectId: "project-1",
    sourceAgentType: "commander",
    sourceEntityType: "embodied.control_action",
    sourceId: "record-1",
  });
  assert.equal(DOMAIN_CANONICAL_ID_NAMESPACE, "5832c301-3d9e-5927-8f15-fa6262c8fc4e");
  assert.equal(identity.targetId, "8ea47267-0799-5640-8359-eb2bab0210f5");
  assert.equal(
    identity.sourceKeyHash,
    "sha256:50491fb8ee6c07faf6553cad677f0670cdea64840d0287463722c42d80f23c5c",
  );
  assert.equal(
    identity.canonicalName,
    "sdar-id-v1\u001ftenant-α\u001fproject-1\u001fcommander\u001fembodied.control_action\u001frecord-1",
  );
});

test("canonical identities are stable in independent processes and replay", async () => {
  const input = {
    tenantId: "tenant-α",
    projectId: "project-1",
    sourceAgentType: "commander" as const,
    sourceEntityType: "embodied.control_action",
    sourceId: "record-1",
  };
  const expected = createCanonicalDomainIdentity(input);
  const [left, right] = await Promise.all([childIdentity(input), childIdentity(input)]);
  assert.deepEqual(left, expected);
  assert.deepEqual(right, expected);
});

test("derived source identities use NFC-trimmed UTF-8 byte lengths and reject unstable components", () => {
  assert.equal(createDerivedDomainSourceId(" rec-é ", " action-一 "), "derived-v1:6:rec-é:10:action-一");
  assert.throws(
    () => createCanonicalDomainIdentity({
      tenantId: "tenant\u001fbad",
      projectId: "project",
      sourceAgentType: "commander",
      sourceEntityType: "embodied.control_action",
      sourceId: "record",
    }),
    (error: unknown) => hasCode(error, "DOMAIN_ID_COMPONENT_INVALID"),
  );
});

test("common target envelope preserves source/root lineage and hashes mapped payload only", async () => {
  const batch = await fixtureBatch();
  const source = batch.records[0]!;
  const descriptor = new DomainProjectionRegistry().resolveSource(source.sourceContractId)!;
  const envelope = createDomainCommonTargetEnvelope({
    descriptor,
    source,
    mappedPayload: { z: [2, 1], a: { accepted: true } },
    mappingRuleId: "domain.mapping.dp-c01.primary",
    mappingRuleVersion: "0.1.0",
  });
  const replay = createDomainCommonTargetEnvelope({
    descriptor,
    source,
    mappedPayload: { a: { accepted: true }, z: [2, 1] },
    mappingRuleId: "domain.mapping.dp-c01.primary",
    mappingRuleVersion: "0.1.0",
  });
  assert.deepEqual(replay, envelope);
  assert.equal(envelope.sourceRecordId, source.recordId);
  assert.equal(envelope.rootSourceRecordId, source.recordId);
  assert.equal(envelope.sourcePayloadHash, source.payloadHash);
  assert.equal(envelope.rootSourcePayloadHash, source.payloadHash);
  assert.equal(envelope.sourceDeploymentId, source.producerId);
  assert.equal(envelope.sourceEnvironmentRaw, source.environment);
  assert.equal(envelope.environmentMapVersion, "identity/1");
  assert.equal(envelope.recordId, envelope.canonicalRecordId);
  assert.equal(envelope.projectionRevision, source.sourceRevision);
  assert.equal(envelope.payloadJson, '{"a":{"accepted":true},"z":[2,1]}');
  assert.notEqual(envelope.payloadSha256, source.payloadHash);
  assert.ok(Object.isFrozen(envelope));
});

test("common target envelope rejects projection/source mismatch and invalid UInt64 revision", async () => {
  const batch = await fixtureBatch();
  const source = batch.records[0]!;
  const wrong = DOMAIN_PROJECTION_DESCRIPTORS[1]!;
  assert.throws(
    () => createDomainCommonTargetEnvelope({
      descriptor: wrong,
      source,
      mappedPayload: {},
      mappingRuleId: "domain.mapping.test",
      mappingRuleVersion: "0.1.0",
    }),
    (error: unknown) => hasCode(error, "DOMAIN_PROJECTION_SOURCE_MISMATCH"),
  );
  assert.throws(
    () => createDomainCommonTargetEnvelope({
      descriptor: DOMAIN_PROJECTION_DESCRIPTORS[0]!,
      source: { ...source, sourceRevision: "0" },
      mappedPayload: {},
      mappingRuleId: "domain.mapping.test",
      mappingRuleVersion: "0.1.0",
    }),
    (error: unknown) => hasCode(error, "DOMAIN_SOURCE_REVISION_INVALID"),
  );
});

async function fixtureBatch(): Promise<DomainSourceBatchRequest> {
  return JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "integrations/domain-source/contracts/v1/fixtures/valid/commander-five-records.batch.json",
      ),
      "utf8",
    ),
  ) as DomainSourceBatchRequest;
}

async function childIdentity(input: Record<string, unknown>): Promise<unknown> {
  const child = fork(path.resolve("dist/tests/fixtures/domain-identity-child.js"), [], {
    env: { SDAR_TEST_DOMAIN_ID_INPUT: JSON.stringify(input) },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const message = once(child, "message") as Promise<[unknown]>;
  const exit = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  const [value] = await message;
  const [exitCode, signal] = await exit;
  assert.equal(exitCode, 0);
  assert.equal(signal, null);
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
