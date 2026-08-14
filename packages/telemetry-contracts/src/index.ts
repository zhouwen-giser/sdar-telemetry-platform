import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import type {
  EvidenceBatch,
  EvidenceV1BatchRequest,
  EvidenceV1Record,
} from "../../telemetry-types/src/index.js";

export const EVIDENCE_V1_CONTRACT = "sdar.evidence/v1" as const;
export const EVIDENCE_V1_MAX_JSON_DEPTH = 32;
export const EVIDENCE_V1_MAX_CANONICAL_BYTES = 262_144;

export const EVIDENCE_V1_ERROR_CODES = Object.freeze({
  contractAssetsInvalid: "EVIDENCE_CONTRACT_ASSET_INVALID",
  schemaInvalid: "EVIDENCE_SCHEMA_INVALID",
  batchHashInvalid: "EVIDENCE_BATCH_HASH_INVALID",
  payloadHashInvalid: "EVIDENCE_PAYLOAD_HASH_INVALID",
  recordIdInvalid: "EVIDENCE_RECORD_ID_INVALID",
  sequenceInvalid: "EVIDENCE_SEQUENCE_INVALID",
} as const);

export class ContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ContractError";
  }
}

/** Legacy input assertion retained for compatibility-only adapters. */
export function assertBatch(v: unknown): asserts v is EvidenceBatch {
  if (!v || typeof v !== "object") {
    throw new ContractError("TEL-ING-001", "batch must be object");
  }
  const b = v as Partial<EvidenceBatch>;
  if (
    b.schemaVersion !== "1.0" ||
    !b.sourceId ||
    !b.sourceType ||
    !b.batchId ||
    !Array.isArray(b.records) ||
    b.records.length === 0
  ) {
    throw new ContractError("TEL-ING-002", "invalid batch contract");
  }
  for (const record of b.records) {
    if (
      !record ||
      typeof record !== "object" ||
      !record.sourceRecordId ||
      !record.recordFamily ||
      !record.occurredAt ||
      !record.tenantId
    ) {
      throw new ContractError("TEL-ING-003", "invalid record contract");
    }
  }
}

export interface EvidenceRecordIdentityInput {
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: string;
  readonly schemaName: string;
  readonly schemaVersion: number;
}

export interface EvidenceV1Validator {
  readonly schemaRoot: string;
  readonly recordTypes: readonly string[];
  readonly recordSchemaCount: number;
  recognizesRecordType(recordType: string): boolean;
  assertBatch(value: unknown): EvidenceV1BatchRequest;
}

interface JsonSchema extends Record<string, unknown> {
  readonly $id?: string;
}

interface EvidenceRegistryRecord {
  readonly recordType: string;
  readonly schemaPath: string;
  readonly schemaHash: string;
}

interface EvidenceRegistry {
  readonly contractVersion: string;
  readonly records: readonly EvidenceRegistryRecord[];
}

const decimalSequence = /^(?:0|[1-9][0-9]*)$/u;
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

export async function loadEvidenceV1Validator(root?: string): Promise<EvidenceV1Validator> {
  const schemaRoot = path.resolve(
    root ??
      path.join(
        process.cwd(),
        "integrations",
        "skill-driven-agent-runtime",
        "v1.4.1",
        "schemas",
        "evidence",
        "v1",
      ),
  );
  const registry = await readJson<EvidenceRegistry>(path.join(schemaRoot, "registry.json"));
  if (registry.contractVersion !== EVIDENCE_V1_CONTRACT || registry.records.length !== 100) {
    throw new ContractError(
      EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
      "Evidence v1 registry must declare sdar.evidence/v1 and exactly 100 record types.",
    );
  }

  const recordTypes = registry.records.map((entry) => entry.recordType);
  if (new Set(recordTypes).size !== recordTypes.length) {
    throw new ContractError(
      EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
      "Evidence v1 registry contains duplicate record types.",
    );
  }

  const schemaFiles = await collectSchemaFiles(schemaRoot);
  const schemas = new Map<string, JsonSchema>();
  for (const filename of schemaFiles) {
    schemas.set(path.relative(schemaRoot, filename).split(path.sep).join("/"), await readJson(filename));
  }

  for (const entry of registry.records) {
    const schema = schemas.get(entry.schemaPath);
    if (schema === undefined || hashCanonicalEvidenceJson(schema) !== entry.schemaHash) {
      throw new ContractError(
        EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
        `Evidence v1 schema asset mismatch for ${entry.recordType}.`,
      );
    }
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate(value: string): boolean {
      return utcTimestamp.test(value) && Number.isFinite(Date.parse(value));
    },
  });
  for (const schema of schemas.values()) ajv.addSchema(schema);

  const batchSchema = schemas.get("batch-request.schema.json");
  if (batchSchema === undefined) {
    throw new ContractError(
      EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
      "Evidence v1 batch request schema is missing.",
    );
  }
  const batchValidator = validatorFor(ajv, batchSchema);
  for (const entry of registry.records) {
    const schema = schemas.get(entry.schemaPath);
    if (schema === undefined) {
      throw new ContractError(
        EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
        `Evidence v1 schema is missing for ${entry.recordType}.`,
      );
    }
    validatorFor(ajv, schema);
  }

  const recognized = new Set(recordTypes);
  return Object.freeze({
    schemaRoot,
    recordTypes: Object.freeze([...recordTypes]),
    recordSchemaCount: recordTypes.length,
    recognizesRecordType: (recordType: string) => recognized.has(recordType),
    assertBatch(value: unknown): EvidenceV1BatchRequest {
      if (!batchValidator(value)) {
        throw new ContractError(
          EVIDENCE_V1_ERROR_CODES.schemaInvalid,
          `Evidence v1 batch schema validation failed: ${schemaErrors(batchValidator.errors)}.`,
        );
      }
      const batch = value as EvidenceV1BatchRequest;
      assertBatchIntegrity(batch);
      return batch;
    },
  });
}

