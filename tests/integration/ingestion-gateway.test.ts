import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EVIDENCE_CONTRACT_HEADER,
  EVIDENCE_CONTRACT_VERSION,
  LEGACY_CONTRACT_HEADER,
  createIngestionGateway,
} from "../../apps/ingestion-gateway/src/server.js";
import {
  createEvidenceRecordId,
  hashCanonicalEvidenceJson,
  loadEvidenceV1Validator,
} from "../../packages/telemetry-contracts/src/index.js";
import type {
  EvidenceV1BatchRequest,
  EvidenceV1Record,
  EvidenceV1WalPayload,
} from "../../packages/telemetry-types/src/index.js";
import type {
  TelemetryHttpAuthorizationPolicy,
} from "../../packages/telemetry-config/src/index.js";
import {
  DurableSegmentWal,
  evidenceWalPartition,
} from "../../packages/telemetry-wal/src/index.js";

const credential = "test-evidence-token-12345";
const integrationRoot = path.join(
  process.cwd(),
  "integrations",
  "skill-driven-agent-runtime",
  "v1.4.1",
);
const schemaRoot = path.join(integrationRoot, "schemas", "evidence", "v1");
const fixturePath = path.join(
  integrationRoot,
  "reports",
  "v1.4.1-evidence",
  "clickhouse-handoff",
  "sample-batches",
  "valid-batch.json",
);
const validatorPromise = loadEvidenceV1Validator(schemaRoot);

test("HEAD probe requires the exact Evidence contract and Bearer credential", async () => {
  await withGateway(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/v1/evidence/batches`, {
      method: "HEAD",
      headers: authorizedHeaders(false),
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });
});

test("rejects missing or wrong auth/header and forbids the legacy header", async () => {
  await withGateway(async ({ baseUrl, wal }) => {
    const cases: Array<{
      name: string;
      headers: Record<string, string>;
      status: number;
      code: string;
    }> = [
      {
        name: "missing contract",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        status: 400,
        code: "EVIDENCE_CONTRACT_HEADER_INVALID",
      },
      {
        name: "wrong contract",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          [EVIDENCE_CONTRACT_HEADER]: "sdar.evidence/v0",
        },
        status: 400,
        code: "EVIDENCE_CONTRACT_HEADER_INVALID",
      },
      {
        name: "missing credential",
        headers: {
          "content-type": "application/json",
          [EVIDENCE_CONTRACT_HEADER]: EVIDENCE_CONTRACT_VERSION,
        },
        status: 401,
        code: "EVIDENCE_CREDENTIAL_INVALID",
      },
      {
        name: "wrong credential",
        headers: {
          authorization: "Bearer definitely-wrong",
          "content-type": "application/json",
          [EVIDENCE_CONTRACT_HEADER]: EVIDENCE_CONTRACT_VERSION,
        },
        status: 401,
        code: "EVIDENCE_CREDENTIAL_INVALID",
      },
      {
        name: "legacy header",
        headers: {
          ...authorizedHeaders(),
          [LEGACY_CONTRACT_HEADER]: "legacy",
        },
        status: 400,
        code: "EVIDENCE_LEGACY_HEADER_FORBIDDEN",
      },
    ];
    for (const item of cases) {
      const response = await fetch(`${baseUrl}/v1/evidence/batches`, {
        method: "POST",
        headers: item.headers,
        body: "{}",
      });
      assert.equal(response.status, item.status, item.name);
      assert.deepEqual(await response.json(), { errorCode: item.code }, item.name);
    }
    assert.deepEqual(await wal.partitions(), []);
  });
});

test("development-anonymous skips only Evidence Bearer verification", async () => {
  await withGateway(
    async ({ baseUrl, wal }) => {
      const invalidContract = await fetch(`${baseUrl}/v1/evidence/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(invalidContract.status, 400);
      assert.deepEqual(await invalidContract.json(), {
        errorCode: "EVIDENCE_CONTRACT_HEADER_INVALID",
      });

      const invalidSchema = await fetch(`${baseUrl}/v1/evidence/batches`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [EVIDENCE_CONTRACT_HEADER]: EVIDENCE_CONTRACT_VERSION,
        },
        body: "{}",
      });
      assert.equal(invalidSchema.status, 400);
      assert.deepEqual(await invalidSchema.json(), { errorCode: "EVIDENCE_SCHEMA_INVALID" });

      const batch = await fixture();
      const accepted = await fetch(`${baseUrl}/v1/evidence/batches`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [EVIDENCE_CONTRACT_HEADER]: EVIDENCE_CONTRACT_VERSION,
        },
        body: JSON.stringify(batch),
      });
      assert.equal(accepted.status, 202);
      assert.equal((await wal.recover(partition(batch))).length, 1);
    },
    { profile: "development-anonymous" },
  );
});

