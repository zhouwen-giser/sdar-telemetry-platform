import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DOMAIN_SOURCE_V1_CONTRACT,
  DOMAIN_SOURCE_V1_CONTRACT_IDS,
  createDomainSourceBatchHash,
  createDomainSourcePayloadHash,
  hashCanonicalDomainSourceJson,
  type DomainSourceBatchRequest,
  type DomainSourceBatchUnsigned,
  type DomainSourceContractId,
  type DomainSourceEpisodeSealRequest,
  type DomainSourceRecord,
} from "../packages/telemetry-contracts/src/domain-source.js";

type JsonObject = Record<string, unknown>;

const check = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((argument: string) => argument !== "--check")) {
  fail("ARGUMENT_INVALID");
}

const root = path.resolve("integrations/domain-source/contracts/v1");
const schemaRoot = path.join(root, "schemas");
const fixtureRoot = path.join(root, "fixtures");
const generated = new Map<string, Buffer>();

const hashPattern = "^sha256:[0-9a-f]{64}$";
const unsignedDecimal = "^(?:0|[1-9][0-9]*)$";
const positiveDecimal = "^[1-9][0-9]*$";
const identifier = Object.freeze({ type: "string", minLength: 1, maxLength: 256 });
const optionalIdentifier = Object.freeze({ type: "string", maxLength: 256 });
const timestamp = Object.freeze({ type: "string", format: "date-time" });
const nullableTimestamp = Object.freeze({
  anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
});
const uint64 = Object.freeze({ type: "string", pattern: unsignedDecimal, maxLength: 20 });
const positiveUInt64 = Object.freeze({ type: "string", pattern: positiveDecimal, maxLength: 20 });
const hash = Object.freeze({ type: "string", pattern: hashPattern });
const stringArray = Object.freeze({
  type: "array",
  maxItems: 256,
  items: { type: "string", minLength: 1, maxLength: 512 },
});

const actionPayload = objectSchema(
  {
    actionId: identifier,
    actionName: identifier,
    targetEntityId: identifier,
    targetEntityType: identifier,
    deviceId: identifier,
    resourceChannel: identifier,
    capabilityRef: identifier,
    controlAuthorityRef: identifier,
    executionBasisRef: identifier,
    idempotencyKey: identifier,
    parametersHash: hash,
    dispatchStatus: identifier,
    riskLevel: identifier,
    inputSummary: { type: "string", maxLength: 4096 },
  },
  [
    "actionId",
    "actionName",
    "targetEntityId",
    "targetEntityType",
    "deviceId",
    "resourceChannel",
    "capabilityRef",
    "controlAuthorityRef",
    "executionBasisRef",
    "idempotencyKey",
    "parametersHash",
    "dispatchStatus",
    "riskLevel",
    "inputSummary",
  ],
);

const receiptPayload = objectSchema(
  {
    receiptId: identifier,
    actionId: identifier,
    deviceId: identifier,
    resourceChannel: identifier,
    providerId: identifier,
    providerRequestId: optionalIdentifier,
    transportStatus: identifier,
    acceptanceStatus: identifier,
    executionStatus: identifier,
    receivedAt: timestamp,
    outputSummary: { type: "string", maxLength: 4096 },
    errorCode: optionalIdentifier,
    rawResponseRef: optionalIdentifier,
    observedStateRef: optionalIdentifier,
    error: { type: "object", maxProperties: 64, additionalProperties: true },
    metrics: { type: "array", maxItems: 256, items: {} },
  },
  [
    "receiptId",
    "actionId",
    "deviceId",
    "resourceChannel",
    "providerId",
    "transportStatus",
    "acceptanceStatus",
    "executionStatus",
    "receivedAt",
  ],
);

const verificationPayload = objectSchema(
  {
    physicalVerificationId: identifier,
    verificationId: identifier,
    criterionId: identifier,
    actionId: identifier,
    receiptId: optionalIdentifier,
    deviceId: identifier,
    resourceChannel: identifier,
    capability: identifier,
    verificationChannel: identifier,
    expected: {},
    actual: {},
    comparator: identifier,
    verificationResult: {
      type: "string",
      enum: ["passed", "failed", "inconclusive", "not_observed"],
    },
    critical: { type: "boolean" },
    stableDurationMs: uint64,
    deviceTimestamp: timestamp,
    verifiedAt: timestamp,
    sourceStateId: optionalIdentifier,
    evidenceRefs: stringArray,
  },
  [
    "physicalVerificationId",
    "verificationId",
    "criterionId",
    "actionId",
    "deviceId",
    "resourceChannel",
    "capability",
    "verificationChannel",
    "expected",
    "actual",
    "comparator",
    "verificationResult",
    "critical",
    "deviceTimestamp",
    "verifiedAt",
    "evidenceRefs",
  ],
);