export function canonicalizeEvidenceJson(value: unknown): string {
  const active = new Set<object>();
  const canonical = canonicalize(value, 0, active, "$");
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes > EVIDENCE_V1_MAX_CANONICAL_BYTES) {
    throw new ContractError(
      "EVIDENCE_JSON_SIZE_EXCEEDED",
      `Canonical JSON is ${String(bytes)} bytes; maximum is ${String(EVIDENCE_V1_MAX_CANONICAL_BYTES)}.`,
    );
  }
  return canonical;
}

export function hashCanonicalEvidenceJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalizeEvidenceJson(value)).digest("hex")}`;
}

export function createEvidenceRecordId(
  input: EvidenceRecordIdentityInput,
): `evidence_${string}` {
  for (const [field, value] of Object.entries(input)) {
    if ((typeof value === "string" && value.trim() === "") || value === undefined) {
      throw new ContractError(
        "EVIDENCE_IDENTITY_INVALID",
        `${field} must be present and non-empty.`,
        field,
      );
    }
  }
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new ContractError(
      "EVIDENCE_IDENTITY_INVALID",
      "schemaVersion must be a positive safe integer.",
      "schemaVersion",
    );
  }
  const hash = createHash("sha256")
    .update(
      canonicalizeEvidenceJson([
        input.sourceSystem,
        input.sourceTable.trim(),
        input.sourceRecordId.trim(),
        input.sourceRevision.trim(),
        input.schemaName.trim(),
        input.schemaVersion,
      ]),
    )
    .digest("hex");
  return `evidence_${hash}`;
}

function assertBatchIntegrity(batch: EvidenceV1BatchRequest): void {
  const { batchHash, ...unsigned } = batch;
  if (hashCanonicalEvidenceJson(unsigned) !== batchHash) {
    throw new ContractError(
      EVIDENCE_V1_ERROR_CODES.batchHashInvalid,
      "Evidence v1 batch hash does not match its canonical unsigned content.",
      "batchHash",
    );
  }

  const seenSequences = new Set<string>();
  const seenRecords = new Set<string>();
  let previous: bigint | undefined;
  for (const [index, record] of batch.records.entries()) {
    if (!decimalSequence.test(record.evidenceSequence)) {
      throw sequenceError(`records[${String(index)}].evidenceSequence is not canonical decimal.`);
    }
    const sequence = BigInt(record.evidenceSequence);
    if (previous !== undefined && sequence <= previous) {
      throw sequenceError("Evidence v1 record sequences must be strictly increasing.");
    }
    if (seenSequences.has(record.evidenceSequence) || seenRecords.has(record.recordId)) {
      throw sequenceError("Evidence v1 batch record identities and sequences must be unique.");
    }
    seenSequences.add(record.evidenceSequence);
    seenRecords.add(record.recordId);
    previous = sequence;

    if (hashCanonicalEvidenceJson(record.payload) !== record.payloadHash) {
      throw new ContractError(
        EVIDENCE_V1_ERROR_CODES.payloadHashInvalid,
        `Evidence v1 payload hash mismatch at records[${String(index)}].`,
        `records[${String(index)}].payloadHash`,
      );
    }
    if (createEvidenceRecordId(record) !== record.recordId) {
      throw new ContractError(
        EVIDENCE_V1_ERROR_CODES.recordIdInvalid,
        `Evidence v1 record identity mismatch at records[${String(index)}].`,
        `records[${String(index)}].recordId`,
      );
    }
  }

  const first = batch.records[0];
  const last = batch.records.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    batch.firstSequence !== first.evidenceSequence ||
    batch.lastSequence !== last.evidenceSequence
  ) {
    throw sequenceError("Evidence v1 batch sequence boundaries do not match its records.");
  }
}

function canonicalize(value: unknown, depth: number, active: Set<object>, jsonPath: string): string {
  if (depth > EVIDENCE_V1_MAX_JSON_DEPTH) {
    throw new ContractError(
      "EVIDENCE_JSON_DEPTH_EXCEEDED",
      `JSON depth exceeds ${String(EVIDENCE_V1_MAX_JSON_DEPTH)}.`,
      jsonPath,
    );
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ContractError(
        "EVIDENCE_JSON_VALUE_INVALID",
        "Non-finite numbers are forbidden.",
        jsonPath,
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    throw new ContractError(
      "EVIDENCE_JSON_VALUE_INVALID",
      `Unsupported JSON value at ${jsonPath}.`,
      jsonPath,
    );
  }
  if (active.has(value)) {
    throw new ContractError("EVIDENCE_JSON_CYCLE", `Cyclic JSON at ${jsonPath}.`, jsonPath);
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 4096) {
        throw new ContractError(
          "EVIDENCE_JSON_SIZE_EXCEEDED",
          "JSON arrays are limited to 4096 items.",
          jsonPath,
        );
      }
      return `[${value
        .map((item, index) => canonicalize(item, depth + 1, active, `${jsonPath}[${String(index)}]`))
        .join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ContractError(
        "EVIDENCE_JSON_VALUE_INVALID",
        `Only plain JSON objects are accepted at ${jsonPath}.`,
        jsonPath,
      );
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length > 1024) {
      throw new ContractError(
        "EVIDENCE_JSON_SIZE_EXCEEDED",
        "JSON objects are limited to 1024 fields.",
        jsonPath,
      );
    }
    return `{${entries
      .map(([key, item]) => {
        if (isForbiddenEvidenceField(key, item)) {
          throw new ContractError(
            "EVIDENCE_FORBIDDEN_FIELD",
            `Forbidden evidence field ${key}.`,
            `${jsonPath}.${key}`,
          );
        }
        return `${JSON.stringify(key)}:${canonicalize(item, depth + 1, active, `${jsonPath}.${key}`)}`;
      })
      .join(",")}}`;
  } finally {
    active.delete(value);
  }
}

