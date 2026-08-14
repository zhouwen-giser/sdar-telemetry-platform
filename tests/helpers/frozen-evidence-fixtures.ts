import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createEvidenceRecordId,
  hashCanonicalEvidenceJson,
} from "../../packages/telemetry-contracts/src/index.js";
import type {
  EvidenceV1BatchRequest,
  EvidenceV1Record,
} from "../../packages/telemetry-types/src/index.js";

type JsonObject = Record<string, unknown>;
type JsonSchema = boolean | JsonObject;

export interface FrozenEvidenceRegistryEntry {
  readonly recordType: string;
  readonly schemaPath: string;
  readonly evaluationRole: "required" | "diagnostic";
}

interface FrozenEvidenceRegistry {
  readonly contractVersion: "sdar.evidence/v1";
  readonly records: readonly FrozenEvidenceRegistryEntry[];
}

export interface FrozenEvidenceFixtureCorpus {
  readonly schemaRoot: string;
  readonly registry: FrozenEvidenceRegistry;
  buildRecord(entry: FrozenEvidenceRegistryEntry, sequence: number): EvidenceV1Record;
  buildBatch(records?: readonly EvidenceV1Record[]): EvidenceV1BatchRequest;
}

const fixtureTimestamp = "2026-08-14T00:00:00.000Z";

export const frozenEvidenceSchemaRoot = path.join(
  process.cwd(),
  "integrations",
  "skill-driven-agent-runtime",
  "v1.4.1",
  "schemas",
  "evidence",
  "v1",
);

/**
 * Loads the frozen registry and prepares a deterministic, schema-driven fixture factory.
 * The recursive materializer deliberately throws for an unknown regex or non-local ref so
 * a contract expansion cannot silently receive a made-up value.
 */
export async function loadFrozenEvidenceFixtureCorpus(
  schemaRoot = frozenEvidenceSchemaRoot,
): Promise<FrozenEvidenceFixtureCorpus> {
  const resolvedRoot = path.resolve(schemaRoot);
  const registry = await readJson<FrozenEvidenceRegistry>(path.join(resolvedRoot, "registry.json"));
  const schemas = new Map<string, JsonObject>();
  for (const entry of registry.records) {
    schemas.set(entry.schemaPath, await readJson<JsonObject>(path.join(resolvedRoot, entry.schemaPath)));
  }

  function buildRecord(entry: FrozenEvidenceRegistryEntry, sequence: number): EvidenceV1Record {
    const schema = schemas.get(entry.schemaPath);
    if (schema === undefined) throw new Error(`Frozen schema is missing: ${entry.schemaPath}`);
    const generated = materialize(schema, {
      root: schema,
      activeRefs: new Set<string>(),
      location: entry.schemaPath,
      seed: sequence,
    });
    if (!isJsonObject(generated)) {
      throw new Error(`Frozen record schema did not materialize an object: ${entry.schemaPath}`);
    }

    generated["sourceRecordId"] = `fixture:${entry.recordType}:${String(sequence)}`;
    generated["sourceRevision"] = "1";
    generated["environment"] = "contract-test";
    generated["correlationId"] = `fixture:${entry.recordType}`;
    generated["occurredAt"] = fixtureTimestamp;
    generated["recordedAt"] = fixtureTimestamp;
    generated["evidenceSequence"] = String(sequence);
    generated["payloadHash"] = hashCanonicalEvidenceJson(generated["payload"]);
    generated["recordId"] = createEvidenceRecordId({
      sourceSystem: requireString(generated, "sourceSystem"),
      sourceTable: requireString(generated, "sourceTable"),
      sourceRecordId: requireString(generated, "sourceRecordId"),
      sourceRevision: requireString(generated, "sourceRevision"),
      schemaName: requireString(generated, "schemaName"),
      schemaVersion: requireNumber(generated, "schemaVersion"),
    });
    return generated as unknown as EvidenceV1Record;
  }

  function buildBatch(records?: readonly EvidenceV1Record[]): EvidenceV1BatchRequest {
    const selected =
      records ?? registry.records.map((entry, index) => buildRecord(entry, index + 1));
    if (selected.length === 0) throw new Error("A frozen Evidence batch requires at least one record.");
    const first = selected[0];
    const last = selected.at(-1);
    if (first === undefined || last === undefined) throw new Error("Evidence batch boundaries are missing.");
    const unsigned = {
      contractVersion: "sdar.evidence/v1" as const,
      exportId: "fixture:all-record-types",
      sourceId: "fixture:source",
      nodeId: "fixture:node",
      revision: 1,
      firstSequence: first.evidenceSequence,
      lastSequence: last.evidenceSequence,
      records: selected,
    };
    return { ...unsigned, batchHash: hashCanonicalEvidenceJson(unsigned) };
  }

  return Object.freeze({ schemaRoot: resolvedRoot, registry, buildRecord, buildBatch });
}