const preemptionPayload = objectSchema(
  {
    preemptionId: identifier,
    preemptedActionId: identifier,
    deviceId: identifier,
    resourceChannel: identifier,
    phase: {
      type: "string",
      enum: ["requested", "stopping", "stopped", "recovering", "resumed", "failed"],
    },
    triggerType: identifier,
    triggerEventId: optionalIdentifier,
    requiredDeadlineMs: uint64,
    stopConfirmed: { type: "boolean" },
    stopConfirmedAt: nullableTimestamp,
    recoveryStrategy: identifier,
    recoveryResult: identifier,
    recoveryBasisRef: identifier,
    recoveryBasisVersion: positiveUInt64,
    resumedBasisId: optionalIdentifier,
    resumedBasisVersion: { anyOf: [positiveUInt64, { const: "" }] },
    preemptedBasisId: identifier,
    preemptedBasisVersion: positiveUInt64,
    selectedIntent: { type: "string", minLength: 1, maxLength: 4096 },
    actualLatencyMs: uint64,
  },
  [
    "preemptionId",
    "preemptedActionId",
    "deviceId",
    "resourceChannel",
    "phase",
    "triggerType",
    "stopConfirmed",
    "stopConfirmedAt",
    "recoveryStrategy",
    "recoveryResult",
    "recoveryBasisRef",
    "recoveryBasisVersion",
    "preemptedBasisId",
    "preemptedBasisVersion",
    "selectedIntent",
    "actualLatencyMs",
  ],
);

const statePayload = objectSchema(
  {
    stateSnapshotId: identifier,
    stateSnapshotVersion: positiveUInt64,
    entityId: identifier,
    deviceId: identifier,
    stateField: identifier,
    sourceComponent: identifier,
    observedAt: timestamp,
    evaluatedAt: timestamp,
    ageMs: uint64,
    thresholdMs: uint64,
    thresholdPolicyId: identifier,
    thresholdPolicyVersion: positiveUInt64,
    freshnessResult: { type: "string", enum: ["fresh", "stale", "unknown"] },
    conflictDetected: { type: "boolean" },
    missing: { type: "boolean" },
  },
  [
    "stateSnapshotId",
    "stateSnapshotVersion",
    "entityId",
    "deviceId",
    "stateField",
    "sourceComponent",
    "observedAt",
    "evaluatedAt",
    "ageMs",
    "thresholdMs",
    "thresholdPolicyId",
    "thresholdPolicyVersion",
    "freshnessResult",
    "conflictDetected",
    "missing",
  ],
);

const approvalPayload = objectSchema(
  {
    confirmationId: identifier,
    approvalId: identifier,
    actionId: identifier,
    decision: { type: "string", enum: ["approved", "rejected", "expired", "cancelled"] },
    requestedAt: timestamp,
    respondedAt: nullableTimestamp,
    approvedBy: optionalIdentifier,
    validFrom: nullableTimestamp,
    expiresAt: nullableTimestamp,
    invalidatedAt: nullableTimestamp,
    invalidationReason: { type: "string", maxLength: 4096 },
    confirmationScope: identifier,
    confirmationBasisRef: optionalIdentifier,
    stateVersionAtApproval: uint64,
    evidenceRefs: stringArray,
    invalidationConditions: stringArray,
  },
  ["confirmationId", "approvalId", "actionId", "decision", "requestedAt", "confirmationScope"],
);

const payloadByContract = new Map<DomainSourceContractId, JsonObject>([
  ["sdar.domain-source/commander/mcp-action", actionPayload],
  ["sdar.domain-source/commander/mcp-receipt", receiptPayload],
  ["sdar.domain-source/commander/capability-track-sample", verificationPayload],
  ["sdar.domain-source/commander/error-recovery", preemptionPayload],
  ["sdar.domain-source/commander/ugv-state-snapshot", statePayload],
  ["sdar.domain-source/npc/mission-tool-call", actionPayload],
  ["sdar.domain-source/npc/mcp-receipt", receiptPayload],
  ["sdar.domain-source/npc/hmi-approval", approvalPayload],
  ["sdar.domain-source/npc/preemption-record", preemptionPayload],
  ["sdar.domain-source/npc/blackboard-snapshot", statePayload],
]);

