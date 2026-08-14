import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { types as nodeTypes } from "node:util";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

export const DOMAIN_PROJECTION_CONTRACT_VERSION = "sdar.domain-projection/v1" as const;
export const DOMAIN_PROJECTION_CANONICALIZATION_VERSION =
  "sdar.domain-projection-canonical-json/v1" as const;
export const DOMAIN_PROJECTION_TARGET_DATABASE = "sdar_embodied" as const;
export const DOMAIN_PROJECTION_TARGET_TABLES = Object.freeze([
  "control_action",
  "control_receipt",
  "human_confirmation",
  "physical_verification",
  "preemption_recovery",
  "state_freshness_check",
] as const);
export const DOMAIN_PROJECTION_MAX_JSON_DEPTH = 16;
export const DOMAIN_PROJECTION_MAX_CANONICAL_BYTES = 65_536;
export const DOMAIN_PROJECTION_MAX_ARRAY_ITEMS = 256;
export const DOMAIN_PROJECTION_MAX_OBJECT_FIELDS = 64;

export const DOMAIN_PROJECTION_CONTRACT_ERROR_CODES = Object.freeze({
  assetInvalid: "DOMAIN_PROJECTION_CONTRACT_ASSET_INVALID",
  schemaInvalid: "DOMAIN_PROJECTION_CONTRACT_SCHEMA_INVALID",
  finiteJsonRequired: "DOMAIN_PROJECTION_FINITE_JSON_REQUIRED",
  executableFieldForbidden: "DOMAIN_PROJECTION_EXECUTABLE_FIELD_FORBIDDEN",
  projectionSetDuplicate: "DOMAIN_PROJECTION_SET_DUPLICATE",
  projectionSetOrderInvalid: "DOMAIN_PROJECTION_SET_ORDER_INVALID",
  projectionSetHashInvalid: "DOMAIN_PROJECTION_SET_HASH_INVALID",
  timestampOrderInvalid: "DOMAIN_PROJECTION_TIMESTAMP_ORDER_INVALID",
} as const);

export type DomainProjectionSourceDatabase = "sdar_commander" | "sdar_npc";
export type DomainProjectionTargetTable = (typeof DOMAIN_PROJECTION_TARGET_TABLES)[number];
export type Sha256Hash = `sha256:${string}`;

export type DomainProjectionDefinition = Readonly<{
  contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  projectionId: string;
  projectionVersion: number;
  source: Readonly<{
    database: DomainProjectionSourceDatabase;
    table: string;
    schemaName?: string;
    schemaVersion?: number;
  }>;
  target: Readonly<{
    database: typeof DOMAIN_PROJECTION_TARGET_DATABASE;
    table: DomainProjectionTargetTable;
    schemaName?: string;
    schemaVersion?: number;
  }>;
  mapperId: string;
  mapperVersion: string;
  cursorPolicy: Readonly<{
    fields: readonly string[];
    uniqueTieBreakerFields: readonly string[];
    order: "asc";
  }>;
  identityPolicy: Readonly<{
    version: string;
  }>;
  enabled: boolean;
}>;

export type ProjectionCheckpoint = Readonly<{
  contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  projectionId: string;
  projectionVersion: number;
  sourceDatabase: DomainProjectionSourceDatabase;
  sourceTable: string;
  lastOccurredAt: string | null;
  lastSourceRecordId: string | null;
  lastSourceRevision: string | null;
  checkpointVersion: number;
  processedSourceCount: number;
  producedTargetCount: number;
  skippedSourceCount: number;
  failedSourceCount: number;
  updatedAt: string;
}>;

export type ProjectionLineage = Readonly<{
  contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  lineageId: string;
  projectionId: string;
  projectionVersion: number;
  mapperId: string;
  mapperVersion: string;
  mappingRuleId: string;
  mappingRuleVersion: string;
  sourceDatabase: DomainProjectionSourceDatabase;
  sourceTable: string;
  sourceRecordId: string;
  sourceRevision: string;
  sourceContentHash: Sha256Hash;
  targetDatabase: typeof DOMAIN_PROJECTION_TARGET_DATABASE;
  targetTable: DomainProjectionTargetTable;
  targetRecordId: string;
  targetContentHash: Sha256Hash;
  projectedAt: string;
}>;

export type ProjectionFailureClass = "retryable" | "non_retryable" | "blocking";
export type ProjectionDeadLetterStatus = "open" | "retrying" | "resolved" | "ignored";

