import type {
  Agent,
  Approval,
  AuthorizationDecision,
  Capability,
  ExecutionEvent,
  Plan,
  Principal,
  Task,
  TaskAuthorityContract,
  Tenant,
  ToolRequest,
} from "@/lib/domain";

/**
 * The MVP scenario: "Resolve issue #991 in payments-api and open a pull
 * request."
 *
 * Fixtures are frozen at fixed timestamps so snapshots, tests and the
 * dashboard stay deterministic. The denial of `github.get_repository_secret`
 * is the scenario's point: the agent proposed it, policy refused it, and no
 * capability was ever minted.
 */

const T = (offsetSeconds: number): string =>
  new Date(Date.parse("2026-02-11T09:14:00.000Z") + offsetSeconds * 1000).toISOString();

export const DEMO_TASK_ID = "task_1842";
export const DEMO_TENANT_ID = "ten_northwind";

export const demoTenant: Tenant = {
  id: DEMO_TENANT_ID,
  name: "Northwind Labs",
  slug: "northwind-labs",
  createdAt: T(-86_400 * 90),
};

export const demoPrincipals: Principal[] = [
  {
    id: "prin_maya",
    tenantId: DEMO_TENANT_ID,
    kind: "human",
    displayName: "Maya Okafor",
    email: "maya@northwind.example",
    createdAt: T(-86_400 * 90),
  },
  {
    id: "prin_security",
    tenantId: DEMO_TENANT_ID,
    kind: "human",
    displayName: "Platform Security",
    email: "security@northwind.example",
    createdAt: T(-86_400 * 88),
  },
];

export const demoAgents: Agent[] = [
  {
    id: "agt_coding_17",
    tenantId: DEMO_TENANT_ID,
    name: "coding-agent-17",
    model: "claude-opus-5",
    framework: "LangGraph",
    ownerPrincipalId: "prin_maya",
    status: "active",
    createdAt: T(-86_400 * 30),
  },
  {
    id: "agt_customer_ops",
    tenantId: DEMO_TENANT_ID,
    name: "customer-ops-agent",
    model: "claude-opus-5",
    framework: "MCP",
    ownerPrincipalId: "prin_maya",
    status: "active",
    createdAt: T(-86_400 * 21),
  },
  {
    id: "agt_analytics",
    tenantId: DEMO_TENANT_ID,
    name: "analytics-reporter",
    model: "claude-haiku-4-5",
    framework: "OpenAI SDK",
    ownerPrincipalId: "prin_security",
    status: "paused",
    createdAt: T(-86_400 * 12),
  },
];

export const demoTask: Task = {
  id: DEMO_TASK_ID,
  tenantId: DEMO_TENANT_ID,
  agentId: "agt_coding_17",
  principalId: "prin_maya",
  intent: "Resolve issue #991 in payments-api and open a pull request.",
  status: "executing",
  createdAt: T(0),
};

export const demoContract: TaskAuthorityContract = {
  id: "tac_1842",
  tenantId: DEMO_TENANT_ID,
  taskId: DEMO_TASK_ID,
  version: 1,
  status: "active",
  forbiddenOperations: [],
  requiredApprovalsSpec: [],
  specVersion: "1.4",
  allowedActions: [
    {
      tool: "github.read_issue",
      constraints: [
        { key: "repository", equals: "payments-api" },
        { key: "issue_number", equals: "991" },
      ],
      maxInvocations: 2,
    },
    {
      tool: "github.read_repository",
      constraints: [{ key: "repository", equals: "payments-api" }],
      maxInvocations: 4,
    },
    {
      tool: "github.create_branch",
      constraints: [
        { key: "repository", equals: "payments-api" },
        { key: "branch", matches: "fix-*" },
      ],
      maxInvocations: 1,
    },
    {
      tool: "github.push_commit",
      constraints: [
        { key: "repository", equals: "payments-api" },
        { key: "branch", matches: "fix-*" },
      ],
      maxInvocations: 4,
    },
    {
      tool: "github.create_pull_request",
      constraints: [
        { key: "repository", equals: "payments-api" },
        { key: "head", matches: "fix-*" },
        { key: "base", equals: "main" },
      ],
      maxInvocations: 1,
    },
  ],
  forbiddenResources: [
    "github.get_repository_secret",
    "github.update_repository_settings",
    "github.merge_pull_request",
    "github.create_release",
    "github.update_workflow",
    "aws:ssm:*",
    "database:prod:*",
    "*secret*",
  ],
  ephemeralLimits: { maxToolInvocations: 12, expiresInSeconds: 600 },
  createdAt: T(1),
};

