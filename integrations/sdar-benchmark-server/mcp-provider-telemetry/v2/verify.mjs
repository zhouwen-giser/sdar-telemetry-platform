#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "handoff-manifest.json"), "utf8"));
if (manifest.contract !== "sdar.telemetry-smpp-providerops-handoff/v2") throw new Error("HANDOFF_V2_CONTRACT_INVALID");
for (const asset of manifest.assets) {
  const body = await readFile(join(root, asset.path));
  const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  if (body.byteLength !== asset.bytes || digest !== asset.byteSha256) throw new Error(`HANDOFF_V2_ASSET_DRIFT:${asset.path}`);
}
const readiness = JSON.parse(await readFile(join(root, "readiness-contract.json"), "utf8"));
if (readiness.v1FallbackAllowed !== false) throw new Error("HANDOFF_V1_FALLBACK_FORBIDDEN");
console.log(`SMPP_BENCHMARK_HANDOFF_V2_STATIC_PASS assets=${manifest.assets.length}`);