const recordVariants = DOMAIN_SOURCE_V1_CONTRACT_IDS.map((contractId) =>
  objectSchema(
    {
      sourceContractId: { const: contractId },
      sourceContractVersion: { const: "1" },
      tenantId: identifier,
      projectId: identifier,
      environment: { type: "string", enum: ["dev", "test", "staging", "prod"] },
      recordId: identifier,
      episodeId: identifier,
      taskId: optionalIdentifier,
      contextId: optionalIdentifier,
      agentId: identifier,
      agentVersion: optionalIdentifier,
      scenarioId: optionalIdentifier,
      correlationId: optionalIdentifier,
      sequence: uint64,
      sourceRevision: positiveUInt64,
      producerId: identifier,
      producerVersion: identifier,
      occurredAt: timestamp,
      payload: payloadByContract.get(contractId)!,
      payloadHash: hash,
    },
    [
      "sourceContractId",
      "sourceContractVersion",
      "tenantId",
      "projectId",
      "environment",
      "recordId",
      "episodeId",
      "agentId",
      "sequence",
      "sourceRevision",
      "producerId",
      "producerVersion",
      "occurredAt",
      "payload",
      "payloadHash",
    ],
  ),
);

const batchSchema: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sdar.dev/schemas/domain-source/v1/domain-source-batch.schema.json",
  title: "SDAR Domain Source v1 batch",
  ...objectSchema(
    {
      contractVersion: { const: DOMAIN_SOURCE_V1_CONTRACT },
      batchId: identifier,
      application: { type: "string", enum: ["commander", "npc"] },
      firstSequence: uint64,
      lastSequence: uint64,
      records: { type: "array", minItems: 1, maxItems: 1_000, items: { oneOf: recordVariants } },
      batchHash: hash,
    },
    [
      "contractVersion",
      "batchId",
      "application",
      "firstSequence",
      "lastSequence",
      "records",
      "batchHash",
    ],
  ),
};

const sealSchema: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sdar.dev/schemas/domain-source/v1/domain-source-episode-seal.schema.json",
  title: "SDAR Domain Source v1 episode seal",
  ...objectSchema(
    {
      contractVersion: { const: DOMAIN_SOURCE_V1_CONTRACT },
      application: { type: "string", enum: ["commander", "npc"] },
      tenantId: identifier,
      projectId: identifier,
      environment: { type: "string", enum: ["dev", "test", "staging", "prod"] },
      sealId: identifier,
      sealRevision: positiveUInt64,
      sourceContractId: { type: "string", enum: [...DOMAIN_SOURCE_V1_CONTRACT_IDS] },
      sourceContractVersion: { const: "1" },
      episodeId: identifier,
      finalSequence: uint64,
      finalSourceRevision: positiveUInt64,
      sourceRecordCount: uint64,
      sourceSnapshotHash: hash,
      sealStatus: { type: "string", enum: ["sealed", "superseded", "invalid"] },
      producerId: identifier,
      producerVersion: identifier,
      payload: { type: "object", maxProperties: 64, additionalProperties: true },
      sealedAt: timestamp,
    },
    [
      "contractVersion",
      "application",
      "tenantId",
      "projectId",
      "environment",
      "sealId",
      "sealRevision",
      "sourceContractId",
      "sourceContractVersion",
      "episodeId",
      "finalSequence",
      "finalSourceRevision",
      "sourceRecordCount",
      "sourceSnapshotHash",
      "sealStatus",
      "producerId",
      "producerVersion",
      "payload",
      "sealedAt",
    ],
  ),
};

const batchAckSchema: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sdar.dev/schemas/domain-source/v1/domain-source-batch-acknowledgement.schema.json",
  ...objectSchema({ lastAcknowledgedSequence: uint64 }, ["lastAcknowledgedSequence"]),
};
const sealAckSchema: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sdar.dev/schemas/domain-source/v1/domain-source-seal-acknowledgement.schema.json",
  ...objectSchema({ sealId: identifier, sealRevision: positiveUInt64 }, ["sealId", "sealRevision"]),
};

