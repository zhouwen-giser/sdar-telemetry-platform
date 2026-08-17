import { loadConfig } from "../../../packages/telemetry-config/src/index.js";
import {
  ControlPostgres,
  type DomainProjectionManagementActionType,
} from "../../../packages/telemetry-control-postgres/src/index.js";
import {
  createDomainAdminApi,
  loadAdminBearerCredential,
  type DomainAdminPort,
} from "./server.js";

const databaseUrl = process.env["CONTROL_POSTGRES_URL"];
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("CONTROL_POSTGRES_URL_REQUIRED");
}
const database = new ControlPostgres(databaseUrl);
const repository = database.domainProjections;

const port: DomainAdminPort = {
  registerProducer: async (command) => repository.registerProducer({
    producerId: stringField(command, "producerId"),
    application: enumField(command, "application", ["commander", "npc"]),
    tenantId: stringField(command, "tenantId"),
    projectId: stringField(command, "projectId"),
    contractVersion: "sdar.domain-source/v1",
    credentialRef: stringField(command, "credentialRef"),
    metadata: objectField(command, "metadata"),
  }),
  heartbeatProducer: async (producerId) => {
    const result = await repository.heartbeatProducer(producerId);
    if (result === null) {
      throw Object.assign(new Error("DOMAIN_SOURCE_PRODUCER_NOT_FOUND"), {
        code: "DOMAIN_SOURCE_PRODUCER_NOT_FOUND",
        statusCode: 404,
      });
    }
    return result;
  },
  registerProjectionAction: async (projectionId, command) =>
    repository.registerManagementAction(actionInput(projectionId, command)),
  requestReconciliation: async (projectionId, command) => {
    const payload = objectField(command, "payload");
    return repository.registerReconciliationRequest({
      reconciliationRequestId: stringField(payload, "reconciliationRequestId"),
      projectionId,
      projectionVersion: integerField(command, "projectionVersion", 1),
      mappingHash: stringField(command, "expectedMappingHash"),
      tenantId: stringField(payload, "tenantId"),
      projectId: stringField(payload, "projectId"),
      episodeId: nullableStringField(payload, "episodeId"),
      fromCursor: objectField(payload, "fromCursor"),
      toCursor: objectField(payload, "toCursor"),
      requestedBy: stringField(command, "requestedBy"),
      requestHash: stringField(command, "requestHash"),
    });
  },
  requestReplay: async (projectionId, command) => {
    const payload = objectField(command, "payload");
    return repository.registerReplayRequest({
      replayRequestId: stringField(payload, "replayRequestId"),
      projectionId,
      projectionVersion: integerField(command, "projectionVersion", 1),
      mappingHash: stringField(command, "expectedMappingHash"),
      tenantId: stringField(payload, "tenantId"),
      projectId: stringField(payload, "projectId"),
      episodeId: nullableStringField(payload, "episodeId"),
      fromCursor: objectField(payload, "fromCursor"),
      toCursor: objectField(payload, "toCursor"),
      requestedBy: stringField(command, "requestedBy"),
      requestHash: stringField(command, "requestHash"),
    });
  },
  applyDeadLetterAction: async (deadLetterId, command) => {
    const payload = objectField(command, "payload");
    return repository.registerManagementAction({
      ...actionInput(stringField(payload, "projectionId"), command, "resolve_dead_letter"),
      payload: { ...payload, deadLetterId },
    });
  },
};

const server = createDomainAdminApi({ port, bearerCredential: await loadAdminBearerCredential() });
const configuration = loadConfig();
const bindHost = process.env["ADMIN_BIND_HOST"] ?? "127.0.0.1";
server.listen(configuration.adminPort, bindHost, () => {
  process.stdout.write(`${JSON.stringify({ event: "admin_api.ready", host: bindHost, port: configuration.adminPort })}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => { void database.close().finally(() => process.exit(0)); });
  });
}

function actionInput(
  projectionId: string,
  command: Record<string, unknown>,
  forcedType?: DomainProjectionManagementActionType,
) {
  const actionType = forcedType ?? enumField(command, "actionType", [
    "approve_definition", "set_mode", "suspend", "resume", "resolve_dead_letter",
  ]);
  return {
    actionId: stringField(command, "actionId"),
    projectionId,
    projectionVersion: integerField(command, "projectionVersion", 1),
    actionType,
    expectedRevision: integerField(command, "expectedRevision", 0),
    requestedBy: stringField(command, "requestedBy"),
    requestHash: stringField(command, "requestHash"),
    payload: objectField(command, "payload"),
  };
}

function stringField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim() === "") throw new Error("ADMIN_COMMAND_INVALID");
  return candidate;
}
function nullableStringField(value: Record<string, unknown>, field: string): string | null {
  return value[field] === null || value[field] === undefined ? null : stringField(value, field);
}
function integerField(value: Record<string, unknown>, field: string, minimum: number): number {
  const candidate = value[field];
  if (!Number.isSafeInteger(candidate) || (candidate as number) < minimum) throw new Error("ADMIN_COMMAND_INVALID");
  return candidate as number;
}
function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const candidate = value[field];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) throw new Error("ADMIN_COMMAND_INVALID");
  return candidate as Record<string, unknown>;
}
function enumField<const T extends string>(value: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const candidate = stringField(value, field);
  if (!allowed.includes(candidate as T)) throw new Error("ADMIN_COMMAND_INVALID");
  return candidate as T;
}
