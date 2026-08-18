import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalizeDomainProjectionJson,
  hashCanonicalDomainProjectionJson,
  type DomainSourceSha256,
} from "../../../packages/telemetry-contracts/src/index.js";
import type { ClickHouseQueryOptions } from "../../../packages/telemetry-clickhouse/src/index.js";
import type {
  DomainProjectionDescriptor,
  DomainProjectionMappingId,
} from "../../../packages/telemetry-projection-registry/src/domain.js";

const GOVERNANCE_OBJECTS = Object.freeze([
  "sdar_meta.projection_checkpoint",
  "sdar_meta.projection_dead_letter",
  "sdar_meta.projection_lineage",
] as const);

export type DomainSchemaPreflightResult = Readonly<{
  projectionId: string;
  projectionVersion: number;
  mappingHash: DomainSourceSha256;
  descriptorFingerprint: DomainSourceSha256;
  checkedObjects: readonly string[];
}>;

export interface DomainSchemaQueryClient {
  query(sql: string, options?: ClickHouseQueryOptions): Promise<string>;
}

type JsonObject = Record<string, unknown>;
type LockedObject = Readonly<{
  name: string;
  table: JsonObject;
  columns: readonly JsonObject[];
}>;

export class ClickHouseDomainSchemaPreflight {
  private constructor(
    private readonly clickHouse: DomainSchemaQueryClient,
    private readonly objects: ReadonlyMap<string, LockedObject>,
    private readonly mappingHashes: ReadonlyMap<DomainProjectionMappingId, DomainSourceSha256>,
  ) {}

  static async load(
    clickHouse: DomainSchemaQueryClient,
    root = path.join(process.cwd(), "integrations"),
  ): Promise<ClickHouseDomainSchemaPreflight> {
    const descriptors = await readJson(
      path.join(root, "sdar-clickhouse", "1.5.1-rc.2", "required-object-descriptors.json"),
    );
    const descriptorArray = descriptors["objects"];
    if (!Array.isArray(descriptorArray) || !descriptorArray.every(isObject)) {
      throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
    }
    const objects = new Map<string, LockedObject>();
    for (const candidate of descriptorArray) {
      const name = requiredString(candidate, "name");
      const table = requiredObject(candidate, "table");
      const columns = candidate["columns"];
      if (!Array.isArray(columns) || !columns.every(isObject) || objects.has(name)) {
        throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
      }
      objects.set(name, Object.freeze({ name, table, columns: Object.freeze(columns) }));
    }

    const manifest = await readJson(
      path.join(root, "domain-projection", "mappings", "v1", "mapping-manifest.json"),
    );
    const mappings = manifest["mappings"];
    if (!Array.isArray(mappings) || !mappings.every(isObject) || mappings.length !== 10) {
      throw preflightError("MAPPING_CONTRACT_ASSET_INVALID");
    }
    const mappingHashes = new Map<DomainProjectionMappingId, DomainSourceSha256>();
    for (const mapping of mappings) {
      const mappingId = requiredString(mapping, "mappingId") as DomainProjectionMappingId;
      const hash = requiredHash(mapping, "documentHash");
      if (mappingHashes.has(mappingId)) throw preflightError("MAPPING_CONTRACT_ASSET_INVALID");
      mappingHashes.set(mappingId, hash);
    }
    return new ClickHouseDomainSchemaPreflight(clickHouse, objects, mappingHashes);
  }

  expectedMappingHash(mappingId: DomainProjectionMappingId): DomainSourceSha256 {
    const hash = this.mappingHashes.get(mappingId);
    if (hash === undefined) throw preflightError("MAPPING_CONTRACT_ASSET_INVALID");
    return hash;
  }