const schemas = new Map([
  ["domain-source-batch.schema.json", batchSchema],
  ["domain-source-episode-seal.schema.json", sealSchema],
  ["domain-source-batch-acknowledgement.schema.json", batchAckSchema],
  ["domain-source-seal-acknowledgement.schema.json", sealAckSchema],
]);
for (const [name, schema] of schemas) generated.set(`schemas/${name}`, jsonBuffer(schema));

const schemaKinds = [
  ["batch", "domain-source-batch.schema.json"],
  ["seal", "domain-source-episode-seal.schema.json"],
  ["batchAck", "domain-source-batch-acknowledgement.schema.json"],
  ["sealAck", "domain-source-seal-acknowledgement.schema.json"],
] as const;
generated.set(
  "contract-manifest.json",
  jsonBuffer({
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    header: "x-sdar-domain-source-contract",
    sourceContractIds: [...DOMAIN_SOURCE_V1_CONTRACT_IDS],
    schemas: schemaKinds.map(([kind, name]) => ({
      kind,
      path: `schemas/${name}`,
      canonicalHash: hashCanonicalDomainSourceJson(schemas.get(name)),
    })),
  }),
);

const fixtureCases: { path: string; kind: string; valid: boolean }[] = [];
function fixture(name: string, kind: string, valid: boolean, value: unknown): void {
  const relative = `${valid ? "valid" : "invalid"}/${name}.json`;
  generated.set(`fixtures/${relative}`, jsonBuffer(value));
  fixtureCases.push({ path: relative, kind, valid });
}

const commander = batch("commander", [
  record("sdar.domain-source/commander/mcp-action", "100", actionPayloadValue("c01")),
  record("sdar.domain-source/commander/mcp-receipt", "101", receiptPayloadValue("c02")),
  record(
    "sdar.domain-source/commander/capability-track-sample",
    "102",
    verificationPayloadValue(),
  ),
  record("sdar.domain-source/commander/error-recovery", "103", preemptionPayloadValue("c04")),
  record(
    "sdar.domain-source/commander/ugv-state-snapshot",
    "104",
    statePayloadValue("c05"),
  ),
]);
const npc = batch("npc", [
  record("sdar.domain-source/npc/mission-tool-call", "200", actionPayloadValue("n01")),
  record("sdar.domain-source/npc/mcp-receipt", "201", receiptPayloadValue("n02")),
  record("sdar.domain-source/npc/hmi-approval", "202", approvalPayloadValue()),
  record("sdar.domain-source/npc/preemption-record", "203", preemptionPayloadValue("n04")),
  record("sdar.domain-source/npc/blackboard-snapshot", "204", statePayloadValue("n05")),
]);
fixture("commander-five-records.batch", "batch", true, commander);
fixture("npc-five-records.batch", "batch", true, npc);
fixture("commander-source.seal", "seal", true, seal("commander", commander.records[0]!));
fixture("npc-source.seal", "seal", true, seal("npc", npc.records[0]!));
fixture("full.batch-ack", "batchAck", true, { lastAcknowledgedSequence: "104" });
fixture("durable.seal-ack", "sealAck", true, { sealId: "seal-commander-1", sealRevision: "1" });

fixture("near-name-source.batch", "batch", false, replace(commander, ["records", 0, "sourceContractId"], "sdar_commander.mcp_action"));
fixture("arbitrary-table.batch", "batch", false, { ...commander, sourceTable: "domain_mcp_action_source_v1" });
fixture("mixed-application.batch", "batch", false, replace(commander, ["records", 0, "sourceContractId"], "sdar.domain-source/npc/mission-tool-call"));
fixture("tampered-payload-hash.batch", "batch", false, replace(commander, ["records", 0, "payload", "riskLevel"], "changed"));
fixture("tampered-batch-hash.batch", "batch", false, { ...commander, batchId: "tampered" });
fixture("noncanonical-revision.batch", "batch", false, replace(commander, ["records", 0, "sourceRevision"], "01"));
fixture("unexpected-payload-field.batch", "batch", false, replace(commander, ["records", 0, "payload", "database"], "sdar_commander"));
fixture("wrong-application.seal", "seal", false, { ...seal("commander", commander.records[0]!), application: "npc" });
fixture("extra-property.batch-ack", "batchAck", false, { lastAcknowledgedSequence: "104", status: "accepted" });
fixture("zero-revision.seal-ack", "sealAck", false, { sealId: "seal-1", sealRevision: "0" });