export const demoPlan: Plan = {
  id: "plan_1842",
  taskId: DEMO_TASK_ID,
  proposedAt: T(3),
  nodes: [
    {
      id: "node_1",
      sequence: 0,
      tool: "github.read_issue",
      arguments: { repository: "payments-api", issue_number: "991" },
      status: "executed",
      rationale: "Reads the issue named directly in the user's task.",
    },
    {
      id: "node_2",
      sequence: 1,
      tool: "github.read_repository",
      arguments: { repository: "payments-api", path: "src/refunds" },
      status: "executed",
      rationale: "Repository read is within the contract's scope.",
    },
    {
      id: "node_3",
      sequence: 2,
      tool: "github.get_repository_secret",
      arguments: { repository: "payments-api", secret_name: "STRIPE_API_KEY" },
      status: "rejected",
      rationale: "Hard-denied by policy: the contract forbids repository secrets.",
    },
    {
      id: "node_4",
      sequence: 3,
      tool: "github.create_branch",
      arguments: { repository: "payments-api", branch: "fix-991" },
      status: "executed",
      rationale: "Branch name satisfies the `fix-*` constraint.",
    },
    {
      id: "node_5",
      sequence: 4,
      tool: "github.push_commit",
      arguments: { repository: "payments-api", branch: "fix-991", message: "fix: guard duplicate refunds" },
      status: "executed",
      rationale: "Push restricted to the authorized branch.",
    },
    {
      id: "node_6",
      sequence: 5,
      tool: "github.create_pull_request",
      arguments: { repository: "payments-api", head: "fix-991", base: "main" },
      status: "executed",
      rationale: "Single pull request targeting main, as the contract allows.",
    },
  ],
};

export const demoToolRequests: ToolRequest[] = demoPlan.nodes.map((node, index) => ({
  id: `req_${index + 1}`,
  tenantId: DEMO_TENANT_ID,
  taskId: DEMO_TASK_ID,
  agentId: "agt_coding_17",
  tool: node.tool,
  arguments: node.arguments,
  planNodeId: node.id,
  requestedAt: T(5 + index * 4),
}));

export const demoDecisions: AuthorizationDecision[] = [
  {
    id: "dec_1",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    toolRequestId: "req_1",
    status: "allow_constrained",
    reasons: [
      {
        code: "WITHIN_CONTRACT",
        detail: "`github.read_issue` is permitted and its arguments satisfy every contract constraint.",
        source: "contract",
      },
    ],
    appliedConstraints: [
      { key: "repository", equals: "payments-api" },
      { key: "issue_number", equals: "991" },
    ],
    latencyMs: 1.4,
    decidedAt: T(5),
  },
  {
    id: "dec_2",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    toolRequestId: "req_2",
    status: "allow_constrained",
    reasons: [
      {
        code: "WITHIN_CONTRACT",
        detail: "Repository read is scoped to payments-api.",
        source: "contract",
      },
    ],
    appliedConstraints: [{ key: "repository", equals: "payments-api" }],
    latencyMs: 1.1,
    decidedAt: T(9),
  },
  {
    id: "dec_3",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    toolRequestId: "req_3",
    status: "deny",
    reasons: [
      {
        code: "FORBIDDEN_RESOURCE",
        detail: "Request matches the contract's forbidden resource `github.get_repository_secret`.",
        source: "policy",
      },
      {
        code: "SEMANTIC_TASK_MISALIGNMENT",
        detail: "Reading a Stripe API key is not required to resolve issue #991.",
        source: "semantic",
      },
    ],
    appliedConstraints: [],
    latencyMs: 1.8,
    decidedAt: T(13),
  },
  {
    id: "dec_4",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    toolRequestId: "req_4",
    status: "allow_constrained",
    reasons: [
      {
        code: "WITHIN_CONTRACT",
        detail: "Branch `fix-991` matches the permitted `fix-*` pattern.",
        source: "contract",
      },
    ],
    appliedConstraints: [
      { key: "repository", equals: "payments-api" },
      { key: "branch", matches: "fix-*" },
    ],
    latencyMs: 0.9,
    decidedAt: T(17),
  },
  {
    id: "dec_5",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    toolRequestId: "req_5",
    status: "allow_constrained",
    reasons: [
      {
        code: "WITHIN_CONTRACT",
        detail: "Commit push restricted to `fix-991`; main remains protected.",
        source: "contract",
      },
    ],
    appliedConstraints: [
      { key: "repository", equals: "payments-api" },
      { key: "branch", matches: "fix-*" },
    ],
    latencyMs: 1.2,
    decidedAt: T(21),
  },
  {
    id: "dec_6",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    toolRequestId: "req_6",
    status: "allow_constrained",
    reasons: [
      {
        code: "WITHIN_CONTRACT",
        detail: "One pull request from `fix-991` into `main`.",
        source: "contract",
      },
    ],
    appliedConstraints: [
      { key: "repository", equals: "payments-api" },
      { key: "head", matches: "fix-*" },
      { key: "base", equals: "main" },
    ],
    latencyMs: 1.5,
    decidedAt: T(25),
  },
];

