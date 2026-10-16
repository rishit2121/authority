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

/** One task-alignment finding. Model-based findings are judgments, not certainties. */
export interface AlignmentFinding {
  type: string;
  source: "deterministic" | "semantic" | "task_shield" | "inspection";
  severity: "conflict" | "ambiguous" | "unreviewed" | "info";
  stepId?: string;
  field?: string;
  value?: string;
  explanation: string;
}

/** Present on prepare outcomes when the application has task alignment on. */
export interface PlanAlignment {
  mode: "shadow" | "enforce";
  policy: "reference" | "production";
  outcome: "aligned" | "misaligned" | "ambiguous" | "unreviewed";
  decision: "approved" | "rejected" | null;
  reviewId: string | null;
  findings: AlignmentFinding[];
  feedback: string | null;
}

export type PrepareTaskOutcome =
  | { status: "ready"; contractId: string; version: number; tools: string[]; alignment?: PlanAlignment }
  | {
      status: "awaiting_approval";
      contractId: string;
      version: number;
      approvalPath: string;
      alignment?: PlanAlignment;
    }
  /** Enforced alignment review did not clear the plan: "revise" it, or wait for a person ("hold"). */
  | {
      status: "alignment_review";
      decision: "revise" | "hold";
      contractId: string;
      version: number;
      reviewPath: string;
      alignment: PlanAlignment;
    }
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

/** Where external content came from. Descriptive only: it never makes content trusted. */
export interface ExternalContentSource {
  kind: "web" | "document" | "email" | "slack" | "database" | "api" | "memory" | "tool_result" | "other";
  label?: string;
  uri?: string;
  /** For tool results fetched outside Authority: the tool and its arguments. */
  toolName?: string;
  toolArgs?: string;
}

export interface ExternalContentInput {
  content: string;
  contentType?: "text/plain" | "text/markdown" | "application/json";
  source: ExternalContentSource;
}

export interface ExternalData {
  role: "external_data";
  source?: { kind: string; label: string | null; uri: string | null };
  text: string;
}

export interface ContentInspectionResult {
  taskId: string;
  inspectionId: string | null;
  /** "not_inspected" when alignment is off for the application; "passed" is not a safety guarantee. */
  status: "passed" | "flagged" | "quarantined" | "held" | "unreviewed" | "not_inspected";
  mode: "off" | "shadow" | "enforce";
  policy: "reference" | "production";
  contentHash: string | null;
  contextRevision: number | null;
  findings: AlignmentFinding[];
  feedback: string | null;
  /** What may go to the model, as external data -- null when withheld. */
  data: ExternalData | null;
}

export interface ContentInspectionStatus {
  inspectionId: string;
  taskId: string;
  status: ContentInspectionResult["status"];
  decision: "approved" | "rejected" | null;
  contentHash: string;
  contextRevision: number;
  findings: AlignmentFinding[];
  /** Held content, released only after an administrator approved it. */
  data: ExternalData | null;
}

export interface ObjectivesRevision {
  taskId: string;
  version: number;
  taskInstructions: string[];
  prohibitions: string[];
  requirements: { kind: string; value: string; text: string }[];
}
