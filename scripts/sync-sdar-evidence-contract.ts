import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

type JsonObject = Record<string, unknown>;

interface CliOptions {
  check: boolean;
  sourceRoot?: string;
}

interface ImportedFile {
  path: string;
  bytes: Buffer;
  byteSha256: string;
}

interface RegistryRecord extends JsonObject {
  recordType: string;
  recordFamily: string;
  evaluationRole: "required" | "diagnostic";
  requirementLevel: string;
  schemaName: string;
  schemaVersion: number;
  schemaPath: string;
  schemaHash: string;
}

interface Snapshot {
  expectedFiles: Map<string, Buffer>;
  executionSha: string;
  mainSha: string;
  contractVersion: string;
  canonicalContractSha256: string;
  canonicalRegistrySha256: string;
  recordCount: number;
  requiredRecordCount: number;
  diagnosticRecordCount: number;
  importedFileCount: number;
}

const execFileAsync = promisify(execFile);
const SNAPSHOT_VERSION = "v1.4.1";
const CONTRACT_VERSION = "sdar.evidence/v1";
const TARGET_RELATIVE_ROOT = "integrations/skill-driven-agent-runtime/v1.4.1";
const IMPORTED_ROOTS = [
  "protocol/evidence/v1",
  "schemas/evidence/v1",
  "reports/v1.4.1-evidence/clickhouse-handoff",
] as const;

const options = parseArguments(process.argv.slice(2));

