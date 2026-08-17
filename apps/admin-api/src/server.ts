import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

const MAX_ADMIN_BODY_BYTES = 65_536;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export interface DomainAdminPort {
  registerProducer(command: Record<string, unknown>): Promise<unknown>;
  heartbeatProducer(producerId: string): Promise<unknown>;
  registerProjectionAction(projectionId: string, command: Record<string, unknown>): Promise<unknown>;
  requestReconciliation(projectionId: string, command: Record<string, unknown>): Promise<unknown>;
  requestReplay(projectionId: string, command: Record<string, unknown>): Promise<unknown>;
  applyDeadLetterAction(deadLetterId: string, command: Record<string, unknown>): Promise<unknown>;
}

export type DomainAdminCommand = Readonly<{
  kind: "registerProducer" | "heartbeatProducer" | "projectionAction" | "reconcile" | "replay" | "deadLetterAction";
  identity: string;
  body: Readonly<Record<string, unknown>>;
}>;

export function createDomainAdminApi(input: Readonly<{
  port: DomainAdminPort;
  bearerCredential: string;
}>): Server {
  assertCredential(input.bearerCredential);
  const expected = digest(input.bearerCredential);
  return http.createServer((request: IncomingMessage, response: ServerResponse) => {
    void handleRequest(request, response, input.port, expected).catch((error) => sendError(response, error));
  });
}

export async function loadAdminBearerCredential(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const inline = environment["ADMIN_API_BEARER_TOKEN"];
  const file = environment["ADMIN_API_BEARER_TOKEN_FILE"];
  if ((inline === undefined) === (file === undefined)) throw adminError("ADMIN_CREDENTIAL_CONFIGURATION_INVALID", 500);
  const value = inline ?? (await readFile(file!, "utf8")).trim();
  assertCredential(value);
  return value;
}

export function parseDomainAdminCommand(
  method: string,
  pathname: string,
  body: unknown,
): DomainAdminCommand {
  if (method !== "POST") throw adminError("ADMIN_METHOD_INVALID", 405);
  const object = body === null ? {} : assertObject(body);
  if (pathname === "/v1/admin/domain-source-producers") {
    assertFields(object, ["producerId", "application", "tenantId", "projectId", "contractVersion", "credentialRef", "metadata"]);
    if (object["application"] !== "commander" && object["application"] !== "npc") invalid();
    if (object["contractVersion"] !== "sdar.domain-source/v1" || !isObject(object["metadata"])) invalid();
    return command("registerProducer", requiredString(object, "producerId"), object);
  }
  let match = /^\/v1\/admin\/domain-source-producers\/([^/]+)\/heartbeat$/u.exec(pathname);
  if (match !== null) {
    assertFields(object, []);
    return command("heartbeatProducer", decodeIdentity(match[1]!), object);
  }
  match = /^\/v1\/admin\/domain-projections\/([^/]+)\/(actions|reconcile|replay)$/u.exec(pathname);
  if (match !== null) {
    const projectionId = decodeIdentity(match[1]!);
    assertControlEnvelope(object);
    const kind = match[2] === "actions" ? "projectionAction" : match[2] as "reconcile" | "replay";
    return command(kind, projectionId, object);
  }
  match = /^\/v1\/admin\/domain-dead-letters\/([^/]+)\/actions$/u.exec(pathname);
  if (match !== null) {
    assertControlEnvelope(object);
    return command("deadLetterAction", decodeIdentity(match[1]!), object);
  }
  throw adminError("ADMIN_ROUTE_NOT_FOUND", 404);
}

export async function dispatchDomainAdminCommand(
  port: DomainAdminPort,
  value: DomainAdminCommand,
): Promise<unknown> {
  switch (value.kind) {
    case "registerProducer": return port.registerProducer({ ...value.body });
    case "heartbeatProducer": return port.heartbeatProducer(value.identity);
    case "projectionAction": return port.registerProjectionAction(value.identity, { ...value.body });
    case "reconcile": return port.requestReconciliation(value.identity, { ...value.body });
    case "replay": return port.requestReplay(value.identity, { ...value.body });
    case "deadLetterAction": return port.applyDeadLetterAction(value.identity, { ...value.body });
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  port: DomainAdminPort,
  expected: Buffer,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://admin-api.local");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  authorize(request, expected);
  if ([...url.searchParams.keys()].length !== 0) throw adminError("ADMIN_ARGUMENT_INVALID", 400);
  const body = await readBody(request);
  const commandValue = parseDomainAdminCommand(request.method ?? "", url.pathname, body);
  const result = await dispatchDomainAdminCommand(port, commandValue);
  sendJson(response, commandValue.kind === "heartbeatProducer" ? 200 : 202, result);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_ADMIN_BODY_BYTES) throw adminError("ADMIN_BODY_TOO_LARGE", 413);
    chunks.push(buffer);
  }
  if (length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw adminError("ADMIN_BODY_INVALID", 400);
  }
}

function assertControlEnvelope(value: Record<string, unknown>): void {
  const required = ["actionId", "projectionVersion", "expectedRevision", "expectedDefinitionHash", "expectedMappingHash", "requestHash", "requestedBy", "payload"];
  const allowed = new Set([...required, "actionType"]);
  if (Object.keys(value).some((field) => !allowed.has(field))) invalid();
  for (const field of required) {
    if (!(field in value)) invalid();
  }
  requiredString(value, "actionId");
  requiredString(value, "requestedBy");
  for (const field of ["expectedDefinitionHash", "expectedMappingHash", "requestHash"]) {
    if (!SHA256.test(requiredString(value, field))) invalid();
  }
  for (const field of ["projectionVersion", "expectedRevision"]) {
    const candidate = value[field];
    if (!Number.isSafeInteger(candidate) || (candidate as number) < (field === "projectionVersion" ? 1 : 0)) invalid();
  }
  if (!isObject(value["payload"])) invalid();
}

function assertFields(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).sort().join("\u001f") !== [...fields].sort().join("\u001f")) invalid();
}

function command(kind: DomainAdminCommand["kind"], identity: string, body: Record<string, unknown>): DomainAdminCommand {
  return Object.freeze({ kind, identity, body: Object.freeze({ ...body }) });
}

function decodeIdentity(value: string): string {
  try { return requiredIdentity(decodeURIComponent(value)); } catch { throw adminError("ADMIN_ARGUMENT_INVALID", 400); }
}

function requiredIdentity(value: string): string {
  if (value.trim() === "" || Buffer.byteLength(value, "utf8") > 4096) invalid();
  return value;
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") invalid();
  return requiredIdentity(candidate);
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) invalid();
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authorize(request: IncomingMessage, expected: Buffer): void {
  const match = typeof request.headers.authorization === "string"
    ? /^Bearer ([^\s]+)$/u.exec(request.headers.authorization)
    : null;
  if (!timingSafeEqual(digest(match?.[1] ?? ""), expected)) throw adminError("ADMIN_CREDENTIAL_INVALID", 401);
}

function assertCredential(value: string): void {
  if (value.length < 16 || value.length > 4096) throw adminError("ADMIN_CREDENTIAL_CONFIGURATION_INVALID", 500);
}

function digest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function invalid(): never { throw adminError("ADMIN_COMMAND_INVALID", 400); }
function adminError(code: string, statusCode: number): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
function sendError(response: ServerResponse, error: unknown): void {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code : "ADMIN_REQUEST_FAILED";
  const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode : code.endsWith("_CONFLICT") ? 409 : 500;
  if (status === 401) response.setHeader("www-authenticate", "Bearer");
  sendJson(response, status, { errorCode: code });
}
