import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, unknown>;

const check = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((argument: string) => argument !== "--check")) {
  fail("SDAR_CLICKHOUSE_CONTRACT_ARGUMENT_INVALID");
}

const root = process.cwd();
const integrationRoot = path.resolve("integrations/sdar-clickhouse/1.5.1-rc.2");
const snapshotRoot = path.resolve(
  "reports/clickhouse/192.168.1.7-schema-snapshot/domain-projection-rc2-preflight",
);

const contract = await readJson(path.join(integrationRoot, "contract.json"));
const tables = await readArray(path.join(snapshotRoot, "tables.json"));
const columns = await readArray(path.join(snapshotRoot, "columns.json"));
const comparison = await readJson(path.join(snapshotRoot, "descriptor-comparison.json"));
const snapshotManifest = await readJson(path.join(snapshotRoot, "snapshot-manifest.json"));

assertContractShape(contract);
assertEqual(requiredNumber(comparison, "tableDiffCount"), 0, "TABLE_DIFF_NONZERO");
assertEqual(requiredNumber(comparison, "columnDiffCount"), 0, "COLUMN_DIFF_NONZERO");
assertEqual(requiredString(comparison, "result"), "PASS", "DESCRIPTOR_COMPARISON_FAILED");

const requiredNames = requiredObjectNames(contract);
const tableByName = new Map(
  tables.map((row) => [qualifiedTable(row), row] as const),
);
const missing = requiredNames.filter((name) => !tableByName.has(name));
if (missing.length > 0) fail(`SDAR_CLICKHOUSE_CONTRACT_OBJECT_MISSING:${missing.join(",")}`);

const requiredDescriptors = {
  schemaVersion: 1,
  observedAt: requiredString(snapshotManifest, "observedAt"),
  objects: requiredNames.map((name) => {
    const table = tableByName.get(name);
    if (table === undefined) fail(`SDAR_CLICKHOUSE_CONTRACT_OBJECT_MISSING:${name}`);
    const [database, tableName] = splitName(name);
    return {
      name,
      table,
      columns: columns.filter(
        (row) => row["database"] === database && row["table"] === tableName,
      ),
    };
  }),
};

const sourceFiles = [
  "columns.json",
  "databases.json",
  "descriptor-comparison.json",
  "release.json",
  "server.json",
  "show-create.json",
  "snapshot-manifest.json",
  "tables.json",
  "view-analysis.json",
];
const sourceFileLocks = await Promise.all(
  sourceFiles.map(async (name) => {
    const bytes = await readFile(path.join(snapshotRoot, name));
    return {path: name, bytes: bytes.byteLength, byteSha256: byteSha256(bytes)};
  }),
);

const live = requiredObject(comparison, "live");
const expected = requiredObject(comparison, "expected");
const sourceLock = {
  schemaVersion: 1,
  releaseVersion: "1.5.1-rc.2",
  migrationRange: "00..26",
  package: {
    filename: "SDAR_ClickHouse_Schema_1.5.1_RC2_Clean_Rebuild.zip",
    sha256: "99fd093201cecbd97eec8579d316d3d96b155330feef9a8a8bf57b1d1ac51496",
    allSqlSha256: "d1989414f95cc333458fc56494bc8dff1b2e24c84229769857b58f588987d3e7",
    referenceEngine: "ClickHouse local 25.3.14.14",
  },
  observedAt: requiredString(snapshotManifest, "observedAt"),
  liveEngine: "ClickHouse 24.10.2.1",
  schemaContractHash:
    "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8",
  releaseDescriptorHash:
    "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335",
  descriptorLock: {
    objectCount: requiredNumber(live, "objects"),
    columnCount: requiredNumber(live, "columns"),
    tableDescriptorHash: requiredString(live, "tableDescriptorHash"),
    columnDescriptorHash: requiredString(live, "columnDescriptorHash"),
    expectedTableDescriptorHash: requiredString(expected, "tableDescriptorHash"),
    expectedColumnDescriptorHash: requiredString(expected, "columnDescriptorHash"),
    tableDiffCount: 0,
    columnDiffCount: 0,
  },
  sourceSnapshot: path.relative(root, snapshotRoot),
  files: sourceFileLocks,
};

const generated = new Map<string, Buffer>();
generated.set("required-object-descriptors.json", jsonBuffer(requiredDescriptors));
generated.set("source-lock.json", jsonBuffer(sourceLock));

const manifestInputs = ["README.md", "contract.json", "verify.sql"];
const manifestFiles = await Promise.all(
  manifestInputs.map(async (name) => {
    const bytes = await readFile(path.join(integrationRoot, name));
    return {path: name, bytes: bytes.byteLength, byteSha256: byteSha256(bytes)};
  }),
);
for (const [name, bytes] of generated) {
  manifestFiles.push({path: name, bytes: bytes.byteLength, byteSha256: byteSha256(bytes)});
}
manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
generated.set(
  "contract-manifest.json",
  jsonBuffer({
    schemaVersion: 1,
    releaseVersion: "1.5.1-rc.2",
    assets: manifestFiles,
  }),
);

