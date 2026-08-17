import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DOMAIN_SOURCE_V1_CONTRACT,
  DOMAIN_SOURCE_V1_HEADER,
  createDomainSourceBatchHash,
  createDomainSourcePayloadHash,
  loadDomainSourceV1Validator,
  type DomainSourceBatchRequest,
  type DomainSourceEpisodeSealRequest,
  type DomainSourceWalPayload,
} from "../../packages/telemetry-contracts/src/index.js";
import type {
  EvidenceV1BatchRequest,
  EvidenceV1WalPayload,
} from "../../packages/telemetry-types/src/index.js";
import {
  DurableSegmentWal,
  type WalDurabilityEvent,
} from "../../packages/telemetry-wal/src/index.js";
import {
  createIngestionGateway,
  domainSourceWalPartition,
} from "../../apps/ingestion-gateway/src/server.js";
import {
  DOMAIN_SOURCE_V1_TABLE_ALLOWLIST,
  DomainSourceLandingWorker,
} from "../../apps/telemetry-worker/src/domain-source-worker.js";

const credential = "domain-source-test-token-12345";
const fixtureRoot = path.join(
  process.cwd(),
  "integrations",
  "domain-source",
  "contracts",
  "v1",
  "fixtures",
  "valid",
);
const validatorPromise = loadDomainSourceV1Validator();

test("Domain Source HEAD and POST require the independent exact contract header and credential", async () => {
  await withGateway(async ({ baseUrl, domainWal }) => {
    const head = await fetch(`${baseUrl}/v1/domain-source/batches`, {
      method: "HEAD",
      headers: headers(false),
    });
    assert.equal(head.status, 204);

    const invalidHeaders: Record<string, string>[] = [
      { authorization: `Bearer ${credential}` },
      { ...headers(), [DOMAIN_SOURCE_V1_HEADER]: "sdar.domain-source/v0" },
      { ...headers(), authorization: "Bearer wrong-token-value" },
      { ...headers(), "x-sdar-evidence-contract": "sdar.evidence/v1" },
    ];
    for (const requestHeaders of invalidHeaders) {
      const response = await fetch(`${baseUrl}/v1/domain-source/batches`, {
        method: "POST",
        headers: requestHeaders,
        body: "{}",
      });
      assert.ok(response.status === 400 || response.status === 401);
    }
    assert.equal(await domainWal.size(), 0);
  });
});

test("batch ACK is returned only after the immutable WAL segment and directory are fsynced", async () => {
  const events: WalDurabilityEvent[] = [];
  await withGateway(
    async ({ baseUrl, domainWal }) => {
      const batch = await commanderBatch();
      const response = await post(baseUrl, "/v1/domain-source/batches", batch);
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { lastAcknowledgedSequence: batch.lastSequence });
      const commit = events.slice(-3).map((event) => event.operation);
      assert.deepEqual(commit, ["fsync-file", "rename", "fsync-directory"]);
      assert.equal((await domainWal.recover(partitionForBatch(batch))).length, 1);
    },
    events,
  );
});

