import type {
  Agent,
  Approval,
  AuthorityRepositories,
  AuthorizationDecision,
  Capability,
  ExecutionEvent,
  Id,
  Integration,
  PageOptions,
  PageResult,
  Plan,
  Policy,
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
 *
 * Part 2B.1 adds `policies`/`integrations` datasets and the paginated
 * sibling methods to satisfy the extended interfaces. Both new datasets are
 * empty here: this build has no application code reading from them yet, and
 * the app's composition point (`mockRepositories`, at the bottom of this
 * file) remains what every page and loader is wired to. Nothing in this
 * commit changes that.
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
  policies: Policy[];
  integrations: Integration[];
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
  policies: [],
  integrations: [],
};

/**
 * Slices an in-memory array into a page using its index as the cursor.
 *
 * This encoding is specific to this implementation — a real backend paginates
 * by keyset (e.g. `(created_at, id)`), not array position. Callers must
 * treat every cursor as opaque regardless of which implementation issued it;
 * nothing here promises the two are interchangeable.
 */
function paginateArray<T>(items: T[], options?: PageOptions): PageResult<T> {
  const limit = options?.limit ?? 50;
  const start = options?.cursor ? Number.parseInt(options.cursor, 10) : 0;
  const startIndex = Number.isFinite(start) && start >= 0 ? start : 0;

  const slice = items.slice(startIndex, startIndex + limit);
  const nextIndex = startIndex + slice.length;

  return {
    items: slice,
    nextCursor: nextIndex < items.length ? String(nextIndex) : null,
  };
}

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
      listByTenantPaged: async (tenantId: Id, options?: PageOptions) =>
        paginateArray(
          dataset.tasks.filter((t) => t.tenantId === tenantId),
          options,
        ),
    },
    contracts: {
      findByTaskId: async (taskId: Id) => dataset.contracts.find((c) => c.taskId === taskId) ?? null,
    },
    plans: {
      findByTaskId: async (taskId: Id) => dataset.plans.find((p) => p.taskId === taskId) ?? null,
    },
    toolRequests: {
      listByTaskId: async (taskId: Id) => dataset.toolRequests.filter((r) => r.taskId === taskId),
      listByTaskIdPaged: async (taskId: Id, options?: PageOptions) =>
        paginateArray(
          dataset.toolRequests.filter((r) => r.taskId === taskId),
          options,
        ),
    },
    decisions: {
      findById: async (id: Id) => dataset.decisions.find((d) => d.id === id) ?? null,
      listByTaskId: async (taskId: Id) => dataset.decisions.filter((d) => d.taskId === taskId),
      listByTaskIdPaged: async (taskId: Id, options?: PageOptions) =>
        paginateArray(
          dataset.decisions.filter((d) => d.taskId === taskId),
          options,
        ),
    },
    capabilities: {
      listByTaskId: async (taskId: Id) => dataset.capabilities.filter((c) => c.taskId === taskId),
      listActiveByTenant: async (tenantId: Id) =>
        dataset.capabilities.filter((c) => c.tenantId === tenantId && c.status === "active"),
      listActiveByTenantPaged: async (tenantId: Id, options?: PageOptions) =>
        paginateArray(
          dataset.capabilities.filter((c) => c.tenantId === tenantId && c.status === "active"),
          options,
        ),
    },
    approvals: {
      listByTenant: async (tenantId: Id) => dataset.approvals.filter((a) => a.tenantId === tenantId),
      listPendingByTenant: async (tenantId: Id) =>
        dataset.approvals.filter((a) => a.tenantId === tenantId && a.status === "pending"),
      listByTenantPaged: async (tenantId: Id, options?: PageOptions) =>
        paginateArray(
          dataset.approvals.filter((a) => a.tenantId === tenantId),
          options,
        ),
    },
    events: {
      listByTaskId: async (taskId: Id) =>
        dataset.events
          .filter((e) => e.taskId === taskId)
          .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
      listByTaskIdPaged: async (taskId: Id, options?: PageOptions) =>
        paginateArray(
          dataset.events
            .filter((e) => e.taskId === taskId)
            .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
          options,
        ),
    },
    policies: {
      findById: async (id: Id) => dataset.policies.find((p) => p.id === id) ?? null,
      listByTenant: async (tenantId: Id) => dataset.policies.filter((p) => p.tenantId === tenantId),
    },
    integrations: {
      findById: async (id: Id) => dataset.integrations.find((i) => i.id === id) ?? null,
      listByTenant: async (tenantId: Id) => dataset.integrations.filter((i) => i.tenantId === tenantId),
    },
  };
}

/** Shared instance for server components in Part 1. */
export const mockRepositories: AuthorityRepositories = createInMemoryRepositories();
