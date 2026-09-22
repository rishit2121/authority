import type { AuthorityRepositories } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { createSupabaseAgentRepository } from "./agent-repository";
import { createSupabaseApprovalRepository } from "./approval-repository";
import { createSupabaseCapabilityRepository, createSupabaseDecisionRepository } from "./decision-repository";
import { createSupabaseEventRepository } from "./event-repository";
import { createSupabaseIntegrationRepository } from "./integration-repository";
import { createSupabasePlanRepository, createSupabaseToolRequestRepository } from "./plan-repository";
import { createSupabasePolicyRepository } from "./policy-repository";
import { createSupabaseContractRepository, createSupabaseTaskRepository } from "./task-repository";
import { createSupabasePrincipalRepository, createSupabaseTenantRepository } from "./tenant-repository";

export type { RepositoryContext } from "../context";
export { RepositoryError, type RepositoryErrorCode } from "../errors";

/**
 * Assembles every bounded-area Supabase repository into the same
 * `AuthorityRepositories` aggregate `mockRepositories` satisfies.
 *
 * Not wired into any page, loader or the application's composition point in
 * this commit — `src/lib/mock/in-memory-repositories.ts`'s `mockRepositories`
 * remains what every existing consumer uses. Wiring a real switch between
 * the two, gated by explicit development configuration rather than a silent
 * runtime fallback, is Part 2B.2's job once the UI is ready to read from
 * Supabase.
 *
 * `context.tenantId` must already be server-verified — see
 * `RepositoryContext` in `../context.ts` — never a raw value from a form,
 * query string or cookie.
 */
export function createSupabaseRepositories(context: RepositoryContext): AuthorityRepositories {
  return {
    tenants: createSupabaseTenantRepository(context),
    principals: createSupabasePrincipalRepository(context),
    agents: createSupabaseAgentRepository(context),
    tasks: createSupabaseTaskRepository(context),
    contracts: createSupabaseContractRepository(context),
    plans: createSupabasePlanRepository(context),
    toolRequests: createSupabaseToolRequestRepository(context),
    decisions: createSupabaseDecisionRepository(context),
    capabilities: createSupabaseCapabilityRepository(context),
    approvals: createSupabaseApprovalRepository(context),
    events: createSupabaseEventRepository(context),
    policies: createSupabasePolicyRepository(context),
    integrations: createSupabaseIntegrationRepository(context),
  };
}