  async verify(input: Readonly<{
    descriptor: DomainProjectionDescriptor;
    mappingHash: DomainSourceSha256;
  }>): Promise<DomainSchemaPreflightResult> {
    const expectedMappingHash = this.expectedMappingHash(input.descriptor.mappingId);
    if (input.mappingHash !== expectedMappingHash) throw preflightError("MAPPING_HASH_DRIFT");
    const names = Object.freeze([
      input.descriptor.sourceQualifiedTable,
      input.descriptor.targetQualifiedTable,
      ...GOVERNANCE_OBJECTS,
    ]);
    const expected = names.map((name) => {
      const locked = this.objects.get(name);
      if (locked === undefined) throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
      return locked;
    });
    const predicates = names.map((name) => {
      const [database, table] = splitName(name);
      return `(database='${database}' AND name='${table}')`;
    });
    const tableRows = await queryRows(
      this.clickHouse,
      `SELECT database,name,engine,partition_key,sorting_key,primary_key,sampling_key,storage_policy
FROM system.tables
WHERE ${predicates.join(" OR ")}
ORDER BY database,name
FORMAT JSON`,
    );
    const columnPredicates = names.map((name) => {
      const [database, table] = splitName(name);
      return `(database='${database}' AND table='${table}')`;
    });
    const columnRows = await queryRows(
      this.clickHouse,
      `SELECT database,table,position,name,type,default_kind,default_expression,compression_codec,
       is_in_partition_key,is_in_sorting_key,is_in_primary_key,is_in_sampling_key
FROM system.columns
WHERE ${columnPredicates.join(" OR ")}
ORDER BY database,table,position
FORMAT JSON`,
    );
    if (tableRows.length !== names.length) throw preflightError("SCHEMA_CONTRACT_DRIFT");
    const actualObjects = names.map((name) => {
      const [database, table] = splitName(name);
      const actualTable = tableRows.find(
        (row) => row["database"] === database && row["name"] === table,
      );
      if (actualTable === undefined) throw preflightError("SCHEMA_CONTRACT_DRIFT");
      return {
        name,
        table: actualTable,
        columns: columnRows.filter(
          (row) => row["database"] === database && row["table"] === table,
        ),
      };
    });
    for (let index = 0; index < expected.length; index += 1) {
      const locked = expected[index]!;
      const actual = actualObjects[index]!;
      if (
        canonicalizeDomainProjectionJson(actual.table) !==
          canonicalizeDomainProjectionJson(locked.table) ||
        canonicalizeDomainProjectionJson(actual.columns) !==
          canonicalizeDomainProjectionJson(locked.columns)
      ) {
        throw preflightError("SCHEMA_CONTRACT_DRIFT");
      }
    }
    return Object.freeze({
      projectionId: input.descriptor.definition.projectionId,
      projectionVersion: input.descriptor.definition.projectionVersion,
      mappingHash: input.mappingHash,
      descriptorFingerprint: hashCanonicalDomainProjectionJson(actualObjects),
      checkedObjects: names,
    });
  }
}

async function queryRows(client: DomainSchemaQueryClient, sql: string): Promise<JsonObject[]> {
  let value: unknown;
  try {
    value = JSON.parse(await client.query(sql, { readonly: 2, maxResultRows: 10_000 }));
  } catch (error) {
    if (hasCode(error)) throw error;
    throw preflightError("SCHEMA_PREFLIGHT_QUERY_FAILED");
  }
  if (!isObject(value) || !Array.isArray(value["data"]) || !value["data"].every(isObject)) {
    throw preflightError("SCHEMA_PREFLIGHT_RESPONSE_INVALID");
  }
  return value["data"];
}

async function readJson(filename: string): Promise<JsonObject> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filename, "utf8"));
  } catch {
    throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
  }
  if (!isObject(value)) throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
  return value;
}

function splitName(name: string): readonly [string, string] {
  const parts = name.split(".");
  if (
    parts.length !== 2 ||
    parts[0] === undefined ||
    parts[1] === undefined ||
    !/^[a-z][a-z0-9_]*$/u.test(parts[0]) ||
    !/^[a-z][a-z0-9_]*$/u.test(parts[1])
  ) {
    throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
  }
  return [parts[0], parts[1]];
}

function requiredObject(value: JsonObject, field: string): JsonObject {
  const candidate = value[field];
  if (!isObject(candidate)) throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
  return candidate;
}

function requiredString(value: JsonObject, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate === "") {
    throw preflightError("SCHEMA_CONTRACT_ASSET_INVALID");
  }
  return candidate;
}

function requiredHash(value: JsonObject, field: string): DomainSourceSha256 {
  const candidate = requiredString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) {
    throw preflightError("MAPPING_CONTRACT_ASSET_INVALID");
  }
  return candidate as DomainSourceSha256;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCode(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

function preflightError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
