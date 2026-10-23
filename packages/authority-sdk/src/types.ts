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

/** A submitted plan step that is not in the compiled contract, with the validator's reasons. */
export interface ExcludedStep {
  nodeId: string;
  tool: string;
  status: "denied" | "clarify" | "replan";
  reasons: string[];
}

export type PrepareTaskOutcome =
  | {
      status: "ready";
      contractId: string;
      version: number;
      tools: string[];
      /** Steps left out of the contract. A "ready" contract can lack a step you submitted; check this. */
      excludedSteps?: ExcludedStep[];
      alignment?: PlanAlignment;
      checks?: { planReview: "ran" | "not_run" };
    }
  | {
      status: "awaiting_approval";
      contractId: string;
      version: number;
      approvalPath: string;
      excludedSteps?: ExcludedStep[];
      alignment?: PlanAlignment;
      checks?: { planReview: "ran" | "not_run" };
    }
  /** Enforced alignment review did not clear the plan: "revise" it, or wait for a person ("hold"). */
  | {
      status: "alignment_review";
      decision: "revise" | "hold";
      contractId: string;
      version: number;
      reviewPath: string;
      excludedSteps?: ExcludedStep[];
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
  /**
   * Fill an argument from an earlier step's output. Allowed only for free-text fields (message text, subject,
   * title); Authority neither verifies nor constrains such a value. A recipient, channel, id or amount must be a
   * concrete value in `arguments`, or the step is excluded with status "replan".
   */
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
  /**
   * Unpinned arguments this action accepts (free text such as a message body). Any argument that is neither
   * pinned in `resourceConstraints` nor listed here is refused. null on contracts compiled before this rule.
   */
  openArguments?: string[] | null;
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
  /** Which optional checks ran for this call; "not_run" is never a pass. */
  checks?: { taskAlignment: "not_run" | "shadow" | "passed" | "covered_by_plan_review" | "stopped" | "held" };
  /** Present when task alignment stopped or held this call before any authorization was committed. */
  alignment?: ActionAlignment;
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
/** Task alignment's verdict on one call, present only when it stopped or held the call. */
export interface ActionAlignment {
  reviewId: string | null;
  outcome: "misaligned" | "ambiguous" | "unreviewed";
  policy: string;
  findings: AlignmentFinding[];
  feedback: string | null;
}

/** How a connector's result was screened before delivery (task alignment on). */
export interface ResultInspection {
  inspectionId?: string | null;
  /** "not_inspected" when screening did not run -- never read it as a pass. */
  status: string;
  ran?: boolean;
  action?: "report" | "quarantine" | "shadow";
  mode?: string;
  policy?: string;
  findings?: AlignmentFinding[];
  feedback?: string | null;
  reason?: string;
}

export type ToolCallResult =
  | {
      status: "executed";
      result: string;
      data?: unknown;
      receiptId?: string;
      /** "held": the action completed but its result is withheld for review -- do not repeat it. */
      delivery?: "delivered" | "held";
      inspection?: ResultInspection;
    }
  | { status: "denied"; reasonCodes: string[]; summary: string }
  | { status: "requires_approval"; approvalId: string; statusUrl: string }
  | {
      status: "requires_clarification" | "requires_replan";
      reasonCodes: string[];
      summary: string;
      alignment?: ActionAlignment;
    }
  /** Task alignment needs a person: once approved on the task page, repeat the call with the same idempotencyKey. */
  | { status: "held_for_review"; reasonCodes: string[]; summary: string; alignment: ActionAlignment };

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
  /** Whether screening ran. `ran: false` (status "not_inspected") means nobody looked -- not that it passed. */
  screening: {
    ran: boolean;
    reason?: "alignment_off" | "content_screening_off";
    action: "report" | "quarantine" | "shadow" | "none";
  };
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
