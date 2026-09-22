import type { Agent } from "./agent";
import type { Approval } from "./approval";
import type { AuthorizationDecision } from "./authorization-decision";
import type { Capability } from "./capability";
import type { Id } from "./common";
import type { ExecutionEvent } from "./execution-event";
import type { Plan } from "./plan";
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

export interface TaskRepository {
  findById(id: Id): Promise<Task | null>;
  listByTenant(tenantId: Id): Promise<Task[]>;
}

export interface ContractRepository {
  findByTaskId(taskId: Id): Promise<TaskAuthorityContract | null>;
}

export interface PlanRepository {
  findByTaskId(taskId: Id): Promise<Plan | null>;
}

export interface ToolRequestRepository {
  listByTaskId(taskId: Id): Promise<ToolRequest[]>;
}

export interface DecisionRepository {
  findById(id: Id): Promise<AuthorizationDecision | null>;
  listByTaskId(taskId: Id): Promise<AuthorizationDecision[]>;
}

export interface CapabilityRepository {
  listByTaskId(taskId: Id): Promise<Capability[]>;
  listActiveByTenant(tenantId: Id): Promise<Capability[]>;
}

export interface ApprovalRepository {
  listByTenant(tenantId: Id): Promise<Approval[]>;
  listPendingByTenant(tenantId: Id): Promise<Approval[]>;
}

export interface ExecutionEventRepository {
  listByTaskId(taskId: Id): Promise<ExecutionEvent[]>;
}

/** Aggregate handed to the UI so pages depend on one seam, not eleven. */
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
}
