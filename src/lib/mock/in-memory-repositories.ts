import type {
  Agent,
  Approval,
  AuthorizationDecision,
  AuthorityRepositories,
  Capability,
  ExecutionEvent,
  Id,
  Plan,
  Principal,
  Task,
  TaskAuthorityContract,
  Tenant,
  ToolRequest,
} from "@/lib/domain";

import {
  demoAgents,
  demoApprovals,
  demoCapabilities,
  demoContract,
  demoDecisions,
  demoEvents,
  demoPlan,
  demoPrincipals,
  demoTask,
  demoTenant,
  demoToolRequests,
} from "./scenario-github-991";
import { activityCapabilities, activityDecisions, activityEvents, activityTasks } from "./tenant-activity";

/**
 * In-memory bindings for the repository interfaces.
 *
 * This is the only place Part 1's fixtures meet the domain seams. Swapping in
 * Supabase later means writing a second implementation of
 * `AuthorityRepositories` — no consumer changes.
 */
export interface MockDataset {
  tenants: Tenant[];
  principals: Principal[];
  agents: Agent[];
  tasks: Task[];
  contracts: TaskAuthorityContract[];
  plans: Plan[];
  toolRequests: ToolRequest[];
  decisions: AuthorizationDecision[];
  capabilities: Capability[];
  approvals: Approval[];
  events: ExecutionEvent[];
}

export const defaultDataset: MockDataset = {
  tenants: [demoTenant],
  principals: demoPrincipals,
  agents: demoAgents,
  tasks: [demoTask, ...activityTasks],
  contracts: [demoContract],
  plans: [demoPlan],
  toolRequests: demoToolRequests,
  decisions: [...demoDecisions, ...activityDecisions],
  capabilities: [...demoCapabilities, ...activityCapabilities],
  approvals: demoApprovals,
  events: [...demoEvents, ...activityEvents],
};

/** Builds repositories over a dataset; tests can pass their own. */
export function createInMemoryRepositories(dataset: MockDataset = defaultDataset): AuthorityRepositories {
  return {
    tenants: {
      findById: async (id: Id) => dataset.tenants.find((t) => t.id === id) ?? null,
      list: async () => [...dataset.tenants],
    },
    principals: {
      findById: async (id: Id) => dataset.principals.find((p) => p.id === id) ?? null,
      listByTenant: async (tenantId: Id) => dataset.principals.filter((p) => p.tenantId === tenantId),
    },
    agents: {
      findById: async (id: Id) => dataset.agents.find((a) => a.id === id) ?? null,
      listByTenant: async (tenantId: Id) => dataset.agents.filter((a) => a.tenantId === tenantId),
    },
    tasks: {
      findById: async (id: Id) => dataset.tasks.find((t) => t.id === id) ?? null,
      listByTenant: async (tenantId: Id) => dataset.tasks.filter((t) => t.tenantId === tenantId),
    },
    contracts: {
      findByTaskId: async (taskId: Id) => dataset.contracts.find((c) => c.taskId === taskId) ?? null,
    },
    plans: {
      findByTaskId: async (taskId: Id) => dataset.plans.find((p) => p.taskId === taskId) ?? null,
    },
    toolRequests: {
      listByTaskId: async (taskId: Id) => dataset.toolRequests.filter((r) => r.taskId === taskId),
    },
    decisions: {
      findById: async (id: Id) => dataset.decisions.find((d) => d.id === id) ?? null,
      listByTaskId: async (taskId: Id) => dataset.decisions.filter((d) => d.taskId === taskId),
    },
    capabilities: {
      listByTaskId: async (taskId: Id) => dataset.capabilities.filter((c) => c.taskId === taskId),
      listActiveByTenant: async (tenantId: Id) =>
        dataset.capabilities.filter((c) => c.tenantId === tenantId && c.status === "active"),
    },
    approvals: {
      listByTenant: async (tenantId: Id) => dataset.approvals.filter((a) => a.tenantId === tenantId),
      listPendingByTenant: async (tenantId: Id) =>
        dataset.approvals.filter((a) => a.tenantId === tenantId && a.status === "pending"),
    },
    events: {
      listByTaskId: async (taskId: Id) =>
        dataset.events
          .filter((e) => e.taskId === taskId)
          .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
    },
  };
}

/** Shared instance for server components in Part 1. */
export const mockRepositories: AuthorityRepositories = createInMemoryRepositories();
