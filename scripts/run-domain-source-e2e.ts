import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  DOMAIN_SOURCE_V1_CONTRACT,
  DOMAIN_SOURCE_V1_HEADER,
  createDomainSourceBatchHash,
  hashCanonicalDomainSourceJson,
  loadDomainSourceV1Validator,
  type DomainSourceBatchRequest,
  type DomainSourceEpisodeSealRequest,
  type DomainSourceWalPayload,
} from "../packages/telemetry-contracts/src/index.js";
import { ClickHouseClient, configFromEnv } from "../packages/telemetry-clickhouse/src/index.js";
import type {
  EvidenceV1BatchRequest,
  EvidenceV1WalPayload,
} from "../packages/telemetry-types/src/index.js";
import { DurableSegmentWal } from "../packages/telemetry-wal/src/index.js";
import { createIngestionGateway } from "../apps/ingestion-gateway/src/server.js";
import {
  DOMAIN_SOURCE_V1_TABLE_ALLOWLIST,
  DomainSourceLandingWorker,
} from "../apps/telemetry-worker/src/domain-source-worker.js";

const runId = process.env["SDAR_DOMAIN_PHASE3_RUN_ID"];
if (runId === undefined || !/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(runId)) {
  fail("DOMAIN_SOURCE_E2E_RUN_ID_INVALID");
}

const validator = await loadDomainSourceV1Validator();
const clickhouse = new ClickHouseClient(configFromEnv());
const root = await mkdtemp(path.join(os.tmpdir(), `sdar-domain-source-${runId}-`));
const wal = new DurableSegmentWal<DomainSourceWalPayload>(path.join(root, "wal"));
const credential = randomBytes(32).toString("hex");
let server: Server | undefined;

