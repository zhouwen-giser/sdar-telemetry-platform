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
import { CommanderDomainMapper } from "../../packages/telemetry-projection-registry/src/commander-mappings.js";
import {
  NPC_MAPPING_IDS,
  NpcDomainMapper,
} from "../../packages/telemetry-projection-registry/src/npc-mappings.js";

test("DP-N01 through DP-N05 deterministically produce the five approved target shapes", async () => {
  const batch = await fixtureBatch("npc-five-records.batch.json");
  const mapper = new NpcDomainMapper();
  const first = batch.records.map((record) => mapper.map(record));
  const replay = batch.records.map((record) => mapper.map(structuredClone(record)));
  assert.deepEqual(
    first.map((decision) => decision.kind === "produce" && decision.mappingId),
    NPC_MAPPING_IDS,
  );
  assert.deepEqual(first, replay);
  for (const decision of first) {
    assert.equal(decision.kind, "produce");
    if (decision.kind !== "produce") continue;
    assert.equal(decision.envelope.agentType, "npc");
    assert.match(decision.envelope.payloadSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(Object.isFrozen(decision));
    assert.ok(Object.isFrozen(decision.targetFields));
  }
});

test("DP-N01 and DP-N02 reuse only the shared exact action and receipt semantics", async () => {
  const records = (await fixtureBatch("npc-five-records.batch.json")).records;
  const mapper = new NpcDomainMapper();
  const action = mapper.map(records[0]!);
  const receipt = mapper.map(records[1]!);
  assert.equal(action.kind, "produce");
  assert.equal(receipt.kind, "produce");
  if (action.kind !== "produce" || receipt.kind !== "produce") return;
  assert.equal(action.targetTable, "sdar_embodied.control_action");
  assert.equal(action.targetFields["target_id"], "ugv-1");
  assert.equal(action.targetFields["resource_channel"], "motion");
  assert.equal(receipt.targetTable, "sdar_embodied.control_receipt");
  assert.equal(receipt.targetFields["receipt_id"], "receipt-n02");
});

test("DP-N03 uses the authoritative action link and preserves approval timing", async () => {
  const source = (await fixtureBatch("npc-five-records.batch.json")).records[2]!;
  const decision = new NpcDomainMapper().map(source);
  assert.equal(decision.kind, "produce");
  if (decision.kind !== "produce") return;
  assert.equal(decision.targetTable, "sdar_embodied.human_confirmation");
  assert.equal(decision.targetFields["subject_type"], "action");
  assert.equal(decision.targetFields["subject_id"], "action-n01");
  assert.equal(decision.targetFields["confirmation_status"], "approved");
  assert.equal(decision.targetFields["valid_until"], "2026-08-17T08:14:01.000Z");
  assert.deepEqual(decision.targetFields["invalidation_conditions"], ["state_version_changed"]);
});

test("DP-N03 refuses to choose an action when the authoritative actionId is absent", async () => {
  const source = (await fixtureBatch("npc-five-records.batch.json")).records[2]!;
  const missing = changedPayload(source, { actionId: "" });
  assert.deepEqual(new NpcDomainMapper().map(missing), {
    kind: "fail",
    mappingId: "DP-N03",
    failureCode: "HMI_APPROVAL_ACTION_LINK_UNRESOLVED",
    field: "actionId",
  });
});

test("DP-N03 rejects unsupported decisions and non-monotonic approval timestamps", async () => {
  const source = (await fixtureBatch("npc-five-records.batch.json")).records[2]!;
  assert.deepEqual(new NpcDomainMapper().map(changedPayload(source, { decision: "assumed" })), {
    kind: "fail",
    mappingId: "DP-N03",
    failureCode: "MAPPING_ENUM_UNSUPPORTED",
    field: "decision",
  });
  const early = changedPayload(source, { respondedAt: "2026-08-17T08:03:59.999Z" });
  assert.deepEqual(new NpcDomainMapper().map(early), {
    kind: "fail",
    mappingId: "DP-N03",
    failureCode: "MAPPING_REQUIRED_FIELD_MISSING",
    field: "respondedAt",
  });
});

test("DP-N04 and DP-N05 preserve basis and source observation semantics", async () => {
  const records = (await fixtureBatch("npc-five-records.batch.json")).records;
  const mapper = new NpcDomainMapper();
  const recovery = mapper.map(records[3]!);
  const freshness = mapper.map(records[4]!);
  assert.equal(recovery.kind, "produce");
  assert.equal(freshness.kind, "produce");
  if (recovery.kind !== "produce" || freshness.kind !== "produce") return;
  assert.equal(recovery.targetFields["selected_basis_id"], "basis-recovery");
  assert.equal(recovery.targetFields["preempted_basis_id"], "basis-preempted");
  assert.equal(freshness.targetFields["observed_at"], "2026-08-17T08:03:00.000Z");
  assert.equal(freshness.targetFields["checked_at"], "2026-08-17T08:03:00.010Z");
});

test("complete manifest freezes 10/10 documents and every NPC output validates its schema", async () => {
  const root = path.join(process.cwd(), "integrations/domain-projection/mappings/v1");
  const manifest = JSON.parse(
    await readFile(path.join(root, "mapping-manifest.json"), "utf8"),
  ) as MappingManifest;
  assert.equal(manifest.mappingCount, 10);
  assert.equal(manifest.complete, true);
  assert.deepEqual(
    manifest.mappings.map((entry) => entry.mappingId),
    ["DP-C01", "DP-C02", "DP-C03", "DP-C04", "DP-C05", ...NPC_MAPPING_IDS],
  );
  const decisions = (await fixtureBatch("npc-five-records.batch.json")).records.map((record) =>
    new NpcDomainMapper().map(record),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("date-time", { type: "string", validate: (value: string) => !Number.isNaN(Date.parse(value)) });
  ajv.addFormat("uuid", { type: "string", validate: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value) });
  for (const [index, entry] of manifest.mappings.slice(5).entries()) {
    const document = JSON.parse(await readFile(path.join(root, entry.documentPath), "utf8")) as MappingDocument;
    const schema = JSON.parse(await readFile(path.join(root, entry.payloadSchemaPath), "utf8"));
    assert.equal(hashCanonicalDomainProjectionJson(document), entry.documentHash);
    assert.equal(hashCanonicalDomainProjectionJson(schema), entry.payloadSchemaHash);
    assert.equal(document.mappingId, entry.mappingId);
    assert.equal(document.source.table.startsWith("sdar_npc.domain_"), true);
    assert.equal(document.status, "disabled");
    const decision = decisions[index]!;
    assert.equal(decision.kind, "produce");
    if (decision.kind === "produce") {
      const validate = ajv.compile(schema);
      assert.equal(validate(decision.targetFields), true, JSON.stringify(validate.errors));
    }
  }
});

test("Commander input is a registered skip in the NPC mapper", async () => {
  const commander = (await fixtureBatch("commander-five-records.batch.json")).records[0]!;
  assert.deepEqual(new NpcDomainMapper().map(commander), {
    kind: "skip",
    reasonCode: "SOURCE_NOT_APPLICABLE",
  });
  assert.equal(new CommanderDomainMapper().map(commander).kind, "produce");
});

function changedPayload(
  source: DomainSourceRecord,
  change: Readonly<Record<string, unknown>>,
): DomainSourceRecord {
  const payload = { ...source.payload, ...change };
  return { ...source, payload, payloadHash: createDomainSourcePayloadHash(payload) };
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