export const PROJECTION_FAILURE_CODES = Object.freeze({
  sourceSchemaInvalid: "SOURCE_SCHEMA_INVALID",
  sourceIdentityMissing: "SOURCE_IDENTITY_MISSING",
  sourceRevisionInvalid: "SOURCE_REVISION_INVALID",
  sourceContentConflict: "SOURCE_CONTENT_CONFLICT",
  mappingUnsupported: "MAPPING_UNSUPPORTED",
  mappingRequiredFieldMissing: "MAPPING_REQUIRED_FIELD_MISSING",
  targetSchemaInvalid: "TARGET_SCHEMA_INVALID",
  targetSemanticInvalid: "TARGET_SEMANTIC_INVALID",
  targetInsertFailed: "TARGET_INSERT_FAILED",
  lineageWriteFailed: "LINEAGE_WRITE_FAILED",
  checkpointWriteFailed: "CHECKPOINT_WRITE_FAILED",
  schemaDrift: "SCHEMA_DRIFT",
  projectionBug: "PROJECTION_BUG",
} as const);

export type ProjectionFailureCode =
  (typeof PROJECTION_FAILURE_CODES)[keyof typeof PROJECTION_FAILURE_CODES];

export const PROJECTION_FAILURE_CLASS_BY_CODE = Object.freeze({
  SOURCE_SCHEMA_INVALID: "non_retryable",
  SOURCE_IDENTITY_MISSING: "non_retryable",
  SOURCE_REVISION_INVALID: "non_retryable",
  SOURCE_CONTENT_CONFLICT: "non_retryable",
  MAPPING_UNSUPPORTED: "non_retryable",
  MAPPING_REQUIRED_FIELD_MISSING: "non_retryable",
  TARGET_SCHEMA_INVALID: "blocking",
  TARGET_SEMANTIC_INVALID: "non_retryable",
  TARGET_INSERT_FAILED: "retryable",
  LINEAGE_WRITE_FAILED: "retryable",
  CHECKPOINT_WRITE_FAILED: "retryable",
  SCHEMA_DRIFT: "blocking",
  PROJECTION_BUG: "blocking",
} satisfies Readonly<Record<ProjectionFailureCode, ProjectionFailureClass>>);

export type ProjectionDeadLetterResolution = Readonly<{
  managementActionId: string;
  action: "resolve" | "ignore";
  resolvedAt: string;
}>;

export type ProjectionDeadLetter = Readonly<{
  contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  deadLetterId: string;
  projectionId: string;
  projectionVersion: number;
  sourceDatabase: DomainProjectionSourceDatabase;
  sourceTable: string;
  sourceRecordId: string | null;
  sourceRevision: string | null;
  sourceContentHash: Sha256Hash;
  failureCode: ProjectionFailureCode;
  failureClass: ProjectionFailureClass;
  failureSummary: string;
  attemptCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  status: ProjectionDeadLetterStatus;
  resolution?: ProjectionDeadLetterResolution;
}>;

export type DomainProjectionSetEntry = Readonly<{
  projectionId: string;
  projectionVersion: number;
  mapperId: string;
  mapperVersion: string;
  definitionHash: Sha256Hash;
}>;

export type DomainProjectionSet = Readonly<{
  contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  projectionSetId: string;
  projectionSetVersion: number;
  projections: readonly DomainProjectionSetEntry[];
  projectionSetHash: Sha256Hash;
}>;

export type DomainProjectionSetUnsigned = Omit<DomainProjectionSet, "projectionSetHash">;

export interface DomainProjectionContractTypeMap {
  readonly definition: DomainProjectionDefinition;
  readonly checkpoint: ProjectionCheckpoint;
  readonly lineage: ProjectionLineage;
  readonly deadLetter: ProjectionDeadLetter;
  readonly projectionSet: DomainProjectionSet;
}

export type DomainProjectionContractKind = keyof DomainProjectionContractTypeMap;

export interface DomainProjectionContractValidator {
  readonly schemaRoot: string;
  readonly contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  assert<K extends DomainProjectionContractKind>(
    kind: K,
    value: unknown,
  ): DomainProjectionContractTypeMap[K];
  assertDefinition(value: unknown): DomainProjectionDefinition;
  assertCheckpoint(value: unknown): ProjectionCheckpoint;
  assertLineage(value: unknown): ProjectionLineage;
  assertDeadLetter(value: unknown): ProjectionDeadLetter;
  assertProjectionSet(value: unknown): DomainProjectionSet;
}

