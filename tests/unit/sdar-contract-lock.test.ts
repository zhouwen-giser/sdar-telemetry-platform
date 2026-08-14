import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

type JsonObject = Record<string, unknown>;

const snapshotRoot = path.resolve(
  "integrations/skill-driven-agent-runtime/v1.4.1",
);
const expectedExecutionSha = "7246c263bbb5554d01a7aa343ef6f857378e7bf4";
const expectedMainSha = "34ce7a7a43971de37566b24f969b4f0aeadec2b2";
const expectedContractSha =
  "sha256:a99f293d7c4a7aa204a3ada1b26ec4e82654d987d28336af3b0df6928a40495f";
const expectedRegistrySha =
  "sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71";

test("SDAR Evidence source lock pins Git and canonical hashes", async () => {
  const lock = await readJson(path.join(snapshotRoot, "source-lock.json"));
  assert.equal(lock["executionSha"], expectedExecutionSha);
  assert.equal(lock["mainSha"], expectedMainSha);
  assert.equal(lock["contractVersion"], "sdar.evidence/v1");
  assert.equal(lock["canonicalContractSha256"], expectedContractSha);
  assert.equal(lock["canonicalRegistrySha256"], expectedRegistrySha);

  const contract = await readJson(
    path.join(snapshotRoot, "protocol/evidence/v1/evidence-contract.json"),
  );
  const registry = await readJson(
    path.join(snapshotRoot, "schemas/evidence/v1/registry.json"),
  );
  const registryCore = Object.fromEntries(
    Object.entries(registry).filter(([key]) => key !== "registryHash"),
  );
  assert.equal(canonicalSha256(contract), expectedContractSha);
  assert.equal(canonicalSha256(registryCore), expectedRegistrySha);
});

test("SDAR Evidence contract map contains all 100 records and the 95/5 split", async () => {
  const contractMap = await readJson(path.join(snapshotRoot, "contract-map.json"));
  const counts = requiredObject(contractMap, "counts");
  const records = requiredObjectArray(contractMap, "records");
  const legacy = requiredObject(contractMap, "legacy");

  assert.deepEqual(counts, { records: 100, required: 95, diagnostic: 5 });
  assert.equal(records.length, 100);
  assert.equal(new Set(records.map((record) => record["recordType"])).size, 100);
  assert.equal(records.filter((record) => record["evaluationRole"] === "required").length, 95);
  assert.equal(records.filter((record) => record["evaluationRole"] === "diagnostic").length, 5);
  assert.equal(legacy["status"], "compatibility-only");
});

test("SDAR Evidence byte lock covers every imported source file", async () => {
  const lock = await readJson(path.join(snapshotRoot, "source-lock.json"));
  const files = requiredObjectArray(lock, "files");

  assert.equal(lock["importedFileCount"], 121);
  assert.equal(files.length, 121);
  for (const entry of files) {
    const relativePath = requiredString(entry, "path");
    const bytes = await readFile(path.join(snapshotRoot, relativePath));
    assert.equal(bytes.byteLength, entry["bytes"], relativePath);
    assert.equal(byteSha256(bytes), entry["byteSha256"], relativePath);
  }
});

async function readJson(filePath: string): Promise<JsonObject> {
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  assert(isObject(value), `${filePath} must contain an object`);
  return value;
}

function requiredObject(value: JsonObject, field: string): JsonObject {
  const candidate = value[field];
  assert(isObject(candidate), `${field} must be an object`);
  return candidate;
}

function requiredObjectArray(value: JsonObject, field: string): JsonObject[] {
  const candidate = value[field];
  assert(Array.isArray(candidate), `${field} must be an array`);
  assert(candidate.every(isObject), `${field} entries must be objects`);
  return candidate;
}

function requiredString(value: JsonObject, field: string): string {
  const candidate = value[field];
  assert.equal(typeof candidate, "string", `${field} must be a string`);
  return candidate as string;
}

function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert(Number.isFinite(value));
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  assert(isObject(value));
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function byteSha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