if (check) {
  const drift: string[] = [];
  for (const [name, expectedBytes] of generated) {
    let actual: Buffer;
    try {
      actual = await readFile(path.join(integrationRoot, name));
    } catch {
      drift.push(`missing ${name}`);
      continue;
    }
    if (!actual.equals(expectedBytes)) drift.push(`content ${name}`);
  }
  if (drift.length > 0) fail(`SDAR_CLICKHOUSE_CONTRACT_DRIFT:${drift.join(";")}`);
} else {
  for (const [name, bytes] of generated) {
    await writeFile(path.join(integrationRoot, name), bytes, {mode: 0o644});
  }
}

console.log(
  JSON.stringify({
    event: "sdar_clickhouse_contract.verified",
    action: check ? "checked" : "synced",
    releaseVersion: "1.5.1-rc.2",
    objects: tables.length,
    columns: columns.length,
    requiredObjects: requiredNames.length,
    tableDiffCount: 0,
    columnDiffCount: 0,
  }),
);

function requiredObjectNames(value: JsonObject): string[] {
  const names = new Set<string>();
  for (const field of ["sources", "episodeSeals", "targets", "governance"] as const) {
    for (const entry of requiredObjectArray(value, field)) {
      names.add(`${requiredString(entry, "database")}.${requiredString(entry, "table")}`);
    }
  }
  for (const view of requiredStringArray(value, "views")) names.add(view);
  return [...names].sort();
}

function assertContractShape(value: JsonObject): void {
  assertEqual(requiredNumber(value, "schemaVersion"), 1, "SCHEMA_VERSION_INVALID");
  assertEqual(requiredStringArray(value, "databases").length, 6, "DATABASE_COUNT_INVALID");
  assertEqual(requiredObjectArray(value, "sources").length, 10, "SOURCE_COUNT_INVALID");
  assertEqual(requiredObjectArray(value, "episodeSeals").length, 2, "SEAL_COUNT_INVALID");
  assertEqual(requiredObjectArray(value, "projections").length, 10, "PROJECTION_COUNT_INVALID");
  assertEqual(requiredObjectArray(value, "projectionSets").length, 4, "SET_COUNT_INVALID");
  assertEqual(requiredObjectArray(value, "targets").length, 6, "TARGET_COUNT_INVALID");
  assertEqual(requiredObjectArray(value, "governance").length, 6, "GOVERNANCE_COUNT_INVALID");
  assertEqual(requiredStringArray(value, "views").length, 7, "VIEW_COUNT_INVALID");
}

function qualifiedTable(row: JsonObject): string {
  return `${requiredString(row, "database")}.${requiredString(row, "name")}`;
}

function splitName(value: string): [string, string] {
  const parts = value.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    fail("SDAR_CLICKHOUSE_CONTRACT_OBJECT_NAME_INVALID");
  }
  return [parts[0], parts[1]];
}

async function readJson(filename: string): Promise<JsonObject> {
  const value: unknown = JSON.parse(await readFile(filename, "utf8"));
  if (!isObject(value)) fail(`SDAR_CLICKHOUSE_CONTRACT_JSON_INVALID:${filename}`);
  return value;
}

async function readArray(filename: string): Promise<JsonObject[]> {
  const value: unknown = JSON.parse(await readFile(filename, "utf8"));
  if (!Array.isArray(value) || !value.every(isObject)) {
    fail(`SDAR_CLICKHOUSE_CONTRACT_JSON_INVALID:${filename}`);
  }
  return value;
}

function requiredObject(value: JsonObject, field: string): JsonObject {
  const candidate = value[field];
  if (!isObject(candidate)) fail(`SDAR_CLICKHOUSE_CONTRACT_FIELD_INVALID:${field}`);
  return candidate;
}

function requiredObjectArray(value: JsonObject, field: string): JsonObject[] {
  const candidate = value[field];
  if (!Array.isArray(candidate) || !candidate.every(isObject)) {
    fail(`SDAR_CLICKHOUSE_CONTRACT_FIELD_INVALID:${field}`);
  }
  return candidate;
}

function requiredStringArray(value: JsonObject, field: string): string[] {
  const candidate = value[field];
  if (!Array.isArray(candidate) || !candidate.every((entry) => typeof entry === "string")) {
    fail(`SDAR_CLICKHOUSE_CONTRACT_FIELD_INVALID:${field}`);
  }
  return candidate;
}

function requiredString(value: JsonObject, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") fail(`SDAR_CLICKHOUSE_CONTRACT_FIELD_INVALID:${field}`);
  return candidate;
}

function requiredNumber(value: JsonObject, field: string): number {
  const candidate = value[field];
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) {
    fail(`SDAR_CLICKHOUSE_CONTRACT_FIELD_INVALID:${field}`);
  }
  return candidate;
}

function assertEqual(actual: unknown, expected: unknown, code: string): void {
  if (actual !== expected) fail(`SDAR_CLICKHOUSE_CONTRACT_${code}`);
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function byteSha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string): never {
  throw Object.assign(new Error(code), {code});
}