interface MaterializeContext {
  readonly root: JsonObject;
  readonly activeRefs: ReadonlySet<string>;
  readonly location: string;
  readonly seed: number;
}

/** Recursively produces the smallest deterministic value used by the frozen corpus tests. */
export function materializeMinimumSchemaValue(schema: JsonObject): unknown {
  return materialize(schema, {
    root: schema,
    activeRefs: new Set<string>(),
    location: "$",
    seed: 0,
  });
}

function materialize(
  schema: JsonSchema,
  context: MaterializeContext,
  existing?: unknown,
): unknown {
  if (schema === false) throw new Error(`Cannot materialize false schema at ${context.location}.`);
  if (schema === true) return existing ?? null;

  const ref = schema["$ref"];
  if (typeof ref === "string") {
    if (!ref.startsWith("#/")) {
      throw new Error(`Only local JSON Schema refs are supported at ${context.location}: ${ref}`);
    }
    if (context.activeRefs.has(ref)) {
      throw new Error(`Recursive ref has no finite selected branch at ${context.location}: ${ref}`);
    }
    const activeRefs = new Set(context.activeRefs);
    activeRefs.add(ref);
    return materialize(resolveLocalRef(context.root, ref), {
      ...context,
      activeRefs,
      location: `${context.location}->$ref(${ref})`,
    }, existing);
  }

  if (Object.hasOwn(schema, "const")) return cloneJson(schema["const"]);
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) return cloneJson(enumValues[0]);

  const inferredType = inferType(schema, existing);
  let value = materializeDirect(inferredType, schema, context, existing);

  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) {
    for (const [index, subschema] of allOf.entries()) {
      value = materialize(asSchema(subschema, `${context.location}/allOf/${String(index)}`), {
        ...context,
        location: `${context.location}/allOf/${String(index)}`,
      }, value);
    }
  }

  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    const alternatives = oneOf
      .map((candidate, index) => ({
        candidate: asSchema(candidate, `${context.location}/oneOf/${String(index)}`),
        index,
      }))
      .sort((left, right) =>
        branchScore(left.candidate, context.activeRefs) - branchScore(right.candidate, context.activeRefs) ||
        left.index - right.index,
      );
    const selected = alternatives[0];
    if (selected === undefined) throw new Error(`oneOf is empty at ${context.location}.`);
    value = materialize(selected.candidate, {
      ...context,
      location: `${context.location}/oneOf/${String(selected.index)}`,
    }, value);
  }

  const conditional = schema["if"];
  const consequent = schema["then"];
  if (
    conditional !== undefined &&
    consequent !== undefined &&
    matchesSimpleCondition(value, asSchema(conditional, `${context.location}/if`))
  ) {
    value = materialize(asSchema(consequent, `${context.location}/then`), {
      ...context,
      location: `${context.location}/then`,
    }, value);
  }
  return value;
}

