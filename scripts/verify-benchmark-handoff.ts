import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";

import {
  decideDomainConsumption,
  DOMAIN_HANDOFF_CONTRACT,
  DOMAIN_READINESS_STATUSES,
  type BenchmarkProfile,
  type DomainReadinessStatus,
} from "../integrations/sdar-benchmark-server/domain-projection/v1/consumer-contract.js";
import {
  ClickHouseClient,
  configFromEnv,
} from "../packages/telemetry-clickhouse/src/index.js";

type Json = Record<string, unknown>;
const root = path.resolve("integrations/sdar-benchmark-server/domain-projection/v1");
const live = process.argv.includes("--live");

try {
  const manifest = await readJson("handoff-manifest.json");
  exactKeys(manifest, ["schemaVersion", "contract", "consumerBaseline", "clickHouseRelease", "migrationRange", "schemaContractHash", "releaseDescriptorHash", "catalog", "readinessStatuses", "assets"]);
  equal(manifest.contract, DOMAIN_HANDOFF_CONTRACT, "HANDOFF_CONTRACT_DRIFT");
  equal(manifest.clickHouseRelease, "1.5.1-rc.2", "HANDOFF_RELEASE_DRIFT");
  equal(manifest.schemaContractHash, "sha256:78da6e9e511b7714b15a4f6ef5f2ba54578880493e2aa264f433ff1595a1d7b8", "HANDOFF_SCHEMA_HASH_DRIFT");
  equal(manifest.releaseDescriptorHash, "sha256:1610cf2a4cc9450193dd70abf7a516f0ea4792099ed0f34dcf2fad44d094b335", "HANDOFF_DESCRIPTOR_HASH_DRIFT");
  deepEqual(manifest.readinessStatuses, [...DOMAIN_READINESS_STATUSES], "HANDOFF_STATUS_DRIFT");

  const assets = objectArray(manifest.assets, "HANDOFF_ASSETS_INVALID");
  const expectedPaths = ["README.md", "catalog.json", "consumer-contract.ts", "fixtures/readiness.json", "queries.sql", "readiness-contract.json", "verify.mjs", "view-contracts.json"];
  deepEqual(assets.map((asset) => string(asset.path)).sort(), expectedPaths, "HANDOFF_ASSET_CLOSURE_DRIFT");
  for (const asset of assets) {
    const relative = string(asset.path);
    if (path.isAbsolute(relative) || relative.includes("..") || relative.includes("\\")) fail("HANDOFF_ASSET_PATH_INVALID");
    const absolute = path.join(root, relative);
    const body = await readFile(absolute);
    const metadata = await stat(absolute);
    if (!metadata.isFile()) fail("HANDOFF_ASSET_NOT_FILE");
    equal(asset.bytes, body.length, "HANDOFF_ASSET_SIZE_DRIFT");
    equal(asset.byteSha256, `sha256:${createHash("sha256").update(body).digest("hex")}`, "HANDOFF_ASSET_HASH_DRIFT");
  }

  const catalog = await readJson("catalog.json");
  count(catalog.sources, 10, "HANDOFF_SOURCE_COUNT_DRIFT");
  count(catalog.episodeSeals, 2, "HANDOFF_SEAL_COUNT_DRIFT");
  count(catalog.projections, 10, "HANDOFF_PROJECTION_COUNT_DRIFT");
  count(catalog.targets, 6, "HANDOFF_TARGET_COUNT_DRIFT");
  count(catalog.projectionSets, 4, "HANDOFF_SET_COUNT_DRIFT");
  const sources = objectArray(catalog.sources, "HANDOFF_SOURCES_INVALID");
  if (new Set(sources.map((source) => string(source.object))).size !== 10) fail("HANDOFF_SOURCE_DUPLICATE");
  if (sources.some((source) => !string(source.object).includes(".domain_") || !string(source.object).endsWith("_source_v1"))) fail("HANDOFF_NEAR_NAME_SOURCE_FORBIDDEN");
  const projections = objectArray(catalog.projections, "HANDOFF_PROJECTIONS_INVALID");
  if (new Set(projections.map((entry) => string(entry.projectionId))).size !== 10) fail("HANDOFF_PROJECTION_DUPLICATE");
  if (new Set(projections.map((entry) => string(entry.mappingId))).size !== 10) fail("HANDOFF_MAPPING_DUPLICATE");

  const readiness = await readJson("readiness-contract.json");
  deepEqual(readiness.statuses, [...DOMAIN_READINESS_STATUSES], "HANDOFF_READINESS_DRIFT");
  const fixtures = await readJson("fixtures/readiness.json");
  const cases = objectArray(fixtures.cases, "HANDOFF_FIXTURES_INVALID");
  if (cases.length !== 5) fail("HANDOFF_FIXTURE_COUNT_DRIFT");
  for (const item of cases) {
    const actual = decideDomainConsumption(
      string(item.profile) as BenchmarkProfile,
      string(item.status) as DomainReadinessStatus,
    );
    deepEqual(actual, item.expected, "HANDOFF_CONSUMER_SEMANTICS_DRIFT");
  }

  const viewContracts = await readJson("view-contracts.json");
  const views = objectArray(viewContracts.views, "HANDOFF_VIEWS_INVALID");
  if (views.length !== 7 || new Set(views.map((view) => string(view.name))).size !== 7) fail("HANDOFF_VIEW_COUNT_DRIFT");
  const factIndex = views.find((view) => view.name === "sdar_embodied.v_episode_domain_fact_index");
  if (factIndex === undefined) fail("HANDOFF_FACT_INDEX_MISSING");
  for (const field of ["projection_id", "projection_version", "source_content_hash", "target_content_hash", "record_id"]) {
    if (!stringArray(factIndex.requiredFields).includes(field)) fail("HANDOFF_FACT_PROVENANCE_FIELD_MISSING");
  }

  const queries = await readFile(path.join(root, "queries.sql"), "utf8");
  const referencedViews = [...queries.matchAll(/\bFROM\s+([a-z_]+\.[a-z0-9_]+)/giu)].map((match) => match[1]);
  deepEqual(referencedViews, views.map((view) => string(view.name)), "HANDOFF_QUERY_VIEW_DRIFT");
  if (/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|SYSTEM)\b/iu.test(queries)) fail("HANDOFF_QUERY_MUTATION_FORBIDDEN");
  if (!queries.includes("{tenantId:String}") || !queries.includes("LIMIT")) fail("HANDOFF_QUERY_BOUND_MISSING");

  if (live) await verifyLive(manifest, views);
  console.log(`BENCHMARK_HANDOFF_${live ? "LIVE" : "STATIC"}_PASS assets=${assets.length} sources=10 projections=10 targets=6 sets=4 views=7 fixtures=5`);
} catch (error) {
  const candidate = error !== null && typeof error === "object" && "code" in error
    ? (error as {code?: unknown}).code
    : error instanceof Error
      ? error.message
      : undefined;
  const code = typeof candidate === "string" && /^[A-Z0-9_]+$/u.test(candidate)
    ? candidate
    : "BENCHMARK_HANDOFF_VERIFY_FAILED";
  console.error(code);
  process.exitCode = 1;
}