test("POSTs the real runtime fixture and returns the strict one-field acknowledgement", async () => {
  await withGateway(async ({ baseUrl, wal }) => {
    const batch = await fixture();
    const response = await postBatch(baseUrl, batch);
    assert.equal(response.status, 202);
    const acknowledgement = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(acknowledgement), ["lastAcknowledgedSequence"]);
    assert.deepEqual(acknowledgement, { lastAcknowledgedSequence: batch.lastSequence });
    assert.equal((await wal.recover(partition(batch))).length, 1);
  });
});

test("exact duplicate delivery returns the same ACK without growing the WAL", async () => {
  await withGateway(async ({ baseUrl, wal }) => {
    const batch = await fixture();
    assert.equal((await postBatch(baseUrl, batch)).status, 202);
    const bytesAfterFirst = await wal.size();
    const duplicate = await postBatch(baseUrl, batch);
    assert.equal(duplicate.status, 202);
    assert.deepEqual(await duplicate.json(), { lastAcknowledgedSequence: batch.lastSequence });
    assert.equal(await wal.size(), bytesAfterFirst);
    assert.equal((await wal.recover(partition(batch))).length, 1);
  });
});

test("receiver reconstruction from the same WAL keeps duplicate delivery idempotent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-gateway-restart-"));
  try {
    const batch = await fixture();
    const firstWal = new DurableSegmentWal<EvidenceV1WalPayload>(directory);
    const first = await startGateway(firstWal);
    try {
      assert.equal((await postBatch(first.baseUrl, batch)).status, 202);
    } finally {
      await closeServer(first.server);
    }
    const bytesBeforeRestart = await firstWal.size();

    const restartedWal = new DurableSegmentWal<EvidenceV1WalPayload>(directory);
    const restarted = await startGateway(restartedWal);
    try {
      const duplicate = await postBatch(restarted.baseUrl, batch);
      assert.equal(duplicate.status, 202);
      assert.deepEqual(await duplicate.json(), { lastAcknowledgedSequence: batch.lastSequence });
    } finally {
      await closeServer(restarted.server);
    }
    assert.equal(await restartedWal.size(), bytesBeforeRestart);
    assert.equal((await restartedWal.recover(partition(batch))).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects durable record-hash and sequence conflicts without appending", async () => {
  await withGateway(async ({ baseUrl, wal }) => {
    const original = await fixture();
    assert.equal((await postBatch(baseUrl, original)).status, 202);
    const bytesBeforeConflicts = await wal.size();

    const payloadConflict = clone(original);
    (payloadConflict.records[0].payload as Record<string, unknown>)["status"] = "failed";
    payloadConflict.records[0].payloadHash = hashCanonicalEvidenceJson(
      payloadConflict.records[0].payload,
    );
    resign(payloadConflict);
    const payloadResponse = await postBatch(baseUrl, payloadConflict);
    assert.equal(payloadResponse.status, 409);
    assert.deepEqual(await payloadResponse.json(), { errorCode: "EVIDENCE_RECORD_HASH_CONFLICT" });

    const sequenceConflict = clone(original);
    for (const record of sequenceConflict.records) {
      record.sourceRevision = `${record.sourceRevision}-new-identity`;
      record.recordId = createEvidenceRecordId(record);
    }
    resign(sequenceConflict);
    const sequenceResponse = await postBatch(baseUrl, sequenceConflict);
    assert.equal(sequenceResponse.status, 409);
    assert.deepEqual(await sequenceResponse.json(), { errorCode: "EVIDENCE_SEQUENCE_CONFLICT" });

    assert.equal(await wal.size(), bytesBeforeConflicts);
    assert.equal((await wal.recover(partition(original))).length, 1);
  });
});