function materializeDirect(
  type: string | undefined,
  schema: JsonObject,
  context: MaterializeContext,
  existing: unknown,
): unknown {
  switch (type) {
    case "object": {
      const object: JsonObject = isJsonObject(existing) ? { ...existing } : {};
      const properties = isJsonObject(schema["properties"]) ? schema["properties"] : {};
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (Object.hasOwn(object, key)) {
          object[key] = materialize(asSchema(propertySchema, `${context.location}/properties/${key}`), {
            ...context,
            location: `${context.location}/properties/${key}`,
          }, object[key]);
        }
      }
      const required = stringArray(schema["required"]);
      for (const key of required) {
        const propertySchema = properties[key];
        object[key] = propertySchema === undefined
          ? object[key] ?? null
          : materialize(asSchema(propertySchema, `${context.location}/properties/${key}`), {
              ...context,
              location: `${context.location}/properties/${key}`,
            }, object[key]);
      }

      const minimum = numberKeyword(schema["minProperties"], 0);
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (Object.keys(object).length >= minimum) break;
        if (!Object.hasOwn(object, key)) {
          object[key] = materialize(asSchema(propertySchema, `${context.location}/properties/${key}`), {
            ...context,
            location: `${context.location}/properties/${key}`,
          });
        }
      }
      let extra = 0;
      while (Object.keys(object).length < minimum) {
        const additional = schema["additionalProperties"];
        if (additional === false) {
          throw new Error(`minProperties cannot be satisfied at ${context.location}.`);
        }
        const key = `fixtureField${String(extra)}`;
        extra += 1;
        if (Object.hasOwn(object, key)) continue;
        object[key] = isJsonObject(additional) || typeof additional === "boolean"
          ? materialize(additional, { ...context, location: `${context.location}/${key}` })
          : null;
      }
      return object;
    }
    case "array": {
      const minimum = numberKeyword(schema["minItems"], 0);
      const items = schema["items"];
      const array = Array.isArray(existing) ? [...existing] : [];
      while (array.length < minimum) {
        if (items === undefined) array.push(null);
        else {
          const index = array.length;
          array.push(materialize(asSchema(items, `${context.location}/items`), {
            ...context,
            location: `${context.location}/${String(index)}`,
            seed: context.seed + index,
          }));
        }
      }
      return array;
    }
    case "string":
      return materializeString(schema, context);
    case "integer": {
      const minimum = numberKeyword(schema["minimum"], 0);
      return Math.ceil(minimum);
    }
    case "number":
      return numberKeyword(schema["minimum"], 0);
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return existing;
  }
}

function materializeString(schema: JsonObject, context: MaterializeContext): string {
  const format = schema["format"];
  if (format !== undefined) {
    if (format !== "date-time") throw new Error(`Unsupported format at ${context.location}: ${String(format)}`);
    return fixtureTimestamp;
  }
  const pattern = schema["pattern"];
  if (typeof pattern === "string") return sampleForPattern(pattern, context.location);

  const minimum = Math.max(1, numberKeyword(schema["minLength"], 0));
  const maximum = numberKeyword(schema["maxLength"], Number.MAX_SAFE_INTEGER);
  const marker = String.fromCharCode(97 + Math.abs(context.seed % 26));
  const value = marker.repeat(minimum);
  if (value.length > maximum) throw new Error(`String bounds are unsatisfiable at ${context.location}.`);
  return value;
}

