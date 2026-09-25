import type {
  Agent,
  Approval,
  AuthorityRepositories,
  AuthorizationDecision,
  Capability,
  ExecutionEvent,
  Plan,
  Principal,
  Task,
  TaskAuthorityContract,
  ToolRequest,
} from "@/lib/domain";
import { mockRepositories } from "@/lib/mock";

/**
 * Everything the task investigation view needs, assembled through the seam.
 *
 * `contract` and `plan` are optional: a task created by `create_task()` in
 * Part 2B.2 has neither until Part 3's contract-generation flow runs. This
 * is a real, reachable state — not an error — so the view renders the
 * fields it has and says plainly what's still pending, rather than 404ing a
 * task that legitimately exists but hasn't progressed yet.
 */
export interface TaskInvestigation {
  task: Task;
  agent: Agent;
  principal: Principal;
  contract: TaskAuthorityContract | null;
  plan: Plan | null;
  toolRequests: ToolRequest[];
  decisions: AuthorizationDecision[];
  capabilities: Capability[];
  events: ExecutionEvent[];
  approvals: Approval[];
}

/**
 * Loads one task's full investigation.
 *
 * Returns `null` for a task that doesn't exist *or* one this caller's
 * tenant cannot access — `tasks.findById()` returns null for both cases
 * under RLS, and the two are indistinguishable on purpose: a page calling
 * this should render an ordinary "not found," never anything that would let
 * a caller learn that a task id belongs to someone else's tenant.
 */
export async function loadTaskInvestigation(
  taskId: string,
  repositories: AuthorityRepositories = mockRepositories,
): Promise<TaskInvestigation | null> {
  const task = await repositories.tasks.findById(taskId);
  if (!task) return null;

  const [agent, principal, contract, plan, toolRequests, decisions, capabilities, events, approvals] =
    await Promise.all([
      repositories.agents.findById(task.agentId),
      repositories.principals.findById(task.principalId),
      repositories.contracts.findByTaskId(task.id),
      repositories.plans.findByTaskId(task.id),
      repositories.toolRequests.listByTaskId(task.id),
      repositories.decisions.listByTaskId(task.id),
      repositories.capabilities.listByTaskId(task.id),
      repositories.events.listByTaskId(task.id),
      repositories.approvals.listByTaskId(task.id),
    ]);

  // Agent and principal are structural requirements of the domain Task
  // itself (every task has both, enforced by the composite foreign keys) —
  // their absence here would mean actual data corruption, not a
  // legitimately incomplete task, so this alone still 404s.
  if (!agent || !principal) return null;

  return {
    task,
    agent,
    principal,
    contract,
    plan,
    toolRequests,
    decisions,
    capabilities,
    events,
    approvals,
  };
}
