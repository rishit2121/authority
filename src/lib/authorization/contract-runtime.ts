import type { TaskAuthorityContract } from "@/lib/domain";

/**
 * The one question anything is allowed to ask about whether a contract is
 * currently authoritative — never `contract.status === "active"` alone.
 *
 * `contract_status = 'active'` in the database can be stale: expiration in
 * this phase is based on an explicit `expiresAt` timestamp, not exclusively
 * on `reconcile_expired_contracts()` (a maintenance RPC, not a guarantee)
 * ever having run. A past-due active contract must be treated as not
 * currently active by every caller, regardless of what its stored status
 * says, until something reconciles it. Mirrors
 * `authz.contract_is_currently_active()` in the database exactly — the two
 * are independent implementations of the same invariant, in two different
 * runtimes, not one calling the other; tests hold both to the same cases.
 *
 * Part 3B has no runtime tool-call consumption path yet (that is explicitly
 * out of scope — see the Part 3B completion report's "deferred to Jev"
 * section). This function exists now so that invariant is encoded and
 * tested before any consumer of it exists, rather than left as an implicit
 * assumption a future runtime-enforcement phase would have to rediscover.
 */
export function isContractCurrentlyActive(
  contract: Pick<TaskAuthorityContract, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (contract.status !== "active") return false;
  if (!contract.expiresAt) return true;
  return new Date(contract.expiresAt).getTime() > now.getTime();
}
