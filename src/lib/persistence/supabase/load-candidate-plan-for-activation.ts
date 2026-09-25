import type { CandidatePlan } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { throwDatabaseError } from "../errors";
import { reconstructCandidatePlan } from "../mappers/candidate-plan-reconstruction";

/**
 * Loads the exact plan a contract's activation must re-verify against, by
 * the contract's own `plan_id` — never "the task's latest plan", which
 * could be a different, later version than the one this specific contract
 * was compiled from.
 */
export async function loadCandidatePlanForActivation(
  context: RepositoryContext,
  taskId: string,
  planId: string,
): Promise<CandidatePlan> {
  const { data, error } = await context.supabase.from("plan_nodes").select("*").eq("plan_id", planId);

  if (error) throwDatabaseError("load plan nodes for activation", error);
  return reconstructCandidatePlan(taskId, data ?? []);
}