generated.set(
  "fixtures/manifest.json",
  jsonBuffer({
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    cases: fixtureCases.sort((left, right) => left.path.localeCompare(right.path)),
  }),
);

if (check) {
  const drift: string[] = [];
  for (const [relative, expected] of generated) {
    try {
      if (!(await readFile(path.join(root, relative))).equals(expected)) drift.push(relative);
    } catch {
      drift.push(relative);
    }
  }
  if (drift.length > 0) fail(`DOMAIN_SOURCE_CONTRACT_DRIFT:${drift.join(",")}`);
} else {
  for (const [relative, bytes] of generated) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { mode: 0o644 });
  }
}

console.log(
  JSON.stringify({
    event: "domain_source_contracts.synced",
    action: check ? "checked" : "synced",
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    schemas: schemas.size,
    sourceContractIds: DOMAIN_SOURCE_V1_CONTRACT_IDS.length,
    fixtures: fixtureCases.length,
  }),
);

function objectSchema(properties: Record<string, unknown>, required: string[]): JsonObject {
  return { type: "object", additionalProperties: false, required, properties };
}

function record(
  sourceContractId: DomainSourceContractId,
  sequence: string,
  payload: Record<string, unknown>,
): DomainSourceRecord {
  return {
    sourceContractId,
    sourceContractVersion: "1",
    tenantId: "tenant-domain-golden",
    projectId: "project-domain-golden",
    environment: "test",
    recordId: `record-${sequence}`,
    episodeId: "episode-domain-golden",
    taskId: "task-domain-golden",
    contextId: "context-domain-golden",
    agentId: sourceContractId.includes("/commander/") ? "commander-1" : "npc-1",
    agentVersion: "1.0.0",
    scenarioId: "scenario-domain-golden",
    correlationId: `correlation-${sequence}`,
    sequence,
    sourceRevision: "1",
    producerId: "domain-golden-producer",
    producerVersion: "1.0.0",
    occurredAt: `2026-08-17T08:00:${String(Number(sequence) % 60).padStart(2, "0")}.000Z`,
    payload,
    payloadHash: createDomainSourcePayloadHash(payload),
  };
}

function batch(
  application: "commander" | "npc",
  records: readonly DomainSourceRecord[],
): DomainSourceBatchRequest {
  const unsigned: DomainSourceBatchUnsigned = {
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    batchId: `batch-${application}-golden`,
    application,
    firstSequence: records[0]!.sequence,
    lastSequence: records.at(-1)!.sequence,
    records,
  };
  return { ...unsigned, batchHash: createDomainSourceBatchHash(unsigned) };
}

function seal(
  application: "commander" | "npc",
  recordValue: DomainSourceRecord,
): DomainSourceEpisodeSealRequest {
  return {
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    application,
    tenantId: recordValue.tenantId,
    projectId: recordValue.projectId,
    environment: "test",
    sealId: `seal-${application}-1`,
    sealRevision: "1",
    sourceContractId: recordValue.sourceContractId,
    sourceContractVersion: "1",
    episodeId: recordValue.episodeId,
    finalSequence: recordValue.sequence,
    finalSourceRevision: "1",
    sourceRecordCount: "1",
    sourceSnapshotHash: hashCanonicalDomainSourceJson([recordValue.payloadHash]),
    sealStatus: "sealed",
    producerId: recordValue.producerId,
    producerVersion: recordValue.producerVersion,
    payload: { reason: "golden fixture episode closure" },
    sealedAt: "2026-08-17T08:10:00.000Z",
  };
}

function actionPayloadValue(suffix: string): Record<string, unknown> {
  return {
    actionId: `action-${suffix}`,
    actionName: "set_velocity",
    targetEntityId: "ugv-1",
    targetEntityType: "vehicle",
    deviceId: "ugv-1",
    resourceChannel: "motion",
    capabilityRef: "ugv.set-velocity@1",
    controlAuthorityRef: "authority-1",
    executionBasisRef: "basis-1",
    idempotencyKey: `idempotency-${suffix}`,
    parametersHash: hashCanonicalDomainSourceJson({ linear: 0.2 }),
    dispatchStatus: "dispatched",
    riskLevel: "low",
    inputSummary: "bounded test velocity command",
  };
}

