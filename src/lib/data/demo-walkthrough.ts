import type { DecisionStatus } from "@/lib/domain";

/**
 * The nine beats of one authorization pass, built on the GitHub #991 scenario.
 *
 * Content only — no layout — so the walkthrough component stays presentational
 * and this stays reviewable as copy.
 */
export interface WalkthroughStep {
  id: string;
  /** Short label for the step indicator. */
  label: string;
  title: string;
  body: string;
  /** Monospace payload illustrating the step. */
  code?: string[];
  /** Decision badge to show, when the step produces one. */
  decision?: DecisionStatus;
  actor: "user" | "authority" | "agent";
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: "task",
    label: "Task",
    actor: "user",
    title: "Trusted task received",
    body: "A human principal delegates work. This sentence is the only trusted input in the entire exchange — everything Authority allows later must be justified by it.",
    code: [
      'principal: "Maya Okafor"',
      'intent: "Resolve issue #991 in payments-api and open a pull request."',
    ],
  },
  {
    id: "contract",
    label: "Contract",
    actor: "authority",
    title: "Task Authority Contract created",
    body: "Authority derives the maximum acceptable authority before the agent proposes anything. The contract is a ceiling: nothing downstream can widen it.",
    code: [
      "allowed_actions: 5",
      "forbidden_resources: 8",
      "max_tool_invocations: 12",
      "expires_in_seconds: 600",
    ],
  },
  {
    id: "plan",
    label: "Plan",
    actor: "agent",
    title: "Agent execution plan submitted",
    body: "The customer's agent proposes six steps. Authority treats this as an untrusted assertion of intent, never as an instruction.",
    code: [
      "1. github.read_issue",
      "2. github.read_repository",
      "3. github.get_repository_secret",
      "4. github.create_branch",
      "5. github.push_commit",
      "6. github.create_pull_request",
    ],
  },
  {
    id: "allow",
    label: "Allow",
    actor: "authority",
    title: "Safe nodes allowed",
    body: "Reading the named issue and the named repository is exactly what the task calls for. Both are permitted, each narrowed to the resource the task mentions.",
    decision: "allow_constrained",
    code: ["github.read_issue → issue_number = 991", "github.read_repository → repository = payments-api"],
  },
  {
    id: "deny",
    label: "Deny",
    actor: "authority",
    title: "Secret access denied",
    body: "The agent asked for a Stripe API key. Nothing about resolving an issue requires it, and the contract forbids repository secrets outright. This is a hard denial — no model signal can override it.",
    decision: "deny",
    code: [
      'github.get_repository_secret("STRIPE_API_KEY")',
      "violation: FORBIDDEN_RESOURCE",
      "capability_issued: false",
    ],
  },
  {
    id: "constrain",
    label: "Constrain",
    actor: "authority",
    title: "Branch write constrained",
    body: "Writes are permitted, but only to a branch matching fix-*. A push to main is refused by the same rule that allows the push to fix-991.",
    decision: "allow_constrained",
    code: ["github.push_commit → branch matches fix-*", "main: protected", "max_changed_files: 4"],
  },
  {
    id: "capability",
    label: "Capability",
    actor: "authority",
    title: "Temporary capability issued",
    body: "Only now does a credential come into play. The capability is scoped to one branch, capped at four invocations, and expires in ten minutes.",
    code: ["capability: cap_4", "tool: github.push_commit", "expires_in: 600s", "standing_permissions: 0"],
  },
  {
    id: "execute",
    label: "Execute",
    actor: "agent",
    title: "Execution recorded",
    body: "The gateway injects the credential just in time, performs the call, and writes a signed record of what actually ran.",
    code: [
      "branch fix-991 created",
      "commit pushed",
      "pull request #1203 opened → main",
      "signature: Ed25519",
    ],
  },
  {
    id: "revoke",
    label: "Revoke",
    actor: "authority",
    title: "Capability revoked",
    body: "When the task ends the capabilities go with it. The agent returns to holding nothing at all, which is where every task begins.",
    code: ["capabilities_revoked: 4", "standing_permissions: 0", "audit_trace: sealed"],
  },
];
