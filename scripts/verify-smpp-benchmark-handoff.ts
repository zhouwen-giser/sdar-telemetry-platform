import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";

import {
  decideMcpProviderConsumption,
  MCP_PROVIDER_READINESS_STATUSES,
  SMPP_BENCHMARK_HANDOFF_CONTRACT,
  type McpProviderReadinessStatus,
} from "../integrations/sdar-benchmark-server/mcp-provider-telemetry/v1/consumer-contract.js";
import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";

type Json = Record<string, unknown>;
const root = path.resolve(
  "integrations/sdar-benchmark-server/mcp-provider-telemetry/v1",
);
const live = process.argv.includes("--live");

try {
  const manifest = await readJson("handoff-manifest.json");
  exactKeys(manifest, [
    "schemaVersion",
    "contract",
    "sourceRelease",
    "sourceMappingVersion",
    "sourceMain",
    "companionHead",
    "companionPullRequest",
    "clickHouseRelease",
    "migrationRange",
    "schemaContractHash",
    "releaseDescriptorHash",
    "targets",
    "views",
    "readinessStatuses",
    "assets",
  ]);
  equal(
    manifest.contract,
    SMPP_BENCHMARK_HANDOFF_CONTRACT,
    "SMPP_HANDOFF_CONTRACT_DRIFT",
  );
  equal(manifest.sourceRelease, "1.1.0", "SMPP_HANDOFF_SOURCE_RELEASE_DRIFT");
  equal(manifest.sourceMappingVersion, 4, "SMPP_HANDOFF_MAPPING_VERSION_DRIFT");
  equal(manifest.clickHouseRelease, "1.5.1-rc.2", "SMPP_HANDOFF_RELEASE_DRIFT");
  equal(manifest.migrationRange, "00..26", "SMPP_HANDOFF_MIGRATION_DRIFT");
  equal(
    manifest.schemaContractHash,
    "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8",
    "SMPP_HANDOFF_SCHEMA_HASH_DRIFT",
  );
  equal(
    manifest.releaseDescriptorHash,
    "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335",
    "SMPP_HANDOFF_DESCRIPTOR_HASH_DRIFT",
  );
  deepEqual(
    manifest.readinessStatuses,
    [...MCP_PROVIDER_READINESS_STATUSES],
    "SMPP_HANDOFF_STATUS_DRIFT",
  );

  const assets = objectArray(manifest.assets, "SMPP_HANDOFF_ASSETS_INVALID");
  const expectedAssets = [
    "README.md",
    "benchmark-evidence-mapping.csv",
    "consumer-contract.ts",
    "fixtures/readiness.json",
    "queries.sql",
    "readiness-contract.json",
    "reason-codes.json",
    "verify.mjs",
    "view-contracts.json",
  ];
  deepEqual(
    assets.map((asset) => string(asset.path)).sort(),
    expectedAssets,
    "SMPP_HANDOFF_ASSET_CLOSURE_DRIFT",
  );
  for (const asset of assets) await verifyAsset(asset);

  const readiness = await readJson("readiness-contract.json");
  deepEqual(
    readiness.statuses,
    [...MCP_PROVIDER_READINESS_STATUSES],
    "SMPP_HANDOFF_READINESS_DRIFT",
  );
  const invariants = object(readiness.invariants, "SMPP_HANDOFF_INVARIANTS_INVALID");
  equal(invariants.goalSuccessProven, false, "SMPP_HANDOFF_GOAL_PROMOTION_FORBIDDEN");
  equal(
    invariants.physicalSuccessProven,
    false,
    "SMPP_HANDOFF_PHYSICAL_PROMOTION_FORBIDDEN",
  );
  equal(
    invariants.queryPollingIsProjection,
    false,
    "SMPP_HANDOFF_QUERY_POLLING_FORBIDDEN",
  );

  const reasonCatalog = await readJson("reason-codes.json");
  const reasons = objectArray(reasonCatalog.reasonCodes, "SMPP_HANDOFF_REASONS_INVALID");
  if (reasons.length !== 15 || new Set(reasons.map((entry) => string(entry.code))).size !== 15) {
    fail("SMPP_HANDOFF_REASON_COUNT_DRIFT");
  }

  const fixtures = await readJson("fixtures/readiness.json");
  const cases = objectArray(fixtures.cases, "SMPP_HANDOFF_FIXTURES_INVALID");
  if (cases.length !== 5) fail("SMPP_HANDOFF_FIXTURE_COUNT_DRIFT");
  for (const fixture of cases) {
    const decision = decideMcpProviderConsumption(
      boolean(fixture.required),
      string(fixture.status) as McpProviderReadinessStatus,
    );
    deepEqual(decision, fixture.expected, "SMPP_HANDOFF_CONSUMER_SEMANTICS_DRIFT");
  }

  const mapping = await readFile(path.join(root, "benchmark-evidence-mapping.csv"), "utf8");
  const mappingLines = mapping.trimEnd().split("\n");
  if (mappingLines.length !== 10) fail("SMPP_HANDOFF_EVIDENCE_MAPPING_DRIFT");
  for (const required of ["M7", "M10", "M11", "M13", "M14", "HG4", "HG7", "F4", "F5"]) {
    if (!mappingLines.some((line: string) => line.startsWith(`${required},`))) {
      fail("SMPP_HANDOFF_EVIDENCE_MAPPING_DRIFT");
    }
  }

  const viewContracts = await readJson("view-contracts.json");
  const objects = objectArray(viewContracts.objects, "SMPP_HANDOFF_OBJECTS_INVALID");
  if (objects.length !== 9 || new Set(objects.map((entry) => string(entry.name))).size !== 9) {
    fail("SMPP_HANDOFF_OBJECT_COUNT_DRIFT");
  }
  const queries = await readFile(path.join(root, "queries.sql"), "utf8");
  const referenced = [
    ...queries.matchAll(/\bFROM\s+(sdar_core\.[a-z0-9_]+)/giu),
  ].map((match) => match[1]);
  deepEqual(referenced, objects.map((entry) => string(entry.name)), "SMPP_HANDOFF_QUERY_OBJECT_DRIFT");
  if (/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|SYSTEM)\b/iu.test(queries)) {
    fail("SMPP_HANDOFF_QUERY_MUTATION_FORBIDDEN");
  }
  if (!queries.includes("{tenantId:String}") || !queries.includes("LIMIT")) {
    fail("SMPP_HANDOFF_QUERY_BOUND_MISSING");
  }
  const source = await readFile(path.join(root, "consumer-contract.ts"), "utf8");
  if (/\b(?:calculateScore|metricScore|benchmarkScore|fatalScore)\b/u.test(source)) {
    fail("SMPP_HANDOFF_SCORING_FORBIDDEN");
  }

  if (live) await verifyLive(manifest, objects);
  console.log(
    `SMPP_BENCHMARK_HANDOFF_${live ? "LIVE" : "STATIC"}_PASS assets=9 objects=9 fixtures=5 reasons=15 mappings=9`,
  );
} catch (error) {
  const candidate =
    error !== null && typeof error === "object" && "code" in error
      ? (error as {code?: unknown}).code
      : error instanceof Error
        ? error.message
        : undefined;
  const code =
    typeof candidate === "string" && /^[A-Z0-9_]+$/u.test(candidate)
      ? candidate
      : "SMPP_BENCHMARK_HANDOFF_VERIFY_FAILED";
  console.error(code);
  process.exitCode = 1;
}

