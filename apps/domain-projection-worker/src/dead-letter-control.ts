import type { DomainSourceSha256 } from "../../../packages/telemetry-contracts/src/index.js";

export type DomainDeadLetterState = Readonly<{
  deadLetterId: string;
  projectionId: string;
  projectionVersion: number;
  mappingHash: DomainSourceSha256;
  status: "open" | "retrying" | "resolved" | "ignored";
  managementActionId: string;
  retryCount: number;
}>;

export type DomainDeadLetterAction = Readonly<{
  deadLetterId: string;
  managementActionId: string;
  expectedProjectionId: string;
  expectedProjectionVersion: number;
  expectedMappingHash: DomainSourceSha256;
  expectedStatus: DomainDeadLetterState["status"];
  action: "retry" | "resolve" | "ignore";
}>;

export interface DomainDeadLetterStatePort {
  load(deadLetterId: string): Promise<DomainDeadLetterState | null>;
  markRetrying(
    state: DomainDeadLetterState,
    managementActionId: string,
  ): Promise<DomainDeadLetterState>;
  markTerminal(
    state: DomainDeadLetterState,
    managementActionId: string,
    action: "resolve" | "ignore",
  ): Promise<DomainDeadLetterState>;
}

export interface DomainDeadLetterRetryPort {
  retry(state: DomainDeadLetterState): Promise<Readonly<{ terminal: boolean; blocked: boolean }>>;
}

export class DomainDeadLetterControlService {
  constructor(
    private readonly state: DomainDeadLetterStatePort,
    private readonly replay: DomainDeadLetterRetryPort,
  ) {}

  async execute(action: DomainDeadLetterAction): Promise<DomainDeadLetterState> {
    assertAction(action);
    const current = await this.state.load(action.deadLetterId);
    if (current === null) throw controlError("DOMAIN_DEAD_LETTER_NOT_FOUND");
    assertScope(action, current);
    if (
      (current.status === "resolved" || current.status === "ignored") &&
      current.managementActionId === action.managementActionId
    ) {
      return current;
    }
    if (current.status !== action.expectedStatus) {
      throw controlError("DOMAIN_DEAD_LETTER_REVISION_CONFLICT");
    }
    if (action.action === "resolve" || action.action === "ignore") {
      return this.state.markTerminal(current, action.managementActionId, action.action);
    }
    if (current.status !== "open" && current.status !== "retrying") {
      throw controlError("DOMAIN_DEAD_LETTER_RETRY_FORBIDDEN");
    }
    const retrying = await this.state.markRetrying(current, action.managementActionId);
    const result = await this.replay.retry(retrying);
    if (result.blocked || !result.terminal) return retrying;
    return this.state.markTerminal(retrying, action.managementActionId, "resolve");
  }
}

function assertAction(action: DomainDeadLetterAction): void {
  if (
    action.deadLetterId.trim() === "" ||
    action.managementActionId.trim() === "" ||
    action.expectedProjectionId.trim() === "" ||
    !Number.isSafeInteger(action.expectedProjectionVersion) ||
    action.expectedProjectionVersion < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(action.expectedMappingHash)
  ) {
    throw controlError("DOMAIN_DEAD_LETTER_ACTION_INVALID");
  }
}

function assertScope(action: DomainDeadLetterAction, state: DomainDeadLetterState): void {
  if (
    state.projectionId !== action.expectedProjectionId ||
    state.projectionVersion !== action.expectedProjectionVersion ||
    state.mappingHash !== action.expectedMappingHash
  ) {
    throw controlError("DOMAIN_DEAD_LETTER_SCOPE_CONFLICT");
  }
}

function controlError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