export class DomainProjectionContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "DomainProjectionContractError";
  }
}

interface JsonSchema extends Record<string, unknown> {
  readonly $id?: string;
}

interface DomainProjectionContractManifest {
  readonly contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  readonly canonicalizationVersion: typeof DOMAIN_PROJECTION_CANONICALIZATION_VERSION;
  readonly schemas: readonly Readonly<{
    kind: DomainProjectionContractKind;
    path: string;
    canonicalHash: Sha256Hash;
  }>[];
}

const schemaAssets = Object.freeze({
  definition: Object.freeze({
    filename: "domain-projection-definition.schema.json",
    id: "https://sdar.dev/schemas/domain-projection/v1/domain-projection-definition.schema.json",
  }),
  checkpoint: Object.freeze({
    filename: "projection-checkpoint.schema.json",
    id: "https://sdar.dev/schemas/domain-projection/v1/projection-checkpoint.schema.json",
  }),
  lineage: Object.freeze({
    filename: "projection-lineage.schema.json",
    id: "https://sdar.dev/schemas/domain-projection/v1/projection-lineage.schema.json",
  }),
  deadLetter: Object.freeze({
    filename: "projection-dead-letter.schema.json",
    id: "https://sdar.dev/schemas/domain-projection/v1/projection-dead-letter.schema.json",
  }),
  projectionSet: Object.freeze({
    filename: "domain-projection-set.schema.json",
    id: "https://sdar.dev/schemas/domain-projection/v1/domain-projection-set.schema.json",
  }),
} satisfies Record<DomainProjectionContractKind, Readonly<{ filename: string; id: string }>>);

const executableCodeLikeFields = new Set([
  "bytecode",
  "code",
  "command",
  "executable",
  "expression",
  "function",
  "functionbody",
  "javascript",
  "mappercode",
  "mappercodelanguage",
  "prompt",
  "python",
  "query",
  "runtimecode",
  "script",
  "sourcecode",
  "sql",
  "template",
  "wasm",
]);

const utcTimestamp =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

export async function loadDomainProjectionContractValidator(
  root?: string,
): Promise<DomainProjectionContractValidator> {
  const schemaRoot = path.resolve(
    root ??
      path.join(
        process.cwd(),
        "integrations",
        "domain-projection",
        "contracts",
        "v1",
        "schemas",
      ),
  );
  const contractRoot = path.dirname(schemaRoot);
  const manifest = await readContractManifest(path.join(contractRoot, "contract-manifest.json"));
  assertContractManifest(manifest);
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate(value: string): boolean {
      return isStrictUtcTimestamp(value);
    },
  });

  const validators = {} as Record<DomainProjectionContractKind, ValidateFunction>;
  for (const kind of Object.keys(schemaAssets) as DomainProjectionContractKind[]) {
    const asset = schemaAssets[kind];
    const manifestEntry = manifest.schemas.find((entry) => entry.kind === kind)!;
    const schema = await readSchema(path.join(schemaRoot, asset.filename));
    if (hashCanonicalDomainProjectionJson(schema) !== manifestEntry.canonicalHash) {
      throw new DomainProjectionContractError(
        DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
        `Domain projection schema asset ${asset.filename} does not match its frozen canonical hash.`,
      );
    }
    if (schema.$id !== asset.id) {
      throw new DomainProjectionContractError(
        DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
        `Domain projection schema asset ${asset.filename} has an unexpected $id.`,
      );
    }
    try {
      validators[kind] = ajv.compile(schema);
    } catch (error) {
      throw new DomainProjectionContractError(
        DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
        `Domain projection schema asset ${asset.filename} cannot compile: ${errorMessage(error)}.`,
      );
    }
  }

  function assert<K extends DomainProjectionContractKind>(
    kind: K,
    value: unknown,
  ): DomainProjectionContractTypeMap[K] {
    const clone = JSON.parse(canonicalizeDomainProjectionJson(value)) as unknown;
    const validate = validators[kind];
    if (!validate(clone)) {
      throw new DomainProjectionContractError(
        DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.schemaInvalid,
        `${kind} schema validation failed: ${schemaErrors(validate.errors)}.`,
      );
    }
    assertSemanticIntegrity(kind, clone);
    return deepFreeze(clone as DomainProjectionContractTypeMap[K]);
  }

  return Object.freeze({
    schemaRoot,
    contractVersion: DOMAIN_PROJECTION_CONTRACT_VERSION,
    assert,
    assertDefinition: (value: unknown) => assert("definition", value),
    assertCheckpoint: (value: unknown) => assert("checkpoint", value),
    assertLineage: (value: unknown) => assert("lineage", value),
    assertDeadLetter: (value: unknown) => assert("deadLetter", value),
    assertProjectionSet: (value: unknown) => assert("projectionSet", value),
  });
}

