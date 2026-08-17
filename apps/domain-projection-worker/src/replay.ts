import type { DomainSourceRecord, DomainSourceSha256 } from "../../../packages/telemetry-contracts/src/index.js";
import type { DomainProjectionDescriptor } from "../../../packages/telemetry-projection-registry/src/domain.js";

import {
  compareDomainSourceCursor,
  type DomainSourceCursor,
  type DomainSourceReadRecord,
} from "./source-reader.js";
import type {
  DomainMappingDecision,
  DomainTerminalCloseInput,
  DomainTerminalClosure,
} from "./target-writer.js";

const MAX_REPLAY_RECORDS = 1_000;

export type DomainBoundedReplayRequest = Readonly<{
  replayRequestId: string;
  descriptor: DomainProjectionDescriptor;
  mappingHash: DomainSourceSha256;
  tenantId: string;
  projectId: string;
  episodeId: string | null;
  fromCursor: DomainSourceCursor;
  toCursor: DomainSourceCursor;
  limit: number;
  projectionRunId: string;
  projectedAt: string;
}>;

export type DomainBoundedReplayResult = Readonly<{
  replayRequestId: string;
  processed: number;
  produced: number;
  duplicate: number;
  skipped: number;
  failed: number;
  blocked: boolean;
}>;

export interface DomainReplaySourcePort {
  readBounded(request: DomainBoundedReplayRequest): Promise<readonly DomainSourceReadRecord[]>;
}

export interface DomainReplayMapperPort {
  map(source: DomainSourceRecord): DomainMappingDecision;
}

export interface DomainReplayClosurePort {
  close(input: DomainTerminalCloseInput): Promise<DomainTerminalClosure>;
}

export class DomainBoundedReplayService {
  constructor(
    private readonly source: DomainReplaySourcePort,
    private readonly mapper: DomainReplayMapperPort,
    private readonly closure: DomainReplayClosurePort,
  ) {}

  async execute(request: DomainBoundedReplayRequest): Promise<DomainBoundedReplayResult> {
    assertReplayRequest(request);
    const records = await this.source.readBounded(request);
    if (records.length > request.limit) throw replayError("DOMAIN_REPLAY_BOUND_EXCEEDED");
    const counts = { produced: 0, duplicate: 0, skipped: 0, failed: 0 };
    let processed = 0;
    for (const item of records) {
      assertReplayRecord(request, item);
      const result = await this.closure.close({
        descriptor: request.descriptor,
        source: item.record,
        decision: this.mapper.map(item.record),
        projectionRunId: request.projectionRunId,
        mappingHash: request.mappingHash,
        sourceCursor: JSON.stringify(item.cursor),
        projectedAt: request.projectedAt,
      });
      processed += 1;
      if (result.outcome === "blocked") {
        return Object.freeze({
          replayRequestId: request.replayRequestId,
          processed,
          ...counts,
          blocked: true,
        });
      }
      counts[result.outcome] += 1;
    }
    return Object.freeze({
      replayRequestId: request.replayRequestId,
      processed,
      ...counts,
      blocked: false,
    });
  }
}

function assertReplayRequest(request: DomainBoundedReplayRequest): void {
  if (
    request.replayRequestId.trim() === "" ||
    request.tenantId.trim() === "" ||
    request.projectId.trim() === "" ||
    (request.episodeId !== null && request.episodeId.trim() === "") ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > MAX_REPLAY_RECORDS ||
    compareDomainSourceCursor(request.fromCursor, request.toCursor) > 0
  ) {
    throw replayError("DOMAIN_REPLAY_SCOPE_INVALID");
  }
}

function assertReplayRecord(
  request: DomainBoundedReplayRequest,
  item: DomainSourceReadRecord,
): void {
  if (
    item.record.sourceContractId !== request.descriptor.sourceContractId ||
    item.record.tenantId !== request.tenantId ||
    item.record.projectId !== request.projectId ||
    (request.episodeId !== null && item.record.episodeId !== request.episodeId) ||
    compareDomainSourceCursor(item.cursor, request.fromCursor) < 0 ||
    compareDomainSourceCursor(item.cursor, request.toCursor) > 0
  ) {
    throw replayError("DOMAIN_REPLAY_SOURCE_OUT_OF_SCOPE");
  }
}

function replayError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
