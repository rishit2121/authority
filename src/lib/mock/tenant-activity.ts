import type { AuthorizationDecision, Capability, ExecutionEvent, Task } from "@/lib/domain";

import { DEMO_TENANT_ID } from "./scenario-github-991";

/**
 * Additional tenant activity beyond the GitHub #991 scenario, so the control
 * plane overview has realistic counts. Every record is schema-valid and
 * deliberately mundane — no invented customers, no claimed integrations.
 */
const T = (offsetSeconds: number): string =>
  new Date(Date.parse("2026-02-11T09:14:00.000Z") + offsetSeconds * 1000).toISOString();

export const activityTasks: Task[] = [
  {
    id: "task_1899",
    tenantId: DEMO_TENANT_ID,
    agentId: "agt_customer_ops",
    principalId: "prin_maya",
    intent: "Refund order #4821 and email the customer a confirmation.",
    status: "completed",
    createdAt: T(-7_400),
    completedAt: T(-7_100),
  },
  {
    id: "task_1907",
    tenantId: DEMO_TENANT_ID,
    agentId: "agt_analytics",
    principalId: "prin_security",
    intent: "Summarize weekly refund volume for the finance review.",
    status: "awaiting_approval",
    createdAt: T(-1_900),
  },
  {
    id: "task_1912",
    tenantId: DEMO_TENANT_ID,
    agentId: "agt_customer_ops",
    principalId: "prin_maya",
    intent: "Look up the delivery status for order #5107.",
    status: "executing",
    createdAt: T(-240),
  },
  {
    id: "task_1915",
    tenantId: DEMO_TENANT_ID,
    agentId: "agt_coding_17",
    principalId: "prin_maya",
    intent: "Update the changelog for the 2.4 release branch.",
    status: "failed",
    createdAt: T(-900),
    completedAt: T(-840),
  },
];

export const activityDecisions: AuthorizationDecision[] = [
  {
    id: "dec_1899_a",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1899",
    toolRequestId: "req_1899_a",
    status: "allow_constrained",
    reasons: [{ code: "WITHIN_CONTRACT", detail: "Refund scoped to payment pi_4821.", source: "contract" }],
    appliedConstraints: [{ key: "payment_intent", equals: "pi_4821" }],
    latencyMs: 1.3,
    decidedAt: T(-7_300),
  },
  {
    id: "dec_1899_b",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1899",
    toolRequestId: "req_1899_b",
    status: "replan",
    reasons: [
      {
        code: "TOOL_NOT_IN_CONTRACT",
        detail: "`slack.send_message` is not an allowed action on this Task Authority Contract.",
        source: "contract",
      },
    ],
    appliedConstraints: [],
    latencyMs: 1.1,
    decidedAt: T(-7_260),
  },
  {
    id: "dec_ext_1",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1907",
    toolRequestId: "req_1907_a",
    status: "require_approval",
    reasons: [
      {
        code: "SEMANTIC_EXTERNAL_DISCLOSURE",
        detail: "Export would move customer rows outside the organization; routing for approval.",
        source: "semantic",
      },
    ],
    appliedConstraints: [],
    latencyMs: 2.4,
    decidedAt: T(-1_850),
  },
  {
    id: "dec_ext_2",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1899",
    toolRequestId: "req_1899_c",
    status: "require_approval",
    reasons: [
      { code: "LIMIT_EXCEEDED", detail: "Refund exceeds the $500 auto-approval ceiling.", source: "limit" },
    ],
    appliedConstraints: [],
    latencyMs: 1.7,
    decidedAt: T(-7_200),
  },
  {
    id: "dec_1912_a",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1912",
    toolRequestId: "req_1912_a",
    status: "allow_constrained",
    reasons: [
      { code: "WITHIN_CONTRACT", detail: "Row access constrained to order_id = 5107.", source: "contract" },
    ],
    appliedConstraints: [{ key: "order_id", equals: "5107" }],
    latencyMs: 0.8,
    decidedAt: T(-230),
  },
  {
    id: "dec_1915_a",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1915",
    toolRequestId: "req_1915_a",
    status: "deny",
    reasons: [
      {
        code: "CONSTRAINT_VIOLATION",
        detail: "Push targeted `main`, which the contract never permits.",
        source: "contract",
      },
    ],
    appliedConstraints: [],
    latencyMs: 1.0,
    decidedAt: T(-880),
  },
];

export const activityCapabilities: Capability[] = [
  {
    id: "cap_1912_a",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1912",
    decisionId: "dec_1912_a",
    tool: "postgres.query_order",
    constraints: [{ key: "order_id", equals: "5107" }],
    status: "active",
    maxInvocations: 2,
    usedInvocations: 1,
    issuedAt: T(-230),
    expiresAt: T(370),
  },
  {
    id: "cap_1912_b",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1912",
    decisionId: "dec_1912_a",
    tool: "postgres.query_shipment",
    constraints: [{ key: "order_id", equals: "5107" }],
    status: "active",
    maxInvocations: 2,
    usedInvocations: 0,
    issuedAt: T(-228),
    expiresAt: T(372),
  },
  {
    id: "cap_1899_a",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1899",
    decisionId: "dec_1899_a",
    tool: "stripe.create_refund",
    constraints: [{ key: "payment_intent", equals: "pi_4821" }],
    status: "revoked",
    maxInvocations: 1,
    usedInvocations: 1,
    issuedAt: T(-7_300),
    expiresAt: T(-6_700),
    revokedAt: T(-7_100),
    revocationReason: "Task completed",
  },
];

export const activityEvents: ExecutionEvent[] = [
  {
    id: "evt_1912_1",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1912",
    type: "capability_issued",
    outcome: "success",
    summary: "Capability issued for postgres.query_order, scoped to order 5107.",
    decisionId: "dec_1912_a",
    capabilityId: "cap_1912_a",
    occurredAt: T(-230),
  },
  {
    id: "evt_1915_1",
    tenantId: DEMO_TENANT_ID,
    taskId: "task_1915",
    type: "request_evaluated",
    outcome: "blocked",
    summary: "Denied a direct push to main.",
    decisionId: "dec_1915_a",
    occurredAt: T(-880),
  },
];
