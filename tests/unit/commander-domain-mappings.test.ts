import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  createDomainSourcePayloadHash,
  hashCanonicalDomainProjectionJson,
  type DomainSourceBatchRequest,
  type DomainSourceRecord,
} from "../../packages/telemetry-contracts/src/index.js";
import {
  COMMANDER_MAPPING_IDS,
  CommanderDomainMapper,
} from "../../packages/telemetry-projection-registry/src/commander-mappings.js";

test("DP-C01 through DP-C05 deterministically produce the five approved target shapes", async () => {
  const batch = await commanderBatch();
  const mapper = new CommanderDomainMapper();
  const first = batch.records.map((record) => mapper.map(record));
  const replay = batch.records.map((record) => mapper.map(structuredClone(record)));

  assert.deepEqual(
    first.map((decision) => decision.kind === "produce" && decision.mappingId),
    COMMANDER_MAPPING_IDS,
  );
  assert.deepEqual(first, replay);
  for (const decision of first) {
    assert.equal(decision.kind, "produce");
    if (decision.kind !== "produce") continue;
    assert.equal(decision.envelope.agentType, "commander");
    assert.equal(decision.envelope.mappingRuleVersion, "0.1.0");
    assert.equal(decision.envelope.sourceRecordId.startsWith("record-"), true);
    assert.equal(decision.envelope.payloadJson.startsWith("{"), true);
    assert.match(decision.envelope.payloadSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(Object.isFrozen(decision));
    assert.ok(Object.isFrozen(decision.targetFields));
  }
});

test("DP-C01 maps only authoritative action semantics and never invents target identity", async () => {
  const source = (await commanderBatch()).records[0]!;
  const decision = new CommanderDomainMapper().map(source);
  assert.equal(decision.kind, "produce");
  if (decision.kind !== "produce") return;
  assert.equal(decision.targetTable, "sdar_embodied.control_action");
  assert.deepEqual(decision.targetFields, {
    action_id: "action-c01",
    device_id: "ugv-1",
    action_type: "device_control",
    action_name: "set_velocity",
    capability: "ugv.set-velocity@1",
    resource_channel: "motion",
    target_id: "ugv-1",
    target_json: '{"entityId":"ugv-1","entityType":"vehicle"}',
    risk_level: "low",
    idempotency_key: "idempotency-c01",
    input_hash: "sha256:d98ad7f1d1659d694f8d2ae1fcf9ddfe014315bb6253da50ffbeabf50dee9b99",
    side_effect: 1,
    execution_status: "dispatched",
    controller_ref: "authority-1",
    basis_id: "basis-1",
    input_summary: "bounded test velocity command",
  });
});

test("DP-C02 canonicalizes optional receipt error and metrics payloads", async () => {
  const decision = new CommanderDomainMapper().map((await commanderBatch()).records[1]!);
  assert.equal(decision.kind, "produce");
  if (decision.kind !== "produce") return;
  assert.equal(decision.targetTable, "sdar_embodied.control_receipt");
  assert.equal(decision.targetFields["transport_status"], "delivered");
  assert.equal(decision.targetFields["acceptance_status"], "accepted");
  assert.equal(decision.targetFields["execution_status"], "completed");
  assert.equal(decision.targetFields["error_json"], "{}");
  assert.equal(decision.targetFields["metrics_json"], '[{"name":"latency_ms","value":12}]');
});

test("DP-C03 derives non-negative confirmation latency and preserves physical evidence", async () => {
  const source = (await commanderBatch()).records[2]!;
  const decision = new CommanderDomainMapper().map(source);
  assert.equal(decision.kind, "produce");
  if (decision.kind !== "produce") return;
  assert.equal(decision.targetTable, "sdar_embodied.physical_verification");
  assert.equal(decision.targetFields["confirmation_latency_ms"], "1000");
  assert.equal(decision.targetFields["verification_result"], "passed");
  assert.deepEqual(decision.targetFields["evidence_refs"], ["evidence-1"]);

  const invalid = changedPayload(source, { verifiedAt: "2026-08-17T08:00:59.999Z" });
  assert.deepEqual(new CommanderDomainMapper().map(invalid), {
    kind: "fail",
    mappingId: "DP-C03",
    failureCode: "MAPPING_REQUIRED_FIELD_MISSING",
    field: "confirmationLatencyMs",
  });
});

test("DP-C04 and DP-C05 preserve basis and source observation time without wall clock input", async () => {
  const records = (await commanderBatch()).records;
  const mapper = new CommanderDomainMapper();
  const recovery = mapper.map(records[3]!);
  const freshness = mapper.map(records[4]!);
  assert.equal(recovery.kind, "produce");
  assert.equal(freshness.kind, "produce");
  if (recovery.kind !== "produce" || freshness.kind !== "produce") return;
  assert.equal(recovery.targetFields["preempted_basis_id"], "basis-preempted");
  assert.equal(recovery.targetFields["selected_basis_id"], "basis-recovery");
  assert.equal(recovery.targetFields["actual_latency_ms"], "100");
  assert.equal(freshness.targetFields["observed_at"], "2026-08-17T08:03:00.000Z");
  assert.equal(freshness.targetFields["checked_at"], "2026-08-17T08:03:00.010Z");
  assert.equal(freshness.targetFields["check_result"], "fresh");
  assert.match(String(freshness.targetFields["check_id"]), /^[0-9a-f-]{36}$/u);
});

test("missing fields and unsupported enums fail explicitly while NPC input is a registered skip", async () => {
  const records = (await commanderBatch()).records;
  const missing = changedPayload(records[0]!, { deviceId: "" });
  assert.deepEqual(new CommanderDomainMapper().map(missing), {
    kind: "fail",
    mappingId: "DP-C01",
    failureCode: "MAPPING_REQUIRED_FIELD_MISSING",
    field: "deviceId",
  });
  const unsupported = changedPayload(records[2]!, { verificationResult: "assumed_pass" });
  assert.deepEqual(new CommanderDomainMapper().map(unsupported), {
    kind: "fail",
    mappingId: "DP-C03",
    failureCode: "MAPPING_ENUM_UNSUPPORTED",
    field: "verificationResult",
  });

  const npc = (await npcBatch()).records[0]!;
  assert.deepEqual(new CommanderDomainMapper().map(npc), {
    kind: "skip",
    reasonCode: "SOURCE_NOT_APPLICABLE",
  });
});

test("five immutable mapping documents and mapped-payload schemas match their frozen hashes", async () => {
  const root = path.join(process.cwd(), "integrations/domain-projection/mappings/v1");
  const manifest = JSON.parse(
    await readFile(path.join(root, "mapping-manifest.json"), "utf8"),
  ) as MappingManifest;
  assert.equal(manifest.releaseVersion, "1.5.1-rc.2");
  assert.equal(manifest.mappingCount, 5);
  assert.equal(manifest.complete, false);
  assert.deepEqual(
    manifest.mappings.map((entry) => entry.mappingId),
    COMMANDER_MAPPING_IDS,
  );
  const decisions = (await commanderBatch()).records.map((record) =>
    new CommanderDomainMapper().map(record),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("date-time", { type: "string", validate: (value: string) => !Number.isNaN(Date.parse(value)) });
  ajv.addFormat("uuid", { type: "string", validate: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value) });
  for (const [index, entry] of manifest.mappings.entries()) {
    const document = JSON.parse(await readFile(path.join(root, entry.documentPath), "utf8")) as MappingDocument;
    const schema = JSON.parse(await readFile(path.join(root, entry.payloadSchemaPath), "utf8"));
    assert.equal(hashCanonicalDomainProjectionJson(document), entry.documentHash);
    assert.equal(hashCanonicalDomainProjectionJson(schema), entry.payloadSchemaHash);
    assert.equal(document.mappingId, entry.mappingId);
    assert.equal(document.source.table.includes("domain_"), true);
    assert.equal(document.source.table.endsWith("_source_v1"), true);
    assert.equal(document.status, "disabled");
    const decision = decisions[index]!;
    assert.equal(decision.kind, "produce");
    if (decision.kind === "produce") {
      const validate = ajv.compile(schema);
      assert.equal(validate(decision.targetFields), true, JSON.stringify(validate.errors));
    }
  }
});

function changedPayload(
  source: DomainSourceRecord,
  change: Readonly<Record<string, unknown>>,
): DomainSourceRecord {
  const payload = { ...source.payload, ...change };
  return {
    ...source,
    payload,
    payloadHash: createDomainSourcePayloadHash(payload),
  };
}

async function commanderBatch(): Promise<DomainSourceBatchRequest> {
  return fixtureBatch("commander-five-records.batch.json");
}

async function npcBatch(): Promise<DomainSourceBatchRequest> {
  return fixtureBatch("npc-five-records.batch.json");
}

async function fixtureBatch(filename: string): Promise<DomainSourceBatchRequest> {
  return JSON.parse(
    await readFile(
      path.join(process.cwd(), "integrations/domain-source/contracts/v1/fixtures/valid", filename),
      "utf8",
    ),
  ) as DomainSourceBatchRequest;
}

interface MappingManifest {
  readonly releaseVersion: string;
  readonly mappingCount: number;
  readonly complete: boolean;
  readonly mappings: readonly Readonly<{
    mappingId: string;
    documentPath: string;
    documentHash: `sha256:${string}`;
    payloadSchemaPath: string;
    payloadSchemaHash: `sha256:${string}`;
  }>[];
}

interface MappingDocument {
  readonly mappingId: string;
  readonly source: Readonly<{ table: string }>;
  readonly status: string;
}