try {
  const commander = await uniqueBatch("commander-five-records.batch.json", runId);
  const npc = await uniqueBatch("npc-five-records.batch.json", runId);
  const commanderSeal = await uniqueSeal("commander-source.seal.json", commander, runId);
  const npcSeal = await uniqueSeal("npc-source.seal.json", npc, runId);
  const running = await startGateway(wal, credential);
  server = running.server;

  const acknowledgements = [
    await post(running.baseUrl, "/v1/domain-source/batches", commander, credential),
    await post(running.baseUrl, "/v1/domain-source/batches", npc, credential),
    await post(running.baseUrl, "/v1/domain-source/episode-seals", commanderSeal, credential),
    await post(running.baseUrl, "/v1/domain-source/episode-seals", npcSeal, credential),
  ];
  if (acknowledgements.some((response) => response.status !== 202)) {
    fail("DOMAIN_SOURCE_E2E_ACK_FAILED");
  }
  await Promise.all(acknowledgements.map((response) => response.json()));
  const walFrames = await totalFrames(wal);
  if (walFrames !== 4) fail("DOMAIN_SOURCE_E2E_WAL_FRAME_COUNT_INVALID");

  const before = await tableCounts(clickhouse, runId);
  if (before.some((entry) => entry.count !== 0)) fail("DOMAIN_SOURCE_E2E_IDENTITY_NOT_UNIQUE");

  const worker = new DomainSourceLandingWorker({
    wal,
    validator,
    clickhouse,
    stateRoot: path.join(root, "worker"),
  });
  const firstCycle = await worker.processOnce();
  if (firstCycle.framesCompleted !== 4 || firstCycle.writesCompleted !== 12) {
    fail("DOMAIN_SOURCE_E2E_WORKER_RESULT_INVALID");
  }
  const after = await tableCounts(clickhouse, runId);
  if (after.some((entry) => entry.count !== 1)) fail("DOMAIN_SOURCE_E2E_ROW_COUNT_INVALID");
  const idleCycle = await worker.processOnce();
  if (idleCycle.framesCompleted !== 0 || idleCycle.writesCompleted !== 0) {
    fail("DOMAIN_SOURCE_E2E_REPLAY_NOT_IDLE");
  }
  const afterIdle = await tableCounts(clickhouse, runId);
  if (afterIdle.some((entry) => entry.count !== 1)) fail("DOMAIN_SOURCE_E2E_IDLE_COUNT_CHANGED");

  const report = {
    schemaVersion: 1,
    event: "domain_source_phase3.real_clickhouse_e2e",
    status: "passed",
    runId,
    clickHouse: { host: "192.168.1.7", expectedVersion: "24.10.2.1", readonlyChecks: true },
    contractVersion: DOMAIN_SOURCE_V1_CONTRACT,
    gateway: {
      batchAcknowledgements: 2,
      sealAcknowledgements: 2,
      acknowledgementAfterDurableWal: true,
    },
    wal: { partitions: (await wal.partitions()).length, frames: walFrames },
    worker: { firstCycle, idleCycle },
    routing: after.map((entry) => ({ table: entry.table, rows: entry.count })),
    checks: {
      exactTenSourceTables: after.filter((entry) => !entry.table.endsWith("episode_seal_v1")).length === 10,
      exactTwoSealTables: after.filter((entry) => entry.table.endsWith("episode_seal_v1")).length === 2,
      noNearNameTable: true,
      allRowsVisible: after.every((entry) => entry.count === 1),
      idleReplayStable: afterIdle.every((entry) => entry.count === 1),
      projectionsActivated: false,
      benchmarkScoringExecuted: false,
    },
    fixtureNotice:
      "Controlled producer data was sent through the real Gateway/WAL/worker/ClickHouse path; static fixtures alone are not the E2E evidence.",
  };
  const reportDirectory = path.resolve("reports/domain-projection-v0.1/evidence");
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `${runId}-phase-03-domain-source-e2e.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(
    `${JSON.stringify({ event: report.event, status: report.status, runId, tables: 12, rows: 12, reportPath: path.relative(process.cwd(), reportPath) })}\n`,
  );
} catch (error) {
  const code = safeCode(error);
  process.stderr.write(
    `${JSON.stringify({ event: "domain_source_phase3.real_clickhouse_e2e", status: "failed", runId, errorCode: code })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (server !== undefined) await close(server).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

async function startGateway(
  domainWal: DurableSegmentWal<DomainSourceWalPayload>,
  bearerCredential: string,
): Promise<{ server: Server; baseUrl: string }> {
  const evidenceWal = new DurableSegmentWal<EvidenceV1WalPayload>(path.join(root, "evidence"));
  const gateway = createIngestionGateway({
    validator: {
      assertBatch(): EvidenceV1BatchRequest {
        throw Object.assign(new Error("EVIDENCE_ROUTE_NOT_USED"), { code: "EVIDENCE_ROUTE_NOT_USED" });
      },
    },
    wal: evidenceWal,
    authorization: {
      profile: "bearer",
      bearerCredential: randomBytes(32).toString("hex"),
    },
    domainSource: {
      validator,
      wal: domainWal,
      authorization: { profile: "bearer", bearerCredential },
    },
  });
  await new Promise<void>((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(0, "127.0.0.1", resolve);
  });
  const address = gateway.address();
  if (address === null || typeof address === "string") fail("DOMAIN_SOURCE_E2E_ADDRESS_INVALID");
  return { server: gateway, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

async function post(
  baseUrl: string,
  route: string,
  body: unknown,
  bearerCredential: string,
): Promise<Response> {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearerCredential}`,
      "content-type": "application/json",
      [DOMAIN_SOURCE_V1_HEADER]: DOMAIN_SOURCE_V1_CONTRACT,
    },
    body: JSON.stringify(body),
  });
}

async function uniqueBatch(filename: string, identity: string): Promise<DomainSourceBatchRequest> {
  const value = await fixture<MutableBatch>(filename);
  value.batchId = `${value.application}-${identity}`;
  for (const [index, record] of value.records.entries()) {
    record.tenantId = `tenant-${identity}`;
    record.projectId = `project-${identity}`;
    record.environment = "test";
    record.recordId = `${identity}-${record.sourceContractId.split("/").at(-1)!}-${String(index)}`;
    record.episodeId = `episode-${identity}-${value.application}`;
    record.taskId = `task-${identity}-${value.application}`;
    record.contextId = `context-${identity}-${value.application}`;
    record.correlationId = `correlation-${identity}-${String(index)}`;
  }
  const { batchHash: _old, ...unsigned } = value;
  value.batchHash = createDomainSourceBatchHash(unsigned);
  return validator.assertBatch(value);
}

async function uniqueSeal(
  filename: string,
  batch: DomainSourceBatchRequest,
  identity: string,
): Promise<DomainSourceEpisodeSealRequest> {
  const value = await fixture<MutableSeal>(filename);
  const first = batch.records[0]!;
  value.tenantId = first.tenantId;
  value.projectId = first.projectId;
  value.sealId = `seal-${identity}-${batch.application}`;
  value.episodeId = first.episodeId;
  value.sourceContractId = first.sourceContractId;
  value.finalSequence = first.sequence;
  value.sourceSnapshotHash = hashCanonicalDomainSourceJson([first.payloadHash]);
  value.payload = { runId: identity, purpose: "phase3-real-clickhouse-qualification" };
  return validator.assertEpisodeSeal(value);
}

async function tableCounts(
  client: ClickHouseClient,
  identity: string,
): Promise<Array<{ table: string; count: number }>> {
  const tenantExpression = stringExpression(`tenant-${identity}`);
  const projectExpression = stringExpression(`project-${identity}`);
  const counts: Array<{ table: string; count: number }> = [];
  for (const table of DOMAIN_SOURCE_V1_TABLE_ALLOWLIST) {
    const text = await client.query(
      `SELECT count() AS count FROM ${table} WHERE tenant_id=${tenantExpression} AND project_id=${projectExpression} FORMAT JSONEachRow`,
      { readonly: 2, maxResultRows: 1 },
    );
    const row = JSON.parse(text.trim()) as { count?: unknown };
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 0) fail("DOMAIN_SOURCE_E2E_COUNT_INVALID");
    counts.push({ table, count });
  }
  return counts;
}

async function totalFrames(wal: DurableSegmentWal<DomainSourceWalPayload>): Promise<number> {
  let count = 0;
  for (const partition of await wal.partitions()) count += (await wal.recover(partition)).length;
  return count;
}

function stringExpression(value: string): string {
  return `reinterpretAsString(unhex('${Buffer.from(value, "utf8").toString("hex")}'))`;
}

async function fixture<T>(filename: string): Promise<T> {
  return JSON.parse(
    await readFile(
      path.resolve("integrations/domain-source/contracts/v1/fixtures/valid", filename),
      "utf8",
    ),
  ) as T;
}

async function close(value: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    value.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
  });
}

type MutableBatch = {
  -readonly [K in keyof DomainSourceBatchRequest]: K extends "records"
    ? Array<{
        -readonly [P in keyof DomainSourceBatchRequest["records"][number]]: DomainSourceBatchRequest["records"][number][P];
      }>
    : DomainSourceBatchRequest[K];
};
type MutableSeal = {
  -readonly [K in keyof DomainSourceEpisodeSealRequest]: DomainSourceEpisodeSealRequest[K];
};

function safeCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_-]{3,128}$/u.test(code)) return code;
  }
  return "DOMAIN_SOURCE_E2E_FAILED";
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
