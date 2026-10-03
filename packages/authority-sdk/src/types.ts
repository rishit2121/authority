export interface CustomerConnection {
  connectionId: string;
  connectorId: string;
  status: string;
  ownerKind: "organization" | "customer";
  verifiedAccountRef: string | null;
  createdAt: string;
}

/**
 * A GitHub repository explicitly delegated to a customer -- not a
 * `CustomerConnection`, since a GitHub repository is never represented as
 * an OAuth connection (see the backend migration's own module comment on
 * why). Discovered via `backend.githubRepositories.list`, bound to a task
 * via `backend.tasks.bindGithubRepository`.
 */
export interface CustomerGithubRepository {
  repositoryId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export type PrepareTaskOutcome =
  | { status: "ready"; contractId: string; version: number; tools: string[] }
  | { status: "awaiting_approval"; contractId: string; version: number; approvalPath: string }
  | { status: "clarification"; reason: string; details?: unknown }
  | { status: "rejected"; reason: string }
  | { status: "ai_unavailable" };

export interface ContractStatus {
  contractId: string;
  taskId: string;
  status: string | null;
  tools: string[];
  requiredApprovalsCount: number;
}

/** A single candidate-plan node -- see `src/lib/domain/candidate-plan.ts` for the authoritative shape this mirrors. */
export interface CandidatePlanNodeInput {
  id: string;
  sequence: number;
  tool: string;
  arguments: Record<string, unknown>;
  resourceBinding?: string;
  dependencies?: string[];
  declaredOutputs?: string[];
  dataFlowRefs?: Array<{ argumentKey: string; fromNodeId: string; output: string }>;
  expectedSideEffect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  maxInvocations?: number;
}

export interface CandidatePlanInput {
  schemaVersion: 1;
  nodes: CandidatePlanNodeInput[];
}

export interface ToolManifestEntry {
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  resourceConstraints: unknown[];
  maxInvocations: number | null;
  requiresApproval: boolean;
}

export interface ToolManifest {
  taskId: string;
  contract: { id: string | null; version: number | null };
  versions: { registry: string; compiler: string };
  manifestHash: string;
  tools: ToolManifestEntry[];
}

export interface AgentAuthorizeResponse {
  decisionId: string;
  status: string;
  reasonCodes: string[];
  summary: string;
  contract: { id: string; version: number | null } | null;
  remainingInvocations: number | null;
  requiresApproval: boolean;
  requiresClarification: boolean;
  requiresReplan: boolean;
  wasReplayed: boolean;
  capability: null | {
    id: string;
    token: string | null;
    tokenAlreadyIssued: boolean;
    tool: string;
    operation: string;
    expiresAt: string;
    maxUses: number;
  };
  approval: null | {
    id: string;
    state: string;
    requiredApprovals: number | null;
    approvals: number | null;
    expiresAt: string | null;
    statusUrl: string;
  };
  guidance: unknown;
  simulation: boolean;
}

export interface ApprovalStatus {
  approvalId: string;
  state: string;
  requiredApprovals: number | null;
  approvals: number | null;
  expiresAt: string | null;
  reason: string | null;
}

/**
 * The outcome of a high-level `tools.execute` call. "denied" /
 * "requires_approval" / "requires_clarification" / "requires_replan" are
 * ordinary, expected decisions -- never thrown as errors. Only a request
 * that could not be completed at all throws `AuthorityApiError`.
 */
export type ToolCallResult =
  | { status: "executed"; result: string; data?: unknown; receiptId?: string }
  | { status: "denied"; reasonCodes: string[]; summary: string }
  | { status: "requires_approval"; approvalId: string; statusUrl: string }
  | { status: "requires_clarification" | "requires_replan"; reasonCodes: string[]; summary: string };