async function verifyAsset(asset: Json): Promise<void> {
  const relative = string(asset.path);
  if (path.isAbsolute(relative) || relative.includes("..") || relative.includes("\\")) {
    fail("SMPP_HANDOFF_ASSET_PATH_INVALID");
  }
  const absolute = path.join(root, relative);
  const body = await readFile(absolute);
  if (!(await stat(absolute)).isFile()) fail("SMPP_HANDOFF_ASSET_NOT_FILE");
  equal(asset.bytes, body.length, "SMPP_HANDOFF_ASSET_SIZE_DRIFT");
  equal(
    asset.byteSha256,
    `sha256:${createHash("sha256").update(body).digest("hex")}`,
    "SMPP_HANDOFF_ASSET_HASH_DRIFT",
  );
}

async function verifyLive(manifest: Json, objects: Json[]): Promise<void> {
  const client = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));
  const release = firstJsonRow(
    await client.query(
      "SELECT release_version,migration_range,schema_contract_hash,release_descriptor_hash FROM sdar_meta.v_schema_contract_release_current LIMIT 1 FORMAT JSON",
      {readonly: 2, maxResultRows: 1},
    ),
  );
  for (const [field, expected] of [
    ["release_version", manifest.clickHouseRelease],
    ["migration_range", manifest.migrationRange],
    ["schema_contract_hash", manifest.schemaContractHash],
    ["release_descriptor_hash", manifest.releaseDescriptorHash],
  ] as const) {
    equal(release[field], expected, "SMPP_HANDOFF_LIVE_RELEASE_DRIFT");
  }
  for (const contract of objects) {
    const name = string(contract.name);
    if (!/^sdar_core\.[a-z0-9_]+$/u.test(name)) fail("SMPP_HANDOFF_LIVE_OBJECT_INVALID");
    const fields = stringArray(contract.requiredFields);
    const result = JSON.parse(
      await client.query(`SELECT ${fields.join(",")} FROM ${name} LIMIT 0 FORMAT JSON`, {
        readonly: 2,
        maxResultRows: 1,
      }),
    ) as Json;
    deepEqual(
      objectArray(result.meta, "SMPP_HANDOFF_LIVE_META_INVALID").map((field) =>
        string(field.name),
      ),
      fields,
      "SMPP_HANDOFF_LIVE_COLUMN_DRIFT",
    );
  }
}

function firstJsonRow(text: string): Json {
  const rows = objectArray((JSON.parse(text) as Json).data, "SMPP_HANDOFF_LIVE_DATA_INVALID");
  if (rows.length !== 1) fail("SMPP_HANDOFF_LIVE_RELEASE_MISSING");
  return rows[0]!;
}
async function readJson(relative: string): Promise<Json> {
  return JSON.parse(await readFile(path.join(root, relative), "utf8")) as Json;
}
function object(value: unknown, code: string): Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Json;
}
function objectArray(value: unknown, code: string): Json[] {
  if (!Array.isArray(value) || value.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry))) fail(code);
  return value as Json[];
}
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) fail("SMPP_HANDOFF_STRING_ARRAY_INVALID");
  return value as string[];
}
function string(value: unknown): string {
  if (typeof value !== "string" || value === "") fail("SMPP_HANDOFF_STRING_INVALID");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail("SMPP_HANDOFF_BOOLEAN_INVALID");
  return value;
}
function exactKeys(value: Json, expected: string[]): void {
  deepEqual(Object.keys(value).sort(), [...expected].sort(), "SMPP_HANDOFF_MANIFEST_SHAPE_INVALID");
}
function equal(actual: unknown, expected: unknown, code: string): void {
  if (actual !== expected) fail(code);
}
function deepEqual(actual: unknown, expected: unknown, code: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code);
}
function fail(code: string): never {
  throw new Error(code);
}