test("restart duplicate is idempotent while identity and sequence conflicts never append", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-source-restart-"));
  try {
    const batch = await commanderBatch();
    const firstWal = new DurableSegmentWal<DomainSourceWalPayload>(path.join(root, "domain"));
    const first = await startGateway(root, firstWal);
    assert.equal((await post(first.baseUrl, "/v1/domain-source/batches", batch)).status, 202);
    await close(first.server);
    const bytes = await firstWal.size();

    const restartedWal = new DurableSegmentWal<DomainSourceWalPayload>(path.join(root, "domain"));
    const restarted = await startGateway(root, restartedWal);
    try {
      assert.equal((await post(restarted.baseUrl, "/v1/domain-source/batches", batch)).status, 202);
      assert.equal(await restartedWal.size(), bytes);

      const repackagedDuplicate = structuredClone(batch) as MutableBatch;
      repackagedDuplicate.batchId = `${batch.batchId}-retry-envelope`;
      resign(repackagedDuplicate);
      assert.equal(
        (await post(restarted.baseUrl, "/v1/domain-source/batches", repackagedDuplicate)).status,
        202,
      );
      assert.equal(await restartedWal.size(), bytes);

      const conflict = structuredClone(batch) as MutableBatch;
      conflict.records[0]!.payload.riskLevel = "high";
      conflict.records[0]!.payloadHash = createDomainSourcePayloadHash(conflict.records[0]!.payload);
      resign(conflict);
      const conflictResponse = await post(
        restarted.baseUrl,
        "/v1/domain-source/batches",
        conflict,
      );
      assert.equal(conflictResponse.status, 409);
      assert.deepEqual(await conflictResponse.json(), {
        errorCode: "DOMAIN_SOURCE_RECORD_HASH_CONFLICT",
      });
      assert.equal(await restartedWal.size(), bytes);
    } finally {
      await close(restarted.server);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Episode Seal duplicate is durable and a same-identity content change conflicts", async () => {
  await withGateway(async ({ baseUrl, domainWal }) => {
    const seal = await commanderSeal();
    const first = await post(baseUrl, "/v1/domain-source/episode-seals", seal);
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { sealId: seal.sealId, sealRevision: seal.sealRevision });
    const bytes = await domainWal.size();
    assert.equal((await post(baseUrl, "/v1/domain-source/episode-seals", seal)).status, 202);
    assert.equal(await domainWal.size(), bytes);

    const conflict = structuredClone(seal) as MutableSeal;
    conflict.payload.reason = "changed after seal";
    const response = await post(baseUrl, "/v1/domain-source/episode-seals", conflict);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { errorCode: "DOMAIN_SOURCE_SEAL_CONFLICT" });
    assert.equal(await domainWal.size(), bytes);
  });
});