function isForbiddenEvidenceField(key: string, value: unknown): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  if (
    normalized === "secretstatus" &&
    ((typeof value === "string" &&
      ["unknown", "available", "unavailable", "invalid"].includes(value)) ||
      isSecretStatusSchema(value))
  ) {
    return false;
  }
  if (normalized.endsWith("credentialref") || normalized.endsWith("secretref")) return false;
  return /(?:credential|password|passwd|accesstoken|refreshtoken|secret|authorization|apikey|privatekey|chainofthought|privatereasoning|reasoningcontent|hiddenreasoning)/u.test(
    normalized,
  );
}

function isSecretStatusSchema(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const descriptor = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(descriptor).sort();
  const enumValues = descriptor["enum"];
  return (
    keys.length === 2 &&
    keys[0] === "enum" &&
    keys[1] === "type" &&
    descriptor["type"] === "string" &&
    Array.isArray(enumValues) &&
    enumValues.length === 4 &&
    ["unknown", "available", "unavailable", "invalid"].every((item, index) =>
      Object.is(enumValues[index], item),
    )
  );
}

async function collectSchemaFiles(directory: string): Promise<string[]> {
  let entries: any[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new ContractError(
      EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
      `Evidence v1 schema directory is unavailable: ${directory}.`,
    );
  }
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSchemaFiles(target)));
    else if (entry.isFile() && entry.name.endsWith(".schema.json")) files.push(target);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function readJson<T = JsonSchema>(filename: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filename, "utf8")) as T;
  } catch {
    throw new ContractError(
      EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
      `Evidence v1 contract asset is unreadable: ${filename}.`,
    );
  }
}

function validatorFor(ajv: Ajv2020, schema: JsonSchema): ValidateFunction {
  const existing = typeof schema.$id === "string" ? ajv.getSchema(schema.$id) : undefined;
  try {
    return existing ?? ajv.compile(schema);
  } catch {
    throw new ContractError(
      EVIDENCE_V1_ERROR_CODES.contractAssetsInvalid,
      `Evidence v1 schema cannot compile${schema.$id === undefined ? "" : `: ${schema.$id}`}.`,
    );
  }
}

function schemaErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown schema error";
  return errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"}:${error.keyword}`)
    .join(", ");
}

function sequenceError(message: string): ContractError {
  return new ContractError(EVIDENCE_V1_ERROR_CODES.sequenceInvalid, message, "evidenceSequence");
}

export type { EvidenceV1BatchRequest, EvidenceV1Record };

export * from "./domain-projection.js";
