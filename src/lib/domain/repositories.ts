import type { Agent } from "./agent";
import type { Approval } from "./approval";
import type { AuthorizationDecision } from "./authorization-decision";
import type { Capability } from "./capability";
import type { Id } from "./common";
import type { ExecutionEvent } from "./execution-event";
import type { Integration } from "./integration";
import type { PageOptions, PageResult } from "./pagination";
import type { Plan } from "./plan";
import type { Policy } from "./policy";
import type { Principal } from "./principal";
import type { Task } from "./task";
import type { TaskAuthorityContract } from "./task-authority-contract";
import type { Tenant } from "./tenant";
import type { ToolRequest } from "./tool-request";

/**
 * Persistence seams.
 *
 * These are interfaces only — no storage engine is chosen here. Part 1 binds
 * them to in-memory fixtures; a later part can bind the same interfaces to
 * Supabase without touching any consumer. Everything is async so a real
 * implementation is a drop-in.
 *
 * Part 2B.1 adds pagination as new, additional methods rather than by
 * changing any existing signature: every `listX(id): Promise<X[]>` below is
 * untouched, so every Part 1/2A caller, test and mock implementation
 * continues to compile and pass without modification. Where the underlying
 * table can grow without bound with tenant activity, a `listXPaged` sibling
 * is added returning `PageResult<X>`. Tables that stay small (memberships,
 * policies, integrations) get no such sibling — pagination there would be
 * ceremony without a growth problem to solve.
 */

export interface TenantRepository {
  findById(id: Id): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
}

export interface PrincipalRepository {
  findById(id: Id): Promise<Principal | null>;
  listByTenant(tenantId: Id): Promise<Principal[]>;
}

export interface AgentRepository {
  findById(id: Id): Promise<Agent | null>;
  listByTenant(tenantId: Id): Promise<Agent[]>;
}

/** Narrowing applied server-side, ahead of pagination — the Tasks list page's Status/Agent/Search filters. */
export interface TaskListFilters {
  status?: Task["status"];
  agentId?: Id;
  /** Case-insensitive substring match against the task's intent text. */
  search?: string;
}

export interface TaskRepository {
  findById(id: Id): Promise<Task | null>;
  listByTenant(tenantId: Id): Promise<Task[]>;
  /** Tasks accumulate per tenant indefinitely; the dashboard needs this bounded. */
  listByTenantPaged(
    tenantId: Id,
    options?: PageOptions,
    filters?: TaskListFilters,
  ): Promise<PageResult<Task>>;
}

export interface ContractRepository {
  /** The task's latest contract version, in whatever lifecycle status it's in — for display only. */
  findByTaskId(taskId: Id): Promise<TaskAuthorityContract | null>;
  /**
   * The task's `active` contract, or null if none is active — the *only*
   * sanctioned lookup for any future authority-consuming code path (e.g.
   * capability issuance). Deliberately separate from `findByTaskId`: that
   * method's result is a display concern, this one is a security boundary.
   * A `proposed`/`awaiting_approval`/`rejected` contract must never be
   * mistaken for authoritative merely because it's the latest version.
   */
  findActiveByTaskId(taskId: Id): Promise<TaskAuthorityContract | null>;
  /** One exact contract version by its own id — for approval/activation actions that must target a specific, non-latest version. */
  findById(contractId: Id): Promise<TaskAuthorityContract | null>;
  /** Every version ever proposed for a task, newest first — for the contract version history UI. */
  listByTaskId(taskId: Id): Promise<TaskAuthorityContract[]>;
  /**
   * `findByTaskId`'s display-only "latest version" lookup, batched across
   * several tasks in one call — the same reason `DecisionRepository.countByTaskIds`
   * exists: a tasks list showing N rows must not cost N queries.
   */
  listLatestByTaskIds(taskIds: readonly Id[]): Promise<Map<Id, TaskAuthorityContract>>;
}

export interface PlanRepository {
  findByTaskId(taskId: Id): Promise<Plan | null>;
}

export interface ToolRequestRepository {
  listByTaskId(taskId: Id): Promise<ToolRequest[]>;
  listByTaskIdPaged(taskId: Id, options?: PageOptions): Promise<PageResult<ToolRequest>>;
}

export interface DecisionCounts {
  total: number;
  blocked: number;
}

export interface DecisionRepository {
  findById(id: Id): Promise<AuthorizationDecision | null>;
  listByTaskId(taskId: Id): Promise<AuthorizationDecision[]>;
  listByTaskIdPaged(taskId: Id, options?: PageOptions): Promise<PageResult<AuthorizationDecision>>;
  /**
   * Decision/blocked counts for several tasks in one call, keyed by task id.
   * Exists specifically so a dashboard listing N tasks costs one query, not
   * N — see loadDashboardOverview in lib/data/dashboard.ts, which used to
   * call listByTaskId once per task before this method existed.
   */
  countByTaskIds(taskIds: readonly Id[]): Promise<Map<Id, DecisionCounts>>;
}

export interface CapabilityRepository {
  listByTaskId(taskId: Id): Promise<Capability[]>;
  listActiveByTenant(tenantId: Id): Promise<Capability[]>;
  /** Active capabilities are a live, tenant-wide list — also worth bounding. */
  listActiveByTenantPaged(tenantId: Id, options?: PageOptions): Promise<PageResult<Capability>>;
}

export interface ApprovalRepository {
  listByTenant(tenantId: Id): Promise<Approval[]>;
  listPendingByTenant(tenantId: Id): Promise<Approval[]>;
  listByTenantPaged(tenantId: Id, options?: PageOptions): Promise<PageResult<Approval>>;
  /** Bounded by one task's own approvals, not the tenant's — for the task investigation view. */
  listByTaskId(taskId: Id): Promise<Approval[]>;
}

export interface ExecutionEventRepository {
  listByTaskId(taskId: Id): Promise<ExecutionEvent[]>;
  /** The one most likely to run long in a real workspace — a task's full audit trail. */
  listByTaskIdPaged(taskId: Id, options?: PageOptions): Promise<PageResult<ExecutionEvent>>;
}

/** Organization policy, evaluated deterministically alongside the contract. */
export interface PolicyRepository {
  findById(id: Id): Promise<Policy | null>;
  listByTenant(tenantId: Id): Promise<Policy[]>;
}

/** Connected tool provider metadata — never a credential. */
export interface IntegrationRepository {
  findById(id: Id): Promise<Integration | null>;
  listByTenant(tenantId: Id): Promise<Integration[]>;
}

/** Aggregate handed to the UI so pages depend on one seam, not thirteen. */
export interface AuthorityRepositories {
  tenants: TenantRepository;
  principals: PrincipalRepository;
  agents: AgentRepository;
  tasks: TaskRepository;
  contracts: ContractRepository;
  plans: PlanRepository;
  toolRequests: ToolRequestRepository;
  decisions: DecisionRepository;
  capabilities: CapabilityRepository;
  approvals: ApprovalRepository;
  events: ExecutionEventRepository;
  policies: PolicyRepository;
  integrations: IntegrationRepository;
}