export const demoCapabilities: Capability[] = [
  {
    id: "cap_1",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    decisionId: "dec_1",
    tool: "github.read_issue",
    constraints: [{ key: "issue_number", equals: "991" }],
    status: "consumed",
    maxInvocations: 2,
    usedInvocations: 1,
    issuedAt: T(5),
    expiresAt: T(605),
  },
  {
    id: "cap_2",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    decisionId: "dec_2",
    tool: "github.read_repository",
    constraints: [{ key: "repository", equals: "payments-api" }],
    status: "active",
    maxInvocations: 4,
    usedInvocations: 3,
    issuedAt: T(9),
    expiresAt: T(609),
  },
  {
    id: "cap_3",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    decisionId: "dec_4",
    tool: "github.create_branch",
    constraints: [{ key: "branch", matches: "fix-*" }],
    status: "consumed",
    maxInvocations: 1,
    usedInvocations: 1,
    issuedAt: T(17),
    expiresAt: T(617),
  },
  {
    id: "cap_4",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    decisionId: "dec_5",
    tool: "github.push_commit",
    constraints: [{ key: "branch", matches: "fix-*" }],
    status: "active",
    maxInvocations: 4,
    usedInvocations: 2,
    issuedAt: T(21),
    expiresAt: T(621),
  },
  {
    id: "cap_5",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    decisionId: "dec_6",
    tool: "github.create_pull_request",
    constraints: [{ key: "base", equals: "main" }],
    status: "expired",
    maxInvocations: 1,
    usedInvocations: 1,
    issuedAt: T(25),
    expiresAt: T(625),
    revocationReason: undefined,
  },
];

export const demoApprovals: Approval[] = [
  {
    id: "apr_1",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1907",
    decisionId: "dec_ext_1",
    requestedFromPrincipalId: "prin_security",
    status: "pending",
    summary: "analytics-reporter requests export of 14k customer rows to an external bucket.",
    requestedAt: T(-1_800),
  },
  {
    id: "apr_2",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1899",
    decisionId: "dec_ext_2",
    requestedFromPrincipalId: "prin_security",
    status: "approved",
    summary: "customer-ops-agent requested a refund above the $500 auto-approval ceiling.",
    requestedAt: T(-7_200),
    respondedAt: T(-7_020),
    respondedByPrincipalId: "prin_maya",
    responseNote: "Verified against ticket CS-4417.",
  },
];

export const demoEvents: ExecutionEvent[] = [
  {
    id: "evt_1",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    type: "task_received",
    outcome: "info",
    summary: "Trusted user task received from Maya Okafor.",
    detail: demoTask.intent,
    occurredAt: T(0),
  },
  {
    id: "evt_2",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    type: "contract_issued",
    outcome: "success",
    summary: "Task Authority Contract tac_1842 issued with 5 allowed actions.",
    detail: "Ceiling: 12 invocations, 600s TTL.",
    occurredAt: T(1),
  },
  {
    id: "evt_3",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    type: "plan_proposed",
    outcome: "info",
    summary: "coding-agent-17 proposed a 6-step plan.",
    occurredAt: T(3),
  },
  {
    id: "evt_4",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    type: "capability_issued",
    outcome: "success",
    summary: "Capability issued for github.read_issue, scoped to issue #991.",
    decisionId: "dec_1",
    capabilityId: "cap_1",
    occurredAt: T(5),
  },
  {
    id: "evt_5",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    type: "request_evaluated",
    outcome: "blocked",
    summary: "Denied github.get_repository_secret (STRIPE_API_KEY).",
    detail: "Matched forbidden resource `github.get_repository_secret`. No capability was minted.",
    decisionId: "dec_3",
    occurredAt: T(13),
  },
  {
    id: "evt_6",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    type: "tool_invoked",
    outcome: "success",
    summary: "Created branch fix-991 in payments-api.",
    decisionId: "dec_4",
    capabilityId: "cap_3",
    occurredAt: T(18),
  },
  {
    id: "evt_7",
    tenantId: DEMO_TENANT_ID,
    taskId: DEMO_TASK_ID,
    type: "tool_invoked",
    outcome: "success",
    summary: "Opened pull request #1203 from fix-991 into main.",
    decisionId: "dec_6",
    capabilityId: "cap_5",
    occurredAt: T(26),
  },
];
