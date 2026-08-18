import { lstat, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import {
  DOMAIN_PROJECTION_CONTRACT_VERSION,
  DomainProjectionContractError,
  loadDomainProjectionContractValidator,
  type DomainProjectionContractKind,
} from "../packages/telemetry-contracts/src/index.js";

const MAX_ASSET_BYTES = 131_072;
const MAX_FIXTURE_CASES = 256;
const fixtureKinds = Object.freeze([
  "definition",
  "checkpoint",
  "lineage",
  "deadLetter",
  "projectionSet",
] as const satisfies readonly DomainProjectionContractKind[]);

interface FixtureCase {
  readonly path: string;
  readonly kind: DomainProjectionContractKind;
  readonly valid: boolean;
}

interface FixtureManifest {
  readonly contractVersion: typeof DOMAIN_PROJECTION_CONTRACT_VERSION;
  readonly cases: readonly FixtureCase[];
}

class VerificationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "VerificationError";
  }
}

try {
  const fixtureRoot = path.resolve(
    process.cwd(),
    "integrations",
    "domain-projection",
    "contracts",
    "v1",
    "fixtures",
  );
  const manifest = await readFixtureManifest(path.join(fixtureRoot, "manifest.json"));
  assertFixtureManifest(manifest);

  const listedPaths = new Set(manifest.cases.map((fixture) => fixture.path));
  const actualPaths = new Set(await collectFixtureJsonPaths(fixtureRoot));
  if (!sameStringSet(listedPaths, actualPaths)) {
    throw new VerificationError("FIXTURE_DIRECTORY_NOT_CLOSED");
  }

  assertKindCoverage(manifest.cases);
  const validator = await loadDomainProjectionContractValidator();
  let validCount = 0;
  let invalidCount = 0;
  for (const fixture of manifest.cases) {
    const value = await readBoundedJson(path.join(fixtureRoot, ...fixture.path.split("/")));
    let accepted = false;
    try {
      validator.assert(fixture.kind, value);
      accepted = true;
    } catch (error) {
      if (!(error instanceof DomainProjectionContractError)) {
        throw new VerificationError("VALIDATOR_INFRASTRUCTURE_FAILURE");
      }
    }
    if (fixture.valid && !accepted) throw new VerificationError("VALID_FIXTURE_REJECTED");
    if (!fixture.valid && accepted) throw new VerificationError("INVALID_FIXTURE_ACCEPTED");
    if (fixture.valid) validCount += 1;
    else invalidCount += 1;
  }

  process.stdout.write(
    `${JSON.stringify({
      event: "domain_projection_contracts.verified",
      status: "passed",
      contractVersion: DOMAIN_PROJECTION_CONTRACT_VERSION,
      schemaCount: fixtureKinds.length,
      fixtureCount: manifest.cases.length,
      validFixtureCount: validCount,
      invalidFixtureCount: invalidCount,
    })}\n`,
  );
} catch (error) {
  const code = error instanceof VerificationError ? error.code : "UNEXPECTED_FAILURE";
  process.stderr.write(
    `${JSON.stringify({
      event: "domain_projection_contracts.verification_failed",
      status: "failed",
      errorCode: code,
    })}\n`,
  );
  process.exitCode = 1;
}

async function readFixtureManifest(filename: string): Promise<FixtureManifest> {
  return (await readBoundedJson(filename)) as FixtureManifest;
}

function assertFixtureManifest(manifest: FixtureManifest): void {
  if (
    !hasExactKeys(manifest, ["cases", "contractVersion"]) ||
    manifest.contractVersion !== DOMAIN_PROJECTION_CONTRACT_VERSION ||
    !Array.isArray(manifest.cases) ||
    manifest.cases.length === 0 ||
    manifest.cases.length > MAX_FIXTURE_CASES
  ) {
    throw new VerificationError("FIXTURE_MANIFEST_INVALID");
  }

  const seenPaths = new Set<string>();
  for (const fixture of manifest.cases) {
    if (
      !hasExactKeys(fixture, ["kind", "path", "valid"]) ||
      typeof fixture.path !== "string" ||
      typeof fixture.kind !== "string" ||
      typeof fixture.valid !== "boolean" ||
      !isSafeFixturePath(fixture.path) ||
      !(fixtureKinds as readonly string[]).includes(fixture.kind) ||
      fixture.path.startsWith("valid/") !== fixture.valid ||
      seenPaths.has(fixture.path)
    ) {
      throw new VerificationError("FIXTURE_MANIFEST_CASE_INVALID");
    }
    seenPaths.add(fixture.path);
  }
}

function assertKindCoverage(cases: readonly FixtureCase[]): void {
  for (const kind of fixtureKinds) {
    if (
      !cases.some((fixture) => fixture.kind === kind && fixture.valid) ||
      !cases.some((fixture) => fixture.kind === kind && !fixture.valid)
    ) {
      throw new VerificationError("FIXTURE_KIND_COVERAGE_INCOMPLETE");
    }
  }
}

async function collectFixtureJsonPaths(fixtureRoot: string): Promise<string[]> {
  const paths: string[] = [];
  for (const category of ["valid", "invalid"] as const) {
    await collectJsonFiles(path.join(fixtureRoot, category), category, paths, 0);
  }
  return paths.sort(compareStrings);
}

async function collectJsonFiles(
  directory: string,
  relativeDirectory: string,
  output: string[],
  depth: number,
): Promise<void> {
  if (depth > 8) throw new VerificationError("FIXTURE_DIRECTORY_DEPTH_EXCEEDED");
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new VerificationError("FIXTURE_DIRECTORY_UNREADABLE");
  }
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (entry.isSymbolicLink()) throw new VerificationError("FIXTURE_SYMLINK_FORBIDDEN");
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectJsonFiles(filename, relativePath, output, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      if (!isSafeFixturePath(relativePath)) {
        throw new VerificationError("FIXTURE_FILENAME_INVALID");
      }
      output.push(relativePath);
    } else if (!entry.isFile()) {
      throw new VerificationError("FIXTURE_ENTRY_TYPE_FORBIDDEN");
    }
  }
}

async function readBoundedJson(filename: string): Promise<unknown> {
  try {
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_ASSET_BYTES) {
      throw new VerificationError("FIXTURE_ASSET_INVALID");
    }
    return JSON.parse(await readFile(filename, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError("FIXTURE_ASSET_UNREADABLE");
  }
}

function isSafeFixturePath(value: string): boolean {
  return (
    value.length <= 240 &&
    /^(?:valid|invalid)\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.json$/u.test(
      value,
    ) &&
    path.posix.normalize(value) === value &&
    !path.isAbsolute(value) &&
    !value.includes("\\")
  );
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort(compareStrings);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