test("invalid schema and batch hash are rejected before any WAL append", async () => {
  await withGateway(async ({ baseUrl, wal }) => {
    const invalidSchema = clone(await fixture());
    delete (invalidSchema as Partial<MutableBatch>).exportId;
    const schemaResponse = await postBatch(baseUrl, invalidSchema);
    assert.equal(schemaResponse.status, 400);
    assert.deepEqual(await schemaResponse.json(), { errorCode: "EVIDENCE_SCHEMA_INVALID" });

    const invalidHash = clone(await fixture());
    invalidHash.batchHash = `sha256:${"0".repeat(64)}`;
    const hashResponse = await postBatch(baseUrl, invalidHash);
    assert.equal(hashResponse.status, 400);
    assert.deepEqual(await hashResponse.json(), { errorCode: "EVIDENCE_BATCH_HASH_INVALID" });

    assert.equal(await wal.size(), 0);
    assert.deepEqual(await wal.partitions(), []);
  });
});

test("accepts strictly increasing numeric sequence gaps", async () => {
  await withGateway(async ({ baseUrl, wal }) => {
    const batch = clone(await fixture());
    batch.records[1].evidenceSequence = "10";
    batch.lastSequence = "10";
    resign(batch);

    const response = await postBatch(baseUrl, batch);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { lastAcknowledgedSequence: "10" });
    assert.equal((await wal.recover(partition(batch))).length, 1);
  });
});

interface GatewayHarness {
  readonly baseUrl: string;
  readonly server: Server;
  readonly wal: DurableSegmentWal<EvidenceV1WalPayload>;
}

async function withGateway(
  operation: (harness: GatewayHarness) => Promise<void>,
  authorization: TelemetryHttpAuthorizationPolicy = {
    profile: "bearer",
    bearerCredential: credential,
  },
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-gateway-"));
  const wal = new DurableSegmentWal<EvidenceV1WalPayload>(directory);
  const running = await startGateway(wal, authorization);
  try {
    await operation({ ...running, wal });
  } finally {
    await closeServer(running.server);
    await rm(directory, { recursive: true, force: true });
  }
}

async function startGateway(
  wal: DurableSegmentWal<EvidenceV1WalPayload>,
  authorization: TelemetryHttpAuthorizationPolicy = {
    profile: "bearer",
    bearerCredential: credential,
  },
): Promise<{ baseUrl: string; server: Server }> {
  const server = createIngestionGateway({
    validator: await validatorPromise,
    wal,
    authorization,
    clock: { now: () => "2026-08-14T04:05:06.000Z" },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_INVALID");
  return { server, baseUrl: `http://127.0.0.1:${String(address.port)}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function fixture(): Promise<MutableBatch> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as MutableBatch;
}

async function postBatch(baseUrl: string, batch: unknown): Promise<Response> {
  return fetch(`${baseUrl}/v1/evidence/batches`, {
    method: "POST",
    headers: authorizedHeaders(),
    body: JSON.stringify(batch),
  });
}

function authorizedHeaders(includeContentType = true): Record<string, string> {
  return {
    authorization: `Bearer ${credential}`,
    [EVIDENCE_CONTRACT_HEADER]: EVIDENCE_CONTRACT_VERSION,
    ...(includeContentType ? { "content-type": "application/json" } : {}),
  };
}

function partition(batch: EvidenceV1BatchRequest): string {
  return evidenceWalPartition({
    exportId: batch.exportId,
    sourceId: batch.sourceId,
    nodeId: batch.nodeId,
    revision: batch.revision,
  });
}

type MutableRecord = {
  -readonly [K in keyof EvidenceV1Record]: EvidenceV1Record[K];
};
type MutableBatch = {
  -readonly [K in keyof EvidenceV1BatchRequest]: K extends "records"
    ? MutableRecord[]
    : EvidenceV1BatchRequest[K];
};

function clone(batch: EvidenceV1BatchRequest): MutableBatch {
  return JSON.parse(JSON.stringify(batch)) as MutableBatch;
}

function resign(batch: MutableBatch): void {
  const { batchHash: _ignored, ...unsigned } = batch;
  batch.batchHash = hashCanonicalEvidenceJson(unsigned);
}
