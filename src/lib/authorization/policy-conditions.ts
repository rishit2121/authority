import { wildcardMatch } from "./wildcard-match";

/**
 * The closed contract under which Part 3A's plan validator interprets an
 * existing `Policy` row's `{key, matches}` conditions.
 *
 * Reusing the existing `Policy` schema is only safe because its semantics
 * are pinned exactly here, not left to whatever a glob happens to do:
 *
 *  - Keys are a closed enum. An unrecognized key on an active `deny` policy
 *    fails closed (`requires_review` on anything the policy could plausibly
 *    reach) rather than being silently skipped, since ignoring an
 *    uninterpretable deny would silently widen authority. An unrecognized
 *    key on an `allow` policy is ignored — an allow this validator cannot
 *    interpret grants nothing, consistent with default-deny.
 *  - The only operator is `matches`: a single-level `*` wildcard (see
 *    wildcard-match.ts — dynamic programming, no regex), full-string,
 *    case-insensitive after lowercasing both sides, pattern and candidate
 *    each capped at 200 characters and restricted to printable ASCII.
 *    Anything outside that is rejected as malformed policy data, not
 *    "normalized" into something else.
 */

export const SUPPORTED_POLICY_KEYS = ["tool", "resource", "provider"] as const;
export type SupportedPolicyKey = (typeof SUPPORTED_POLICY_KEYS)[number];

/**
 * Approval rules (`require_approval` policies) additionally understand
 * `action`: the kinds of effect an operation has, from trusted registry
 * metadata only, never from the plan or request. Deny policies do not --
 * an `action` key on a deny policy is still unsupported and fails closed.
 */
export const APPROVAL_RULE_KEYS = [...SUPPORTED_POLICY_KEYS, "action"] as const;
export type ApprovalRuleKey = (typeof APPROVAL_RULE_KEYS)[number];

export const ACTION_KINDS = ["read", "write", "delete", "money", "sensitive", "external"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export function isApprovalRuleKey(key: string): key is ApprovalRuleKey {
  return (APPROVAL_RULE_KEYS as readonly string[]).includes(key);
}

/** Every action kind an operation has; one operation can have several (a refund is write + money + sensitive). */
export function actionKindsOf(operation: {
  sideEffect: string;
  financialImpact: boolean;
  dataSensitivity: string;
  externalCommunication: boolean;
}): ActionKind[] {
  const kinds: ActionKind[] = [operation.sideEffect === "read" ? "read" : "write"];
  if (operation.sideEffect === "write_delete" || operation.sideEffect === "admin") kinds.push("delete");
  if (operation.financialImpact) kinds.push("money");
  if (operation.dataSensitivity === "confidential" || operation.dataSensitivity === "secret")
    kinds.push("sensitive");
  if (operation.externalCommunication) kinds.push("external");
  return kinds;
}

export const MAX_POLICY_PATTERN_LENGTH = 200;
export const MAX_POLICY_CANDIDATE_LENGTH = 200;

/** Printable ASCII only (0x20-0x7e) — rejects control characters and non-ASCII outright. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

export function isSupportedPolicyKey(key: string): key is SupportedPolicyKey {
  return (SUPPORTED_POLICY_KEYS as readonly string[]).includes(key);
}

export type PatternValidity = "valid" | "too_long" | "not_printable_ascii";

export function validatePolicyPattern(pattern: string): PatternValidity {
  if (pattern.length > MAX_POLICY_PATTERN_LENGTH) return "too_long";
  if (!PRINTABLE_ASCII.test(pattern)) return "not_printable_ascii";
  return "valid";
}

export function validatePolicyCandidate(candidate: string): PatternValidity {
  if (candidate.length > MAX_POLICY_CANDIDATE_LENGTH) return "too_long";
  if (!PRINTABLE_ASCII.test(candidate)) return "not_printable_ascii";
  return "valid";
}

/**
 * Evaluates one `{key, matches}` condition against a candidate value already
 * resolved for that key (e.g. the plan node's `tool`, `resource` or
 * `provider`). Returns `null` — not `false` — when either the pattern or the
 * candidate fails validation, so a caller can distinguish "did not match"
 * from "could not evaluate," and the latter is treated as `requires_review`
 * for a deny policy exactly like an unsupported key, never as a silent pass.
 */
export function evaluatePolicyCondition(pattern: string, candidateValue: string): boolean | null {
  if (validatePolicyPattern(pattern) !== "valid") return null;
  if (validatePolicyCandidate(candidateValue) !== "valid") return null;
  return wildcardMatch(pattern, candidateValue);
}