function receiptPayloadValue(suffix: string): Record<string, unknown> {
  return {
    receiptId: `receipt-${suffix}`,
    actionId: `action-${suffix}`,
    deviceId: "ugv-1",
    resourceChannel: "motion",
    providerId: "provider-1",
    providerRequestId: `request-${suffix}`,
    transportStatus: "delivered",
    acceptanceStatus: "accepted",
    executionStatus: "completed",
    receivedAt: "2026-08-17T08:01:00.000Z",
    outputSummary: "completed",
    errorCode: "",
    rawResponseRef: "",
    observedStateRef: "state-1",
    error: {},
    metrics: [{ name: "latency_ms", value: 12 }],
  };
}

function verificationPayloadValue(): Record<string, unknown> {
  return {
    physicalVerificationId: "physical-verification-1",
    verificationId: "verification-1",
    criterionId: "criterion-1",
    actionId: "action-c01",
    receiptId: "receipt-c02",
    deviceId: "ugv-1",
    resourceChannel: "motion",
    capability: "ugv.set-velocity",
    verificationChannel: "odometry",
    expected: { speed: 0.2 },
    actual: { speed: 0.2 },
    comparator: "numeric_tolerance",
    verificationResult: "passed",
    critical: true,
    stableDurationMs: "1000",
    deviceTimestamp: "2026-08-17T08:01:00.000Z",
    verifiedAt: "2026-08-17T08:01:01.000Z",
    sourceStateId: "state-1",
    evidenceRefs: ["evidence-1"],
  };
}

function preemptionPayloadValue(suffix: string): Record<string, unknown> {
  return {
    preemptionId: `preemption-${suffix}`,
    preemptedActionId: `action-${suffix}`,
    deviceId: "ugv-1",
    resourceChannel: "motion",
    phase: "resumed",
    triggerType: "operator_override",
    triggerEventId: `trigger-${suffix}`,
    requiredDeadlineMs: "500",
    stopConfirmed: true,
    stopConfirmedAt: "2026-08-17T08:02:00.100Z",
    recoveryStrategy: "resume_safe_basis",
    recoveryResult: "succeeded",
    recoveryBasisRef: "basis-recovery",
    recoveryBasisVersion: "1",
    resumedBasisId: "basis-resumed",
    resumedBasisVersion: "1",
    preemptedBasisId: "basis-preempted",
    preemptedBasisVersion: "1",
    selectedIntent: "resume after verified stop",
    actualLatencyMs: "100",
  };
}

function statePayloadValue(suffix: string): Record<string, unknown> {
  return {
    stateSnapshotId: `snapshot-${suffix}`,
    stateSnapshotVersion: "1",
    entityId: "ugv-1",
    deviceId: "ugv-1",
    stateField: "velocity",
    sourceComponent: "odometry",
    observedAt: "2026-08-17T08:03:00.000Z",
    evaluatedAt: "2026-08-17T08:03:00.010Z",
    ageMs: "10",
    thresholdMs: "1000",
    thresholdPolicyId: "freshness-default",
    thresholdPolicyVersion: "1",
    freshnessResult: "fresh",
    conflictDetected: false,
    missing: false,
  };
}

function approvalPayloadValue(): Record<string, unknown> {
  return {
    confirmationId: "confirmation-n03",
    approvalId: "approval-n03",
    actionId: "action-n01",
    decision: "approved",
    requestedAt: "2026-08-17T08:04:00.000Z",
    respondedAt: "2026-08-17T08:04:01.000Z",
    approvedBy: "operator-1",
    validFrom: "2026-08-17T08:04:01.000Z",
    expiresAt: "2026-08-17T08:14:01.000Z",
    invalidatedAt: null,
    invalidationReason: "",
    confirmationScope: "action",
    confirmationBasisRef: "basis-approval",
    stateVersionAtApproval: "1",
    evidenceRefs: ["evidence-approval-1"],
    invalidationConditions: ["state_version_changed"],
  };
}

function replace(value: unknown, pathParts: readonly (string | number)[], replacement: unknown): unknown {
  const clone = structuredClone(value) as Record<string, unknown>;
  let cursor: unknown = clone;
  for (const part of pathParts.slice(0, -1)) {
    cursor = (cursor as Record<string | number, unknown>)[part];
  }
  const last = pathParts.at(-1)!;
  (cursor as Record<string | number, unknown>)[last] = replacement;
  return clone;
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fail(code: string): never {
  console.error(JSON.stringify({ event: "domain_source_contracts.failed", errorCode: code }));
  process.exit(1);
  throw new Error(code);
}