async function verifyLive(manifest: Json, views: Json[]): Promise<void> {
  const client = new ClickHouseClient(configFromEnv("CLICKHOUSE_QUERY_"));
  const releaseText = await client.query(
    "SELECT release_version,schema_contract_hash,release_descriptor_hash FROM sdar_meta.v_schema_contract_release_current LIMIT 1 FORMAT JSON",
    {readonly: 2, maxResultRows: 1},
  );
  const release = firstJsonRow(releaseText);
  equal(release.release_version, manifest.clickHouseRelease, "HANDOFF_LIVE_RELEASE_DRIFT");
  equal(release.schema_contract_hash, manifest.schemaContractHash, "HANDOFF_LIVE_SCHEMA_DRIFT");
  equal(release.release_descriptor_hash, manifest.releaseDescriptorHash, "HANDOFF_LIVE_DESCRIPTOR_DRIFT");
  for (const view of views) {
    const name = string(view.name);
    if (!/^(?:sdar_meta|sdar_mart|sdar_embodied)\.[a-z0-9_]+$/u.test(name)) fail("HANDOFF_LIVE_VIEW_INVALID");
    const requiredFields = stringArray(view.requiredFields);
    const response = JSON.parse(await client.query(
      `SELECT ${requiredFields.join(",")} FROM ${name} LIMIT 0 FORMAT JSON`,
      {readonly: 2, maxResultRows: 1},
    )) as Json;
    const meta = objectArray(response.meta, "HANDOFF_LIVE_META_INVALID");
    deepEqual(meta.map((field) => string(field.name)), requiredFields, "HANDOFF_LIVE_COLUMN_DRIFT");
  }
}

function firstJsonRow(text: string): Json {
  const document = JSON.parse(text) as Json;
  const rows = objectArray(document.data, "HANDOFF_LIVE_DATA_INVALID");
  if (rows.length !== 1) fail("HANDOFF_LIVE_RELEASE_MISSING");
  return rows[0]!;
}

async function readJson(relative: string): Promise<Json> {
  return JSON.parse(await readFile(path.join(root, relative), "utf8")) as Json;
}
function exactKeys(value: Json, expected: string[]): void { deepEqual(Object.keys(value).sort(), [...expected].sort(), "HANDOFF_MANIFEST_SHAPE_INVALID"); }
function objectArray(value: unknown, code: string): Json[] { if (!Array.isArray(value) || !value.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))) fail(code); return value as Json[]; }
function stringArray(value: unknown): string[] { if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) fail("HANDOFF_STRING_ARRAY_INVALID"); return value as string[]; }
function string(value: unknown): string { if (typeof value !== "string" || value === "") fail("HANDOFF_STRING_INVALID"); return value; }
function count(value: unknown, expected: number, code: string): void { if (!Array.isArray(value) || value.length !== expected) fail(code); }
function equal(actual: unknown, expected: unknown, code: string): void { if (actual !== expected) fail(code); }
function deepEqual(actual: unknown, expected: unknown, code: string): void { if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code); }
function fail(code: string): never { throw new Error(code); }