try {
  const telemetryRoot = await findTelemetryRoot(process.cwd());
  const sourceRoot = options.sourceRoot
    ? path.resolve(options.sourceRoot)
    : path.resolve(telemetryRoot, "..", "skill-driven-agent-runtime");
  const targetRoot = path.join(telemetryRoot, TARGET_RELATIVE_ROOT);
  const snapshot = await buildSnapshot(telemetryRoot, sourceRoot);

  if (options.check) {
    const drift = await findDrift(targetRoot, snapshot.expectedFiles);
    if (drift.length > 0) {
      throw new Error(`SDAR_EVIDENCE_CONTRACT_DRIFT: ${drift.join("; ")}`);
    }
    process.stdout.write(`${JSON.stringify(summary("checked", snapshot))}\n`);
  } else {
    await replaceSnapshot(targetRoot, snapshot.expectedFiles);
    process.stdout.write(`${JSON.stringify(summary("synced", snapshot))}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = options.check && !message.startsWith("SDAR_EVIDENCE_CONTRACT_DRIFT")
    ? "SDAR_EVIDENCE_CONTRACT_DRIFT: "
    : "";
  process.stderr.write(`${prefix}${message}\n`);
  process.exitCode = 1;
}

function parseArguments(args: string[]): CliOptions {
  const parsed: CliOptions = { check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") {
      parsed.check = true;
      continue;
    }
    if (argument === "--source") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("SDAR_EVIDENCE_CONTRACT_ARGUMENT_INVALID: --source requires a path");
      }
      parsed.sourceRoot = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--source=")) {
      const value = argument.slice("--source=".length);
      if (!value) {
        throw new Error("SDAR_EVIDENCE_CONTRACT_ARGUMENT_INVALID: --source requires a path");
      }
      parsed.sourceRoot = value;
      continue;
    }
    throw new Error(`SDAR_EVIDENCE_CONTRACT_ARGUMENT_INVALID: unknown argument ${argument}`);
  }
  return parsed;
}

async function findTelemetryRoot(start: string): Promise<string> {
  let candidate = path.resolve(start);
  while (true) {
    try {
      const packageJson = parseObject(await readFile(path.join(candidate, "package.json"), "utf8"));
      if (packageJson["name"] === "sdar-telemetry-platform") {
        return candidate;
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error("SDAR_EVIDENCE_CONTRACT_TELEMETRY_ROOT_NOT_FOUND");
    }
    candidate = parent;
  }
}

async function buildSnapshot(telemetryRoot: string, sourceRoot: string): Promise<Snapshot> {
  await assertDirectory(sourceRoot, "SDAR_EVIDENCE_CONTRACT_SOURCE_NOT_FOUND");
  await assertImportedRootsClean(sourceRoot);

  const [executionSha, mainSha] = await Promise.all([
    gitRevision(sourceRoot, "HEAD"),
    gitRevision(sourceRoot, "origin/main"),
  ]);
  const importedFiles = await collectImportedFiles(sourceRoot);
  const importedByPath = new Map(importedFiles.map((file) => [file.path, file.bytes]));

  const contract = parseObject(requiredImportedText(
    importedByPath,
    "protocol/evidence/v1/evidence-contract.json",
  ));
  const registry = parseObject(requiredImportedText(
    importedByPath,
    "schemas/evidence/v1/registry.json",
  ));
  const handoffManifest = parseObject(requiredImportedText(
    importedByPath,
    "reports/v1.4.1-evidence/clickhouse-handoff/contract-manifest.json",
  ));

  const contractVersion = requiredString(contract, "contractVersion");
  assertEqual(contractVersion, CONTRACT_VERSION, "CONTRACT_VERSION_INVALID");
  assertEqual(requiredString(registry, "contractVersion"), contractVersion, "REGISTRY_VERSION_INVALID");
  assertEqual(
    requiredString(handoffManifest, "contractVersion"),
    contractVersion,
    "HANDOFF_VERSION_INVALID",
  );

  const canonicalContractSha256 = canonicalSha256(contract);
  const declaredContractHash = requiredString(handoffManifest, "contractHash");
  assertEqual(declaredContractHash, canonicalContractSha256, "CANONICAL_CONTRACT_HASH_INVALID");

  const declaredRegistryHash = requiredString(registry, "registryHash");
  const registryCore = Object.fromEntries(
    Object.entries(registry).filter(([key]) => key !== "registryHash"),
  );
  const canonicalRegistrySha256 = canonicalSha256(registryCore);
  assertEqual(declaredRegistryHash, canonicalRegistrySha256, "CANONICAL_REGISTRY_HASH_INVALID");
  assertEqual(
    requiredString(contract, "registryHash"),
    canonicalRegistrySha256,
    "CONTRACT_REGISTRY_HASH_INVALID",
  );
  assertEqual(
    requiredString(handoffManifest, "registryHash"),
    canonicalRegistrySha256,
    "HANDOFF_REGISTRY_HASH_INVALID",
  );

  const records = parseRegistryRecords(registry["records"]);
  const requiredRecords = records.filter((record) => record.evaluationRole === "required");
  const diagnosticRecords = records.filter((record) => record.evaluationRole === "diagnostic");
  assertEqual(records.length, 100, "RECORD_COUNT_INVALID");
  assertEqual(requiredRecords.length, 95, "REQUIRED_RECORD_COUNT_INVALID");
  assertEqual(diagnosticRecords.length, 5, "DIAGNOSTIC_RECORD_COUNT_INVALID");
  assertEqual(new Set(records.map((record) => record.recordType)).size, 100, "RECORD_TYPES_NOT_UNIQUE");
  await verifySchemaHashes(importedByPath, registry, records);

  const sourcePath = toPosixPath(path.relative(telemetryRoot, sourceRoot));
  const sourceLock = {
    schemaVersion: 1,
    snapshotVersion: SNAPSHOT_VERSION,
    sourcePath,
    executionSha,
    mainSha,
    mainRef: "origin/main",
    contractVersion,
    canonicalContractSha256,
    canonicalRegistrySha256,
    importedRoots: [...IMPORTED_ROOTS],
    importedFileCount: importedFiles.length,
    files: importedFiles.map((file) => ({
      path: file.path,
      bytes: file.bytes.byteLength,
      byteSha256: file.byteSha256,
    })),
  };
  const contractMap = {
    schemaVersion: 1,
    snapshotVersion: SNAPSHOT_VERSION,
    contractVersion,
    canonicalContractSha256,
    canonicalRegistrySha256,
    counts: {
      records: records.length,
      required: requiredRecords.length,
      diagnostic: diagnosticRecords.length,
    },
    legacy: {
      status: "compatibility-only",
      locations: ["../contract-map.json", "../source-lock.json"],
      policy:
        "Legacy SDAR telemetry mappings are accepted only by explicit compatibility paths and are not authoritative for sdar.evidence/v1 ingestion.",
    },
    records: records.map((record) => ({
      recordType: record.recordType,
      recordFamily: record.recordFamily,
      evaluationRole: record.evaluationRole,
      requirementLevel: record.requirementLevel,
      schemaName: record.schemaName,
      schemaVersion: record.schemaVersion,
      schemaPath: `schemas/evidence/v1/${record.schemaPath}`,
      canonicalSchemaSha256: record.schemaHash,
    })),
  };

  const expectedFiles = new Map(importedFiles.map((file) => [file.path, file.bytes]));
  expectedFiles.set("source-lock.json", jsonBuffer(sourceLock));
  expectedFiles.set("contract-map.json", jsonBuffer(contractMap));
  expectedFiles.set(
    "README.md",
    Buffer.from(readme({
      executionSha,
      mainSha,
      contractVersion,
      canonicalContractSha256,
      canonicalRegistrySha256,
      importedFileCount: importedFiles.length,
    }), "utf8"),
  );

  return {
    expectedFiles,
    executionSha,
    mainSha,
    contractVersion,
    canonicalContractSha256,
    canonicalRegistrySha256,
    recordCount: records.length,
    requiredRecordCount: requiredRecords.length,
    diagnosticRecordCount: diagnosticRecords.length,
    importedFileCount: importedFiles.length,
  };
}

async function assertImportedRootsClean(sourceRoot: string): Promise<void> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=all", "--", ...IMPORTED_ROOTS],
    { encoding: "utf8" },
  );
  if (stdout.trim().length > 0) {
    throw new Error("SDAR_EVIDENCE_CONTRACT_SOURCE_DIRTY: imported paths must match executionSha");
  }
}

async function gitRevision(sourceRoot: string, revision: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", sourceRoot, "rev-parse", "--verify", `${revision}^{commit}`],
      { encoding: "utf8" },
    );
    const sha = stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error("not a full commit SHA");
    }
    return sha;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`SDAR_EVIDENCE_CONTRACT_GIT_REVISION_INVALID: ${revision}: ${detail}`);
  }
}

async function collectImportedFiles(sourceRoot: string): Promise<ImportedFile[]> {
  const paths: string[] = [];
  for (const importedRoot of IMPORTED_ROOTS) {
    const absoluteRoot = path.join(sourceRoot, importedRoot);
    await assertDirectory(absoluteRoot, `SDAR_EVIDENCE_CONTRACT_IMPORTED_ROOT_MISSING: ${importedRoot}`);
    await collectRegularFiles(sourceRoot, absoluteRoot, paths);
  }
  paths.sort();
  const files = await Promise.all(paths.map(async (relativePath) => {
    const bytes = await readFile(path.join(sourceRoot, relativePath));
    return { path: relativePath, bytes, byteSha256: byteSha256(bytes) };
  }));
  return files;
}

async function collectRegularFiles(
  sourceRoot: string,
  directory: string,
  output: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }) as Dirent[];
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `SDAR_EVIDENCE_CONTRACT_SYMLINK_UNSUPPORTED: ${toPosixPath(path.relative(sourceRoot, absolutePath))}`,
      );
    }
    if (entry.isDirectory()) {
      await collectRegularFiles(sourceRoot, absolutePath, output);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `SDAR_EVIDENCE_CONTRACT_NON_FILE_UNSUPPORTED: ${toPosixPath(path.relative(sourceRoot, absolutePath))}`,
      );
    }
    output.push(toPosixPath(path.relative(sourceRoot, absolutePath)));
  }
}

async function verifySchemaHashes(
  importedByPath: Map<string, Buffer>,
  registry: JsonObject,
  records: RegistryRecord[],
): Promise<void> {
  for (const record of records) {
    const importedPath = `schemas/evidence/v1/${record.schemaPath}`;
    const schema = parseObject(requiredImportedText(importedByPath, importedPath));
    assertEqual(
      canonicalSha256(schema),
      record.schemaHash,
      `RECORD_SCHEMA_HASH_INVALID:${record.recordType}`,
    );
  }

  const protocolSchemas = requiredObjectArray(registry, "protocolSchemas");
  for (const entry of protocolSchemas) {
    const schemaPath = requiredString(entry, "schemaPath");
    const importedPath = `schemas/evidence/v1/${schemaPath}`;
    const schema = parseObject(requiredImportedText(importedByPath, importedPath));
    assertEqual(
      canonicalSha256(schema),
      requiredString(entry, "schemaHash"),
      `PROTOCOL_SCHEMA_HASH_INVALID:${schemaPath}`,
    );
  }
}

async function findDrift(targetRoot: string, expectedFiles: Map<string, Buffer>): Promise<string[]> {
  const targetStat = await safeLstat(targetRoot);
  if (!targetStat?.isDirectory()) {
    return ["snapshot directory is missing"];
  }

  const actualPaths: string[] = [];
  await collectRegularFiles(targetRoot, targetRoot, actualPaths);
  actualPaths.sort();
  const expectedPaths = [...expectedFiles.keys()].sort();
  const actualSet = new Set(actualPaths);
  const expectedSet = new Set(expectedPaths);
  const drift: string[] = [];

  for (const relativePath of expectedPaths) {
    if (!actualSet.has(relativePath)) {
      drift.push(`missing ${relativePath}`);
      continue;
    }
    const actual = await readFile(path.join(targetRoot, relativePath));
    const expected = expectedFiles.get(relativePath);
    if (!expected || !actual.equals(expected)) {
      drift.push(`content ${relativePath}`);
    }
  }
  for (const relativePath of actualPaths) {
    if (!expectedSet.has(relativePath)) {
      drift.push(`unexpected ${relativePath}`);
    }
  }
  return drift.slice(0, 20);
}

async function replaceSnapshot(targetRoot: string, expectedFiles: Map<string, Buffer>): Promise<void> {
  const targetParent = path.dirname(targetRoot);
  await mkdir(targetParent, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(targetParent, ".v1.4.1-sync-"));
  try {
    for (const [relativePath, bytes] of [...expectedFiles.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const outputPath = path.join(stagingRoot, relativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
    }
    await rm(targetRoot, { recursive: true, force: true });
    await rename(stagingRoot, targetRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function parseRegistryRecords(value: unknown): RegistryRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("SDAR_EVIDENCE_CONTRACT_RECORDS_INVALID");
  }
  return value.map((candidate, index) => {
    if (!isObject(candidate)) {
      throw new Error(`SDAR_EVIDENCE_CONTRACT_RECORD_INVALID: index ${index}`);
    }
    const evaluationRole = requiredString(candidate, "evaluationRole");
    if (evaluationRole !== "required" && evaluationRole !== "diagnostic") {
      throw new Error(`SDAR_EVIDENCE_CONTRACT_EVALUATION_ROLE_INVALID: index ${index}`);
    }
    const schemaVersion = candidate["schemaVersion"];
    if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 1) {
      throw new Error(`SDAR_EVIDENCE_CONTRACT_SCHEMA_VERSION_INVALID: index ${index}`);
    }
    return {
      ...candidate,
      recordType: requiredString(candidate, "recordType"),
      recordFamily: requiredString(candidate, "recordFamily"),
      evaluationRole,
      requirementLevel: requiredString(candidate, "requirementLevel"),
      schemaName: requiredString(candidate, "schemaName"),
      schemaVersion: schemaVersion as number,
      schemaPath: requiredSafeRelativePath(candidate, "schemaPath"),
      schemaHash: requiredSha256(candidate, "schemaHash"),
    };
  });
}

function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("SDAR_EVIDENCE_CONTRACT_CANONICAL_NUMBER_INVALID");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`SDAR_EVIDENCE_CONTRACT_CANONICAL_TYPE_INVALID: ${typeof value}`);
}

function requiredImportedText(files: Map<string, Buffer>, relativePath: string): string {
  const value = files.get(relativePath);
  if (!value) {
    throw new Error(`SDAR_EVIDENCE_CONTRACT_REQUIRED_FILE_MISSING: ${relativePath}`);
  }
  return value.toString("utf8");
}

function parseObject(text: string): JsonObject {
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) {
    throw new Error("SDAR_EVIDENCE_CONTRACT_JSON_OBJECT_REQUIRED");
  }
  return value;
}

function requiredObjectArray(value: JsonObject, field: string): JsonObject[] {
  const candidate = value[field];
  if (!Array.isArray(candidate) || candidate.some((entry) => !isObject(entry))) {
    throw new Error(`SDAR_EVIDENCE_CONTRACT_${field.toUpperCase()}_INVALID`);
  }
  return candidate as JsonObject[];
}

function requiredString(value: JsonObject, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`SDAR_EVIDENCE_CONTRACT_${field.toUpperCase()}_INVALID`);
  }
  return candidate;
}

function requiredSha256(value: JsonObject, field: string): string {
  const candidate = requiredString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(candidate)) {
    throw new Error(`SDAR_EVIDENCE_CONTRACT_${field.toUpperCase()}_INVALID`);
  }
  return candidate;
}

function requiredSafeRelativePath(value: JsonObject, field: string): string {
  const candidate = requiredString(value, field);
  if (
    path.isAbsolute(candidate) ||
    candidate.split(/[\\/]/u).some((segment) => segment === ".." || segment.length === 0)
  ) {
    throw new Error(`SDAR_EVIDENCE_CONTRACT_${field.toUpperCase()}_INVALID`);
  }
  return toPosixPath(candidate);
}

function assertEqual(actual: unknown, expected: unknown, code: string): void {
  if (actual !== expected) {
    throw new Error(`SDAR_EVIDENCE_CONTRACT_${code}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function assertDirectory(directory: string, code: string): Promise<void> {
  const stat = await safeLstat(directory);
  if (!stat?.isDirectory()) {
    throw new Error(code);
  }
}

async function safeLstat(candidate: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return isObject(error) && error["code"] === "ENOENT";
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteSha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function summary(action: "synced" | "checked", snapshot: Snapshot) {
  return {
    action,
    executionSha: snapshot.executionSha,
    mainSha: snapshot.mainSha,
    contractVersion: snapshot.contractVersion,
    canonicalContractSha256: snapshot.canonicalContractSha256,
    canonicalRegistrySha256: snapshot.canonicalRegistrySha256,
    records: snapshot.recordCount,
    required: snapshot.requiredRecordCount,
    diagnostic: snapshot.diagnosticRecordCount,
    importedFiles: snapshot.importedFileCount,
  };
}

function readme(input: {
  executionSha: string;
  mainSha: string;
  contractVersion: string;
  canonicalContractSha256: string;
  canonicalRegistrySha256: string;
  importedFileCount: number;
}): string {
  return `# SDAR Evidence v1.4.1 contract snapshot

This directory is the byte-locked Telemetry import of the Runtime-owned Evidence contract. Runtime PostgreSQL remains the authority; this snapshot defines the receiver boundary only.

## Locked source

- Execution SHA: \`${input.executionSha}\`
- Main SHA: \`${input.mainSha}\`
- Contract version: \`${input.contractVersion}\`
- Canonical contract SHA-256: \`${input.canonicalContractSha256}\`
- Canonical registry SHA-256: \`${input.canonicalRegistrySha256}\`
- Imported source files: ${input.importedFileCount}

Canonical hashes are computed from Runtime's canonical Evidence JSON. Every imported file has a separately named \`byteSha256\` in \`source-lock.json\`; a file-byte hash must not be substituted for a canonical contract hash.

## Refresh and verify

From the Telemetry repository root, with the Runtime repository at the default adjacent path \`../skill-driven-agent-runtime\`:

\`\`\`sh
npm run sync:sdar-evidence-contract
npm run check:sdar-evidence-contract
\`\`\`

Pass \`--source /path/to/skill-driven-agent-runtime\` directly to the TypeScript script when the checkout is elsewhere. Check mode recalculates Git revisions, canonical hashes, record counts, imported file bytes, and generated metadata; it emits \`SDAR_EVIDENCE_CONTRACT_DRIFT\` and writes nothing when the snapshot differs.

## Compatibility boundary

The files in the parent integration directory describe older SDAR mappings and are **compatibility-only**. They are not authoritative for \`sdar.evidence/v1\`. New ingestion must use this snapshot's protocol, schemas, and ClickHouse handoff.
`;
}
