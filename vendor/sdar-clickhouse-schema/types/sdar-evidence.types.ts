/**
 * SDAR V2 Embodied-Control Profile V1.0 application/domain types.
 * Runtime v1.3 canonical evidence types are in sdar-v1.3-evidence.types.ts.
 */
export type AgentType = 'commander' | 'npc';
export type EvidenceLevel = 'E0' | 'E1' | 'E2';
export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type EpisodeStatus = 'created' | 'active' | 'waiting' | 'blocked' | 'paused' | 'completed' | 'partial' | 'failed' | 'aborted' | 'cancelled';
export type ExecutionStatus = 'planned' | 'gated' | 'dispatched' | 'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'unknown';

export interface SourceRef {
  sourceType: 'operator' | 'command_center' | 'peer_agent' | 'sensor' | 'mcp_server' | 'agent_runtime' | 'behavior_tree' | 'llm' | 'rule_engine' | 'system' | 'unknown';
  sourceId: string;
  channel?: string;
  trustLevel?: 'trusted' | 'partially_trusted' | 'untrusted' | 'unknown';
}

export interface EvidenceRef {
  evidenceType: string;
  evidenceId: string;
  relation?: 'supports' | 'contradicts' | 'caused_by' | 'produced_by' | 'validated_by' | 'derived_from' | 'supersedes' | 'related';
  schemaRef?: string;
  storageRef?: string;
  payloadHash?: string;
}

export interface StateSnapshot<TDomain = Record<string, unknown>> {
  stateId: string;
  episodeId: string;
  agentType: AgentType;
  stateVersion: number;
  quality: {
    observedAt: string;
    recordedAt: string;
    validUntil?: string;
    freshnessMs?: number;
    confidence?: number;
    status: 'confirmed' | 'inferred' | 'stale' | 'conflicted' | 'unknown';
  };
  source: SourceRef;
  episodeStatus: EpisodeStatus;
  goalId?: string;
  goalVersion?: number;
  activeExecutionBasisId?: string;
  currentStepId?: string;
  currentActionId?: string;
  activeController?: string;
  controlMode?: 'autonomous' | 'supervised' | 'manual' | 'paused' | 'safe_hold' | 'unknown';
  domainState: TDomain;
}

export interface ExecutionBasis {
  basisId: string;
  episodeId: string;
  basisType: 'plan' | 'policy' | 'rule' | 'sop' | 'shortcut' | 'behavior_tree_branch' | 'workflow' | 'human_instruction' | 'mission_tool_queue';
  version: number;
  status: 'proposed' | 'approved' | 'active' | 'superseded' | 'completed' | 'rejected' | 'cancelled';
  goalId: string;
  goalVersion?: number;
  name?: string;
  description?: string;
  steps?: Array<Record<string, unknown>>;
  policyRef?: string;
  branchPath?: string;
  utilityScores?: Record<string, number>;
  createdBy: SourceRef;
  createdAt: string;
}

export interface DecisionRecord {
  decisionId: string;
  episodeId: string;
  sequence: number;
  decisionType: string;
  title: string;
  conclusion: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'executed';
  basedOnStateId: string;
  executionBasisId?: string;
  rationaleSummary?: string;
  evidenceRefs?: EvidenceRef[];
  createdAt: string;
  createdBy: SourceRef;
}

export interface ActionRecord {
  actionId: string;
  episodeId: string;
  sequence: number;
  basisId: string;
  stepId?: string;
  decisionId: string;
  actionType: 'read' | 'simulation' | 'write' | 'control' | 'human_request' | 'delegate';
  capability?: string;
  target: { entityType: string; entityId: string; displayName?: string };
  inputSummary: string;
  inputHash: string;
  riskLevel: RiskLevel;
  gateDecisionRefs?: string[];
  confirmationRef?: string;
  idempotencyKey: string;
  executionStatus: ExecutionStatus;
  sideEffect: boolean;
  beforeStateId: string;
  afterStateId?: string;
  receiptRefs?: string[];
}

export interface VerificationRecord {
  verificationId: string;
  episodeId: string;
  criterionId: string;
  actionId?: string;
  stateId?: string;
  verificationType: 'state_check' | 'sensor_observation' | 'business_rule' | 'human_validation' | 'derived_check';
  expected: unknown;
  actual: unknown;
  comparator: string;
  status: 'pass' | 'fail' | 'inconclusive' | 'pending';
  critical: boolean;
  evidenceRefs: EvidenceRef[];
  verifiedAt: string;
  verifier: SourceRef;
}

export interface AgentEpisodeEvidenceBundle {
  metadata: Record<string, unknown>;
  trigger: Record<string, unknown>;
  goals: Array<Record<string, unknown>>;
  initialState: StateSnapshot;
  stateSnapshots: StateSnapshot[];
  stateDeltas?: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  executionBases: ExecutionBasis[];
  decisions: DecisionRecord[];
  gateDecisions?: Array<Record<string, unknown>>;
  confirmations?: Array<Record<string, unknown>>;
  actions: ActionRecord[];
  receipts: Array<Record<string, unknown>>;
  verifications: VerificationRecord[];
  failures?: Array<Record<string, unknown>>;
  recoveries?: Array<Record<string, unknown>>;
  trajectory: Array<Record<string, unknown>>;
  operationalMetrics?: Array<Record<string, unknown>>;
  finalState: StateSnapshot;
  outcome: Record<string, unknown>;
}
