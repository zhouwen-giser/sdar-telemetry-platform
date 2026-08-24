#!/usr/bin/env node

import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const CACHE_FORMAT = Object.freeze({ content: "content-v2", index: "index-v5" });
const NPM_CONSUMER_VERSION = "10.9.8";
const REGISTRY_ORIGIN = "https://registry.npmjs.org";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function digest(algorithm, value, encoding = "hex") {
  return createHash(algorithm).update(value).digest(encoding);
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    assert(option.startsWith("--"), `unexpected argument: ${option}`);
    if (option === "--self-test") {
      options.selfTest = true;
      continue;
    }
    const value = rest[index + 1];
    assert(value && !value.startsWith("--"), `missing value for ${option}`);
    const name = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    assert(options[name] === undefined, `duplicate option: ${option}`);
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function requirePath(options, name) {
  const value = options[name];
  assert(typeof value === "string" && value.length > 0, `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  return resolve(value);
}

function relativeCachePath(...segments) {
  return ["_cacache", ...segments].join("/");
}

function contentDescriptor(integrity) {
  assert(typeof integrity === "string" && integrity.startsWith("sha512-"), `unsupported integrity: ${integrity}`);
  const encoded = integrity.slice("sha512-".length);
  const bytes = Buffer.from(encoded, "base64");
  assert(bytes.length === 64 && bytes.toString("base64") === encoded, `non-canonical sha512 integrity: ${integrity}`);
  const sha512Hex = bytes.toString("hex");
  return {
    sha512Hex,
    relativePath: relativeCachePath(CACHE_FORMAT.content, "sha512", sha512Hex.slice(0, 2), sha512Hex.slice(2, 4), sha512Hex.slice(4)),
  };
}

function indexDescriptor(resolved) {
  const key = `make-fetch-happen:request-cache:${resolved}`;
  const keySha256 = digest("sha256", key);
  return {
    key,
    keySha256,
    relativePath: relativeCachePath(CACHE_FORMAT.index, keySha256.slice(0, 2), keySha256.slice(2, 4), keySha256.slice(4)),
  };
}

function safeJoin(root, relativePath) {
  assert(!isAbsolute(relativePath), `cache path must be relative: ${relativePath}`);
  const target = resolve(root, relativePath);
  assert(target === root || target.startsWith(`${root}${sep}`), `cache path escapes root: ${relativePath}`);
  return target;
}

async function loadLock(lockPath) {
  const raw = await readFile(lockPath);
  const lock = JSON.parse(raw.toString("utf8"));
  assert(lock.lockfileVersion === 3, "package-lock.json must use lockfileVersion 3");
  assert(lock.packages && typeof lock.packages === "object", "package-lock.json packages graph is missing");
  const packages = Object.entries(lock.packages)
    .filter(([lockPath]) => lockPath !== "")
    .map(([lockPath, entry]) => {
      const name = lockPath.split("node_modules/").at(-1);
      assert(name && typeof entry.version === "string", `locked package identity is incomplete: ${lockPath}`);
      assert(typeof entry.resolved === "string" && typeof entry.integrity === "string", `locked resolution is incomplete: ${lockPath}`);
      const resolved = new URL(entry.resolved);
      assert(resolved.origin === REGISTRY_ORIGIN && resolved.protocol === "https:", `locked package must use exact HTTPS npm registry origin: ${entry.resolved}`);
      assert(!resolved.username && !resolved.password && !resolved.search && !resolved.hash, `locked package URL must not contain credentials, query, or fragment: ${entry.resolved}`);
      const content = contentDescriptor(entry.integrity);
      const index = indexDescriptor(entry.resolved);
      return {
        lockPath,
        name,
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
        licenseObservation: typeof entry.license === "string" ? entry.license : "UNDECLARED",
        contentPath: content.relativePath,
        sha512: content.sha512Hex,
        indexPath: index.relativePath,
        indexKey: index.key,
      };
    })
    .sort((left, right) => left.lockPath.localeCompare(right.lockPath));
  assert(packages.length > 0, "package-lock.json contains no package closure");
  assert(new Set(packages.map(({ contentPath }) => contentPath)).size === packages.length, "package lock contains duplicate content objects");
  assert(new Set(packages.map(({ indexPath }) => indexPath)).size === packages.length, "package lock contains duplicate request-cache keys");
  return { raw, packages };
}

function parseIndexRecords(raw, sourcePath) {
  const records = [];
  for (const line of raw.toString("utf8").split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("\t");
    assert(separator > 0, `malformed cacache index record: ${sourcePath}`);
    const recordHash = line.slice(0, separator);
    const serialized = line.slice(separator + 1);
    assert(recordHash === digest("sha1", serialized), `cacache index record hash mismatch: ${sourcePath}`);
    records.push(JSON.parse(serialized));
  }
  return records;
}

function canonicalIndexBytes(packageEntry, size) {
  const entry = {
    key: packageEntry.indexKey,
    integrity: packageEntry.integrity,
    time: 1,
    size,
    metadata: {
      time: 1,
      url: packageEntry.resolved,
      options: { compress: true },
    },
  };
  const serialized = JSON.stringify(entry);
  return Buffer.from(`\n${digest("sha1", serialized)}\t${serialized}`);
}

async function inspectContent(path, expectedSha512) {
  const metadata = await lstat(path);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `cache content is not a regular file: ${path}`);
  const bytes = await readFile(path);
  const actualSha512 = digest("sha512", bytes);
  assert(actualSha512 === expectedSha512, `cache content SHA-512 mismatch: ${path}`);
  return { bytes, size: bytes.length };
}

function aggregateContentSha256(packages, contentByPath) {
  const aggregate = createHash("sha256");
  for (const packageEntry of packages) {
    const content = contentByPath.get(packageEntry.contentPath);
    aggregate.update(`${packageEntry.integrity}\0${content.length}\0`);
    aggregate.update(content);
  }
  return aggregate.digest("hex");
}

function licenseSummary(packages) {
  const counts = {};
  for (const packageEntry of packages) {
    counts[packageEntry.licenseObservation] = (counts[packageEntry.licenseObservation] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildManifest(lockRaw, packages, contentByPath, indexByPath) {
  const rows = packages.map((packageEntry) => ({
    name: packageEntry.name,
    version: packageEntry.version,
    resolved: packageEntry.resolved,
    integrity: packageEntry.integrity,
    licenseObservation: packageEntry.licenseObservation,
    contentPath: packageEntry.contentPath,
    sha512: packageEntry.sha512,
    size: contentByPath.get(packageEntry.contentPath).length,
    indexPath: packageEntry.indexPath,
  }));
  const contentBytes = rows.reduce((sum, row) => sum + row.size, 0);
  const indexBytes = [...indexByPath.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  return {
    schemaVersion: 1,
    source: {
      lockfile: "package-lock.json",
      lockfileSha256: digest("sha256", lockRaw),
      registryOrigin: REGISTRY_ORIGIN,
    },
    cacheFormat: {
      content: CACHE_FORMAT.content,
      index: CACHE_FORMAT.index,
      npmConsumerVersion: NPM_CONSUMER_VERSION,
      indexMetadataPolicy: "deterministic URL and compression only; no copied host headers, credentials, or timestamps",
    },
    licenseObservationScope: "Values are package-lock metadata observations, not legal review or clearance.",
    licenseObservations: licenseSummary(packages),
    totals: {
      packages: rows.length,
      contentObjects: contentByPath.size,
      indexEntries: indexByPath.size,
      contentBytes,
      indexBytes,
      cacheBytes: contentBytes + indexBytes,
    },
    aggregateContentSha256: aggregateContentSha256(packages, contentByPath),
    packages: rows,
  };
}

async function collectTree(root) {
  const files = [];
  const directories = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const rel = relative(root, absolute).split(sep).join("/");
      assert(!entry.isSymbolicLink(), `vendor cache must not contain symlinks: ${rel}`);
      if (entry.isDirectory()) {
        directories.push(rel);
        await visit(absolute);
      } else {
        assert(entry.isFile(), `vendor cache contains a non-regular entry: ${rel}`);
        files.push(rel);
      }
    }
  }
  await visit(root);
  return { files: files.sort(), directories: directories.sort() };
}

function expectedDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    let current = dirname(file);
    while (current !== ".") {
      directories.add(current.split(sep).join("/"));
      current = dirname(current);
    }
  }
  return [...directories].sort();
}

async function verifyCache(lockPath, cacheRoot) {
  const { raw: lockRaw, packages } = await loadLock(lockPath);
  const contentByPath = new Map();
  const indexByPath = new Map();

  for (const packageEntry of packages) {
    const contentPath = safeJoin(cacheRoot, packageEntry.contentPath);
    const content = await inspectContent(contentPath, packageEntry.sha512);
    contentByPath.set(packageEntry.contentPath, content.bytes);

    const indexPath = safeJoin(cacheRoot, packageEntry.indexPath);
    const actualIndex = await readFile(indexPath);
    const expectedIndex = canonicalIndexBytes(packageEntry, content.size);
    assert(actualIndex.equals(expectedIndex), `canonical cache index mismatch: ${packageEntry.indexPath}`);
    indexByPath.set(packageEntry.indexPath, actualIndex);
  }

  const expectedManifest = buildManifest(lockRaw, packages, contentByPath, indexByPath);
  const manifestPath = join(cacheRoot, "manifest.json");
  const actualManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(JSON.stringify(actualManifest) === JSON.stringify(expectedManifest), "vendor cache manifest does not exactly match package-lock.json and cache content");

  const expectedFiles = [
    "manifest.json",
    ...packages.flatMap(({ contentPath, indexPath }) => [contentPath, indexPath]),
  ].sort();
  const tree = await collectTree(cacheRoot);
  assert(JSON.stringify(tree.files) === JSON.stringify(expectedFiles), "vendor cache contains missing or extra files");
  assert(JSON.stringify(tree.directories) === JSON.stringify(expectedDirectories(expectedFiles)), "vendor cache contains missing or extra directories");
  return expectedManifest;
}

async function materialize(lockPath, sourceCache, outputRoot) {
  const { raw: lockRaw, packages } = await loadLock(lockPath);
  assert(sourceCache !== outputRoot, "source cache and output must differ");
  assert(!sourceCache.startsWith(`${outputRoot}${sep}`) && !outputRoot.startsWith(`${sourceCache}${sep}`), "source cache and output must not contain one another");

  const temporaryOutput = `${outputRoot}.tmp-${process.pid}`;
  await rm(temporaryOutput, { recursive: true, force: true });
  await mkdir(temporaryOutput, { recursive: true });
  const contentByPath = new Map();
  const indexByPath = new Map();

  try {
    for (const packageEntry of packages) {
      const sourceContentPath = safeJoin(sourceCache, packageEntry.contentPath.replace(/^_cacache\//, ""));
      const content = await inspectContent(sourceContentPath, packageEntry.sha512);
      contentByPath.set(packageEntry.contentPath, content.bytes);

      const sourceIndexPath = safeJoin(sourceCache, packageEntry.indexPath.replace(/^_cacache\//, ""));
      const records = parseIndexRecords(await readFile(sourceIndexPath), sourceIndexPath);
      const matching = records.filter((record) => record.key === packageEntry.indexKey).at(-1);
      assert(matching, `source cache index key is missing: ${packageEntry.resolved}`);
      assert(matching.integrity === packageEntry.integrity, `source cache index integrity mismatch: ${packageEntry.resolved}`);
      assert(matching.size === content.size, `source cache index size mismatch: ${packageEntry.resolved}`);
      assert(matching.metadata?.url === packageEntry.resolved, `source cache index URL mismatch: ${packageEntry.resolved}`);

      const outputContentPath = safeJoin(temporaryOutput, packageEntry.contentPath);
      await mkdir(dirname(outputContentPath), { recursive: true });
      await copyFile(sourceContentPath, outputContentPath);

      const outputIndexPath = safeJoin(temporaryOutput, packageEntry.indexPath);
      const canonicalIndex = canonicalIndexBytes(packageEntry, content.size);
      await mkdir(dirname(outputIndexPath), { recursive: true });
      await writeFile(outputIndexPath, canonicalIndex);
      indexByPath.set(packageEntry.indexPath, canonicalIndex);
    }

    const manifest = buildManifest(lockRaw, packages, contentByPath, indexByPath);
    await writeFile(join(temporaryOutput, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyCache(lockPath, temporaryOutput);
    await rm(outputRoot, { recursive: true, force: true });
    await rename(temporaryOutput, outputRoot);
    return manifest;
  } catch (error) {
    await rm(temporaryOutput, { recursive: true, force: true });
    throw error;
  }
}

async function expectVerificationFailure(lockPath, cacheRoot, label, mutate) {
  const fixture = join(cacheRoot, label);
  const source = join(cacheRoot, "source");
  await cp(source, fixture, { recursive: true });
  await mutate(fixture);
  try {
    await verifyCache(lockPath, fixture);
  } catch {
    return;
  }
  fail(`negative verifier fixture unexpectedly passed: ${label}`);
}

async function runNegativeSelfTests(lockPath, sourceCache) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sdar-telemetry-vendor-cache-"));
  const fixtureSource = join(temporaryRoot, "source");
  await cp(sourceCache, fixtureSource, { recursive: true });
  const manifest = JSON.parse(await readFile(join(sourceCache, "manifest.json"), "utf8"));
  const first = manifest.packages[0];
  const second = manifest.packages[1];
  try {
    await expectVerificationFailure(lockPath, temporaryRoot, "missing-content", async (fixture) => {
      await rm(safeJoin(fixture, first.contentPath));
    });
    await expectVerificationFailure(lockPath, temporaryRoot, "flipped-content", async (fixture) => {
      const path = safeJoin(fixture, first.contentPath);
      const bytes = await readFile(path);
      bytes[0] ^= 0xff;
      await writeFile(path, bytes);
    });
    await expectVerificationFailure(lockPath, temporaryRoot, "mismatched-index", async (fixture) => {
      const path = safeJoin(fixture, first.indexPath);
      const [line] = (await readFile(path, "utf8")).trim().split("\n").slice(-1);
      const separator = line.indexOf("\t");
      const record = JSON.parse(line.slice(separator + 1));
      record.integrity = second.integrity;
      const serialized = JSON.stringify(record);
      await writeFile(path, `\n${digest("sha1", serialized)}\t${serialized}`);
    });
    await expectVerificationFailure(lockPath, temporaryRoot, "extra-content", async (fixture) => {
      const path = safeJoin(fixture, relativeCachePath(CACHE_FORMAT.content, "sha512", "ff", "ff", "0".repeat(124)));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "extra");
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const lockPath = requirePath(options, "lock");
  if (command === "materialize") {
    assert(!options.selfTest, "--self-test is only valid with verify");
    const sourceCache = requirePath(options, "sourceCache");
    const outputRoot = requirePath(options, "output");
    const manifest = await materialize(lockPath, sourceCache, outputRoot);
    console.log(JSON.stringify({ status: "PASS", mode: "materialize", ...manifest.totals, aggregateContentSha256: manifest.aggregateContentSha256 }));
    return;
  }
  if (command === "verify") {
    const cacheRoot = requirePath(options, "cache");
    const manifest = await verifyCache(lockPath, cacheRoot);
    if (options.selfTest) await runNegativeSelfTests(lockPath, cacheRoot);
    console.log(JSON.stringify({ status: "PASS", mode: "verify", negativeFixtures: options.selfTest ? 4 : 0, ...manifest.totals, aggregateContentSha256: manifest.aggregateContentSha256 }));
    return;
  }
  fail("usage: vendor-npm-cache.mjs materialize --lock <package-lock> --source-cache <_cacache> --output <vendor-cache> | verify --lock <package-lock> --cache <vendor-cache> [--self-test]");
}

main().catch((error) => {
  console.error(`vendor-npm-cache: FAIL: ${error.message}`);
  process.exitCode = 1;
});
