import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

type JsonObject = Record<string, unknown>;

const root = path.resolve("integrations/sdar-clickhouse/1.5.1-rc.2");

test("RC2 integration freezes the exact release and complete Domain object families", async () => {
  const contract = await readJson("contract.json");
  const release = object(contract, "release");
  assert.equal(release["serverVersion"], "24.10.2.1");
  assert.equal(release["releaseVersion"], "1.5.1-rc.2");
  assert.equal(release["migrationRange"], "00..26");
  assert.equal(
    release["schemaContractHash"],
    "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8",
  );
  assert.equal(
    release["releaseDescriptorHash"],
    "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335",
  );
  assert.equal(objects(contract, "sources").length, 10);
  assert.equal(objects(contract, "episodeSeals").length, 2);
  assert.equal(objects(contract, "projections").length, 10);
  assert.equal(objects(contract, "projectionSets").length, 4);
  assert.equal(objects(contract, "targets").length, 6);
  assert.equal(objects(contract, "governance").length, 6);
  assert.equal(strings(contract, "views").length, 7);
  assert.equal(release["activeDomainProjectionCount"], 0);
});

test("RC2 source lock contains no near-name legacy alias", async () => {
  const contract = await readJson("contract.json");
  const sources = objects(contract, "sources");
  const exactTables = sources.map((entry) => `${entry["database"]}.${entry["table"]}`);
  assert.equal(new Set(exactTables).size, 10);
  for (const entry of sources) {
    assert.match(String(entry["table"]), /^domain_[a-z0-9_]+_source_v1$/u);
    assert.equal(entry["version"], "1");
  }
  const forbiddenNearNames = [
    "sdar_commander.action_record",
    "sdar_commander.mcp_call_detail",
    "sdar_commander.receipt_record",
    "sdar_commander.capability_track_detail",
    "sdar_commander.recovery_record",
    "sdar_commander.state_snapshot",
    "sdar_npc.mission_tool_call_detail",
    "sdar_npc.hmi_approval_detail",
    "sdar_npc.preemption_detail",
    "sdar_npc.blackboard_snapshot_detail",
  ];
  assert.equal(exactTables.some((table) => forbiddenNearNames.includes(table)), false);
});

test("required descriptors cover every frozen object and every governance v2 column", async () => {
  const contract = await readJson("contract.json");
  const descriptorDocument = await readJson("required-object-descriptors.json");
  const descriptors = objects(descriptorDocument, "objects");
  assert.equal(descriptors.length, 31);
  const byName = new Map(descriptors.map((entry) => [String(entry["name"]), entry]));

  for (const governance of objects(contract, "governance")) {
    const name = `${governance["database"]}.${governance["table"]}`;
    const descriptor = byName.get(name);
    assert(descriptor, name);
    const columnNames = new Set(objects(descriptor, "columns").map((entry) => entry["name"]));
    for (const required of strings(governance, "requiredV2Columns")) {
      assert(columnNames.has(required), `${name}.${required}`);
    }
  }
  for (const view of strings(contract, "views")) assert(byName.has(view), view);
});

test("RC2 source and asset manifests are byte-locked and record a zero descriptor diff", async () => {
  const sourceLock = await readJson("source-lock.json");
  const descriptorLock = object(sourceLock, "descriptorLock");
  assert.equal(descriptorLock["objectCount"], 472);
  assert.equal(descriptorLock["columnCount"], 15949);
  assert.equal(descriptorLock["tableDiffCount"], 0);
  assert.equal(descriptorLock["columnDiffCount"], 0);

  const manifest = await readJson("contract-manifest.json");
  const assets = objects(manifest, "assets");
  assert.equal(assets.length, 5);
  for (const asset of assets) {
    const name = String(asset["path"]);
    const bytes = await readFile(path.join(root, name));
    assert.equal(bytes.byteLength, asset["bytes"], name);
    assert.equal(sha256(bytes), asset["byteSha256"], name);
  }
});

async function readJson(name: string): Promise<JsonObject> {
  const value: unknown = JSON.parse(await readFile(path.join(root, name), "utf8"));
  assert(isObject(value), name);
  return value;
}

function object(value: JsonObject, field: string): JsonObject {
  const candidate = value[field];
  assert(isObject(candidate), field);
  return candidate;
}

function objects(value: JsonObject, field: string): JsonObject[] {
  const candidate = value[field];
  assert(Array.isArray(candidate) && candidate.every(isObject), field);
  return candidate;
}

function strings(value: JsonObject, field: string): string[] {
  const candidate = value[field];
  assert(Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string"), field);
  return candidate;
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