export function canonicalizeDomainProjectionJson(value: unknown): string {
  try {
    const canonical = canonicalize(value, 0, new Set<object>(), "$");
    const bytes = Buffer.byteLength(canonical, "utf8");
    if (bytes > DOMAIN_PROJECTION_MAX_CANONICAL_BYTES) {
      throw finiteJsonError(
        `Canonical JSON is ${String(bytes)} bytes; maximum is ${String(DOMAIN_PROJECTION_MAX_CANONICAL_BYTES)}.`,
        "$",
      );
    }
    return canonical;
  } catch (error) {
    if (error instanceof DomainProjectionContractError) throw error;
    throw finiteJsonError("JSON inspection failed.", "$");
  }
}

export function hashCanonicalDomainProjectionJson(value: unknown): Sha256Hash {
  return `sha256:${createHash("sha256")
    .update(canonicalizeDomainProjectionJson(value))
    .digest("hex")}`;
}

export function createDomainProjectionDefinitionHash(
  definition: DomainProjectionDefinition,
): Sha256Hash {
  return hashCanonicalDomainProjectionJson(definition);
}

export function createDomainProjectionSetHash(value: DomainProjectionSetUnsigned): Sha256Hash {
  const clone = JSON.parse(
    canonicalizeDomainProjectionJson(value),
  ) as DomainProjectionSetUnsigned;
  assertUniqueProjectionSetEntries(clone.projections);
  const projections = [...clone.projections].sort(compareProjectionSetEntries);
  return hashCanonicalDomainProjectionJson({ ...clone, projections });
}

function assertSemanticIntegrity(kind: DomainProjectionContractKind, value: unknown): void {
  switch (kind) {
    case "definition": {
      const definition = value as DomainProjectionDefinition;
      const cursorFields = new Set(definition.cursorPolicy.fields);
      if (
        definition.cursorPolicy.uniqueTieBreakerFields.some((field) => !cursorFields.has(field))
      ) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.schemaInvalid,
          "Every unique cursor tie-breaker field must also be present in cursorPolicy.fields.",
          "cursorPolicy.uniqueTieBreakerFields",
        );
      }
      break;
    }
    case "checkpoint": {
      const checkpoint = value as ProjectionCheckpoint;
      if (
        checkpoint.processedSourceCount <
        checkpoint.skippedSourceCount + checkpoint.failedSourceCount
      ) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.schemaInvalid,
          "Checkpoint processedSourceCount cannot be less than skippedSourceCount plus failedSourceCount.",
          "processedSourceCount",
        );
      }
      if (
        checkpoint.lastOccurredAt !== null &&
        Date.parse(checkpoint.updatedAt) < Date.parse(checkpoint.lastOccurredAt)
      ) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.timestampOrderInvalid,
          "Checkpoint updatedAt cannot precede lastOccurredAt.",
          "updatedAt",
        );
      }
      break;
    }
    case "deadLetter": {
      const deadLetter = value as ProjectionDeadLetter;
      if (PROJECTION_FAILURE_CLASS_BY_CODE[deadLetter.failureCode] !== deadLetter.failureClass) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.schemaInvalid,
          `Failure code ${deadLetter.failureCode} requires class ${PROJECTION_FAILURE_CLASS_BY_CODE[deadLetter.failureCode]}.`,
          "failureClass",
        );
      }
      if (Date.parse(deadLetter.lastFailedAt) < Date.parse(deadLetter.firstFailedAt)) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.timestampOrderInvalid,
          "Dead-letter lastFailedAt cannot precede firstFailedAt.",
          "lastFailedAt",
        );
      }
      if (
        deadLetter.resolution !== undefined &&
        Date.parse(deadLetter.resolution.resolvedAt) < Date.parse(deadLetter.lastFailedAt)
      ) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.timestampOrderInvalid,
          "Dead-letter resolvedAt cannot precede lastFailedAt.",
          "resolution.resolvedAt",
        );
      }
      break;
    }
    case "projectionSet": {
      const projectionSet = value as DomainProjectionSet;
      assertUniqueProjectionSetEntries(projectionSet.projections);
      const expectedOrder = [...projectionSet.projections].sort(compareProjectionSetEntries);
      if (
        projectionSet.projections.some(
          (entry, index) => compareProjectionSetEntries(entry, expectedOrder[index]!) !== 0,
        )
      ) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.projectionSetOrderInvalid,
          "Projection-set entries must be ordered by projectionId, projectionVersion, mapperId, then mapperVersion.",
          "projections",
        );
      }
      const { projectionSetHash, ...unsigned } = projectionSet;
      if (projectionSetHash !== createDomainProjectionSetHash(unsigned)) {
        throw new DomainProjectionContractError(
          DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.projectionSetHashInvalid,
          "Projection-set hash does not match its canonical unsigned content.",
          "projectionSetHash",
        );
      }
      break;
    }
    case "lineage":
      break;
  }
}

