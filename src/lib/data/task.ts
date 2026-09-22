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

/** Everything the task investigation view needs, assembled through the seam. */
export interface TaskInvestigation {
  task: Task;
  agent: Agent;
  principal: Principal;
  contract: TaskAuthorityContract;
  plan: Plan;
  toolRequests: ToolRequest[];
  decisions: AuthorizationDecision[];
  capabilities: Capability[];
  events: ExecutionEvent[];
  approvals: Approval[];
}

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
      repositories.approvals.listByTenant(task.tenantId),
    ]);

  // The investigation view is only meaningful with a contract and a plan.
  if (!agent || !principal || !contract || !plan) return null;

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
    approvals: approvals.filter((a) => a.taskId === task.id),
  };
}