function sampleForPattern(pattern: string, location: string): string {
  let sample: string | undefined;
  if (pattern === "^evidence_[0-9a-f]{64}$") sample = `evidence_${"0".repeat(64)}`;
  else if (pattern === "^sha256:[0-9a-f]{64}$") sample = `sha256:${"0".repeat(64)}`;
  else if (pattern.includes("0|[1-9][0-9]")) sample = "0";
  else if (pattern.startsWith("^plan-template\\.")) sample = "plan-template.fixture";
  else if (pattern.startsWith("^skill\\.")) sample = "skill.fixture";
  else if (pattern.startsWith("^/")) {
    sample = pattern
      .slice(1, -1)
      .replaceAll("(?:0|[1-9][0-9]*)", "0");
  } else if (pattern.includes("artifact://runtime/v1/compiled_artifact/")) {
    sample = "artifact://runtime/v1/compiled_artifact/fixture/1/definition/artifact/definition";
  } else if (pattern.includes("artifact://runtime/v1/pattern_candidate/")) {
    sample = "artifact://runtime/v1/pattern_candidate/fixture/1/definition";
  } else if (pattern.includes("artifact://runtime/v1/artifact_replay_case/")) {
    sample = "artifact://runtime/v1/artifact_replay_case/fixture/1/content";
  } else if (pattern.includes("artifact://runtime/v1/replay_dataset_manifest/")) {
    sample = "artifact://runtime/v1/replay_dataset_manifest/fixture/1/content";
  }
  if (sample === undefined || !new RegExp(pattern, "u").test(sample)) {
    throw new Error(`No verified deterministic sample for pattern at ${location}: ${pattern}`);
  }
  return sample;
}

function inferType(schema: JsonObject, existing: unknown): string | undefined {
  const type = schema["type"];
  if (typeof type === "string") return type;
  if (schema["properties"] !== undefined || schema["required"] !== undefined || schema["minProperties"] !== undefined) {
    return "object";
  }
  if (schema["items"] !== undefined || schema["minItems"] !== undefined) return "array";
  if (Array.isArray(existing)) return "array";
  if (isJsonObject(existing)) return "object";
  return undefined;
}

function branchScore(schema: JsonSchema, activeRefs: ReadonlySet<string>): number {
  if (schema === true) return 0;
  if (schema === false) return Number.MAX_SAFE_INTEGER;
  if (schema["const"] === null || schema["type"] === "null") return -1_000;
  const refs = countActiveRefs(schema, activeRefs);
  const required = stringArray(schema["required"]).length;
  const typeCost = schema["type"] === "object" ? 10 : schema["type"] === "array" ? 5 : 0;
  return refs * 10_000 + required * 10 + typeCost;
}

function countActiveRefs(value: unknown, activeRefs: ReadonlySet<string>): number {
  if (!isJsonObject(value) && !Array.isArray(value)) return 0;
  if (Array.isArray(value)) return value.reduce((total, item) => total + countActiveRefs(item, activeRefs), 0);
  const own = typeof value["$ref"] === "string" && activeRefs.has(value["$ref"] as string) ? 1 : 0;
  return own + Object.values(value).reduce<number>(
    (total, item) => total + countActiveRefs(item, activeRefs),
    0,
  );
}

function matchesSimpleCondition(value: unknown, schema: JsonSchema): boolean {
  if (schema === true) return true;
  if (schema === false || !isJsonObject(value)) return false;
  for (const key of stringArray(schema["required"])) {
    if (!Object.hasOwn(value, key)) return false;
  }
  const properties = isJsonObject(schema["properties"]) ? schema["properties"] : {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key) || !isJsonObject(propertySchema)) continue;
    if (Object.hasOwn(propertySchema, "const") && !Object.is(value[key], propertySchema["const"])) return false;
    const choices = propertySchema["enum"];
    if (Array.isArray(choices) && !choices.some((choice) => Object.is(choice, value[key]))) return false;
  }
  return true;
}

function resolveLocalRef(root: JsonObject, ref: string): JsonSchema {
  let cursor: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isJsonObject(cursor) || !Object.hasOwn(cursor, key)) {
      throw new Error(`Unresolvable local JSON Schema ref: ${ref}`);
    }
    cursor = cursor[key];
  }
  return asSchema(cursor, ref);
}

function asSchema(value: unknown, location: string): JsonSchema {
  if (typeof value === "boolean" || isJsonObject(value)) return value;
  throw new Error(`Invalid JSON Schema at ${location}.`);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberKeyword(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
}

function requireString(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string") throw new Error(`Generated record field ${key} is not a string.`);
  return value;
}

function requireNumber(object: JsonObject, key: string): number {
  const value = object[key];
  if (typeof value !== "number") throw new Error(`Generated record field ${key} is not a number.`);
  return value;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