function assertUniqueProjectionSetEntries(entries: readonly DomainProjectionSetEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.projectionId)) {
      throw new DomainProjectionContractError(
        DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.projectionSetDuplicate,
        `Projection set contains duplicate projection ID ${entry.projectionId}; a set cannot select multiple versions of one projection.`,
        "projections",
      );
    }
    seen.add(entry.projectionId);
  }
}

function compareProjectionSetEntries(
  left: DomainProjectionSetEntry,
  right: DomainProjectionSetEntry,
): number {
  const idOrder = compareUnicode(left.projectionId, right.projectionId);
  if (idOrder !== 0) return idOrder;
  if (left.projectionVersion !== right.projectionVersion) {
    return left.projectionVersion - right.projectionVersion;
  }
  const mapperIdOrder = compareUnicode(left.mapperId, right.mapperId);
  if (mapperIdOrder !== 0) return mapperIdOrder;
  return compareUnicode(left.mapperVersion, right.mapperVersion);
}

function canonicalize(
  value: unknown,
  depth: number,
  active: Set<object>,
  jsonPath: string,
): string {
  if (depth > DOMAIN_PROJECTION_MAX_JSON_DEPTH) {
    throw finiteJsonError(
      `JSON depth exceeds ${String(DOMAIN_PROJECTION_MAX_JSON_DEPTH)}.`,
      jsonPath,
    );
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw finiteJsonError("Non-finite numbers are forbidden.", jsonPath);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    throw finiteJsonError("Only finite JSON values are accepted.", jsonPath);
  }
  if (nodeTypes.isProxy(value)) throw finiteJsonError("Proxy objects are forbidden.", jsonPath);
  if (active.has(value)) throw finiteJsonError("Cyclic JSON is forbidden.", jsonPath);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > DOMAIN_PROJECTION_MAX_ARRAY_ITEMS) {
        throw finiteJsonError(
          `JSON arrays are limited to ${String(DOMAIN_PROJECTION_MAX_ARRAY_ITEMS)} items.`,
          jsonPath,
        );
      }
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw finiteJsonError("Only plain JSON arrays are accepted.", jsonPath);
      }
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            typeof key === "symbol" ||
            (key !== "length" && !isCanonicalArrayIndex(key, value.length)),
        )
      ) {
        throw finiteJsonError("Array symbols and extra properties are forbidden.", jsonPath);
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined
        ) {
          throw finiteJsonError(
            "Sparse, accessor, or non-enumerable array items are forbidden.",
            `${jsonPath}[${key}]`,
          );
        }
        items.push(canonicalize(descriptor.value, depth + 1, active, `${jsonPath}[${key}]`));
      }
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw finiteJsonError("Only plain JSON objects are accepted.", jsonPath);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      throw finiteJsonError("JSON object symbol properties are forbidden.", jsonPath);
    }
    if (keys.length > DOMAIN_PROJECTION_MAX_OBJECT_FIELDS) {
      throw finiteJsonError(
        `JSON objects are limited to ${String(DOMAIN_PROJECTION_MAX_OBJECT_FIELDS)} fields.`,
        jsonPath,
      );
    }
    const stringKeys = (keys as string[]).sort(compareUnicode);
    return `{${stringKeys
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined
        ) {
          throw finiteJsonError(
            "Accessor and non-enumerable JSON object properties are forbidden.",
            `${jsonPath}.${key}`,
          );
        }
        if (isExecutableCodeLikeField(key)) {
          throw new DomainProjectionContractError(
            DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.executableFieldForbidden,
            `Executable-code-like field ${key} is forbidden.`,
            `${jsonPath}.${key}`,
          );
        }
        return `${JSON.stringify(key)}:${canonicalize(descriptor.value, depth + 1, active, `${jsonPath}.${key}`)}`;
      })
      .join(",")}}`;
  } finally {
    active.delete(value);
  }
}