test("landing worker routes 10 records and 2 seals only to the twelve exact RC2 allowlisted tables", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-source-worker-"));
  try {
    const wal = new DurableSegmentWal<DomainSourceWalPayload>(path.join(root, "wal"));
    const receiverRoot = path.join(root, "gateway");
    const running = await startGateway(receiverRoot, wal);
    const commander = await commanderBatch();
    const npc = await npcBatch();
    const commanderSealValue = await commanderSeal();
    const npcSealValue = await npcSeal();
    try {
      assert.equal((await post(running.baseUrl, "/v1/domain-source/batches", commander)).status, 202);
      assert.equal((await post(running.baseUrl, "/v1/domain-source/batches", npc)).status, 202);
      assert.equal((await post(running.baseUrl, "/v1/domain-source/episode-seals", commanderSealValue)).status, 202);
      assert.equal((await post(running.baseUrl, "/v1/domain-source/episode-seals", npcSealValue)).status, 202);
    } finally {
      await close(running.server);
    }

    const calls: Array<{ table: string; rows: Record<string, unknown>[]; token?: string }> = [];
    const worker = new DomainSourceLandingWorker({
      wal,
      validator: await validatorPromise,
      stateRoot: path.join(root, "worker"),
      clickhouse: {
        async insert(table, rows, options): Promise<void> {
          calls.push({ table, rows, token: options?.deduplicationToken });
        },
      },
      clock: { now: () => "2026-08-17T09:00:00.000Z" },
    });
    const result = await worker.processOnce();
    assert.deepEqual(result, { partitionsVisited: 2, framesCompleted: 4, writesCompleted: 12 });
    assert.deepEqual(
      calls.map((call) => call.table).sort(),
      [...DOMAIN_SOURCE_V1_TABLE_ALLOWLIST].sort(),
    );
    assert.equal(new Set(calls.map((call) => call.token)).size, 12);
    assert.ok(calls.every((call) => call.rows.length === 1));
    assert.ok(calls.every((call) => call.rows[0]?.["ingested_at"] === "2026-08-17T08:30:00.000Z"));
    assert.deepEqual(await worker.processOnce(), {
      partitionsVisited: 2,
      framesCompleted: 0,
      writesCompleted: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

interface Harness {
  readonly baseUrl: string;
  readonly server: Server;
  readonly domainWal: DurableSegmentWal<DomainSourceWalPayload>;
}

async function withGateway(
  operation: (harness: Harness) => Promise<void>,
  durabilityEvents: WalDurabilityEvent[] = [],
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "domain-source-gateway-"));
  const wal = new DurableSegmentWal<DomainSourceWalPayload>(path.join(root, "domain"), undefined, {
    onDurabilityEvent: (event) => durabilityEvents.push(event),
  });
  const running = await startGateway(root, wal);
  try {
    await operation({ ...running, domainWal: wal });
  } finally {
    await close(running.server);
    await rm(root, { recursive: true, force: true });
  }
}

async function startGateway(
  root: string,
  domainWal: DurableSegmentWal<DomainSourceWalPayload>,
): Promise<{ baseUrl: string; server: Server }> {
  const evidenceWal = new DurableSegmentWal<EvidenceV1WalPayload>(path.join(root, "evidence"));
  const server = createIngestionGateway({
    validator: {
      assertBatch(): EvidenceV1BatchRequest {
        throw new Error("EVIDENCE_ROUTE_NOT_USED");
      },
    },
    wal: evidenceWal,
    bearerCredential: "unused-evidence-token-12345",
    clock: { now: () => "2026-08-17T08:30:00.000Z" },
    domainSource: {
      validator: await validatorPromise,
      wal: domainWal,
      bearerCredential: credential,
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("ADDRESS_INVALID");
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
  });
}

function headers(contentType = true): Record<string, string> {
  return {
    authorization: `Bearer ${credential}`,
    [DOMAIN_SOURCE_V1_HEADER]: DOMAIN_SOURCE_V1_CONTRACT,
    ...(contentType ? { "content-type": "application/json" } : {}),
  };
}

async function post(baseUrl: string, route: string, value: unknown): Promise<Response> {
  return fetch(`${baseUrl}${route}`, { method: "POST", headers: headers(), body: JSON.stringify(value) });
}

function partitionForBatch(batch: DomainSourceBatchRequest): string {
  return domainSourceWalPartition({
    application: batch.application,
    tenantId: batch.records[0]!.tenantId,
    projectId: batch.records[0]!.projectId,
  });
}

async function commanderBatch(): Promise<DomainSourceBatchRequest> {
  return fixture<DomainSourceBatchRequest>("commander-five-records.batch.json");
}

async function npcBatch(): Promise<DomainSourceBatchRequest> {
  return fixture<DomainSourceBatchRequest>("npc-five-records.batch.json");
}

async function commanderSeal(): Promise<DomainSourceEpisodeSealRequest> {
  return fixture<DomainSourceEpisodeSealRequest>("commander-source.seal.json");
}

async function npcSeal(): Promise<DomainSourceEpisodeSealRequest> {
  return fixture<DomainSourceEpisodeSealRequest>("npc-source.seal.json");
}

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")) as T;
}

type MutableBatch = {
  -readonly [K in keyof DomainSourceBatchRequest]: K extends "records"
    ? Array<Omit<DomainSourceBatchRequest["records"][number], "payload"> & {
        payloadHash: `sha256:${string}`;
        payload: Record<string, unknown>;
      }>
    : DomainSourceBatchRequest[K];
};

type MutableSeal = Omit<DomainSourceEpisodeSealRequest, "payload"> & {
  payload: Record<string, unknown>;
};

function resign(batch: MutableBatch): void {
  const { batchHash: _old, ...unsigned } = batch;
  batch.batchHash = createDomainSourceBatchHash(unsigned);
}