function isExecutableCodeLikeField(field: string): boolean {
  const normalized = field.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  return executableCodeLikeFields.has(normalized);
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function isStrictUtcTimestamp(value: string): boolean {
  const match = utcTimestamp.exec(value);
  if (match === null) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const date = new Date(timestamp);
  const fraction = match[7] ?? "";
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3) || "0");
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6]) &&
    date.getUTCMilliseconds() === milliseconds
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

async function readSchema(filename: string): Promise<JsonSchema> {
  try {
    const value = JSON.parse(await readFile(filename, "utf8")) as unknown;
    canonicalizeDomainProjectionJson(value);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as JsonSchema;
  } catch (error) {
    if (error instanceof DomainProjectionContractError) throw error;
    throw new DomainProjectionContractError(
      DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
      `Domain projection schema asset is unreadable: ${filename}.`,
    );
  }
}

async function readContractManifest(filename: string): Promise<DomainProjectionContractManifest> {
  try {
    const value = JSON.parse(await readFile(filename, "utf8")) as unknown;
    canonicalizeDomainProjectionJson(value);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as DomainProjectionContractManifest;
  } catch (error) {
    if (error instanceof DomainProjectionContractError) throw error;
    throw new DomainProjectionContractError(
      DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
      `Domain projection contract manifest is unreadable: ${filename}.`,
    );
  }
}

function assertContractManifest(manifest: DomainProjectionContractManifest): void {
  if (
    !hasExactObjectKeys(manifest, ["canonicalizationVersion", "contractVersion", "schemas"]) ||
    typeof manifest.contractVersion !== "string" ||
    typeof manifest.canonicalizationVersion !== "string" ||
    !Array.isArray(manifest.schemas) ||
    manifest.schemas.some(
      (entry) =>
        !hasExactObjectKeys(entry, ["canonicalHash", "kind", "path"]) ||
        typeof entry.kind !== "string" ||
        typeof entry.path !== "string" ||
        typeof entry.canonicalHash !== "string",
    )
  ) {
    throw new DomainProjectionContractError(
      DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
      "Domain projection contract manifest shape is invalid.",
    );
  }
  if (
    manifest.contractVersion !== DOMAIN_PROJECTION_CONTRACT_VERSION ||
    manifest.canonicalizationVersion !== DOMAIN_PROJECTION_CANONICALIZATION_VERSION ||
    manifest.schemas.length !== Object.keys(schemaAssets).length
  ) {
    throw new DomainProjectionContractError(
      DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
      "Domain projection contract manifest version or schema count is invalid.",
    );
  }
  const seen = new Set<DomainProjectionContractKind>();
  for (const kind of Object.keys(schemaAssets) as DomainProjectionContractKind[]) {
    const asset = schemaAssets[kind];
    const entry = manifest.schemas.find((candidate) => candidate.kind === kind);
    if (
      entry === undefined ||
      seen.has(kind) ||
      entry.path !== `schemas/${asset.filename}` ||
      !/^sha256:[0-9a-f]{64}$/u.test(entry.canonicalHash)
    ) {
      throw new DomainProjectionContractError(
        DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
        `Domain projection contract manifest entry ${kind} is invalid.`,
      );
    }
    seen.add(kind);
  }
  if (new Set(manifest.schemas.map((entry) => entry.kind)).size !== manifest.schemas.length) {
    throw new DomainProjectionContractError(
      DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.assetInvalid,
      "Domain projection contract manifest contains duplicate schema kinds.",
    );
  }
}

function hasExactObjectKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort(compareUnicode);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function schemaErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown schema error";
  return errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"}:${error.keyword}`)
    .join(", ");
}

function compareUnicode(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finiteJsonError(message: string, field: string): DomainProjectionContractError {
  return new DomainProjectionContractError(
    DOMAIN_PROJECTION_CONTRACT_ERROR_CODES.finiteJsonRequired,
    message,
    field,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
