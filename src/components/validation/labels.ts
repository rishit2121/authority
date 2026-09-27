export const CONTROL_LABEL: Record<string, string> = {
  gateway_auth: "Gateway authentication",
  contract_scope: "Contract scope",
  argument_constraints: "Argument constraints",
  policy: "Hard-deny policy",
  budget: "Invocation budget",
  semantic: "Semantic review",
  approval: "Human approval",
  capability: "Capability lifecycle",
  connector_guard: "Connector guard",
  connector_binding: "Connector binding",
  none: "No control (nothing intervened)",
};

export const CAUSE_LABEL: Record<string, string> = {
  invalid_plan: "Invalid plan",
  missing_justification: "Missing justification",
  wrong_tool: "Wrong tool",
  wrong_resource: "Wrong resource",
  argument_constraint_violation: "Argument constraint violation",
  policy_conflict: "Policy conflict",
  missing_approval: "Missing approval",
  stale_contract: "Stale contract",
  capability_misuse: "Capability misuse",
  prompt_injection: "Prompt injection",
  semantic_uncertainty: "Semantic uncertainty",
  configuration_error: "Configuration error",
};

export const SEVERITY_CLASS: Record<string, string> = {
  critical: "border-deny/50 bg-deny/15 text-deny",
  high: "border-deny/40 bg-deny/10 text-deny",
  medium: "border-secondary/40 bg-secondary/10 text-secondary",
  low: "border-primary/30 bg-primary/10 text-primary",
  info: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export const VERDICT_CLASS: Record<string, string> = {
  pass: "border-allow/30 bg-allow/10 text-allow",
  fail: "border-deny/40 bg-deny/10 text-deny",
  error: "border-secondary/40 bg-secondary/10 text-secondary",
  skipped: "border-outline-variant/40 bg-surface-container-high text-outline",
  running: "border-primary/30 bg-primary/10 text-primary",
};

export const STATUS_CLASS: Record<string, string> = {
  queued: VERDICT_CLASS.running,
  running: VERDICT_CLASS.running,
  completed: VERDICT_CLASS.pass,
  cancelled: VERDICT_CLASS.skipped,
  failed: VERDICT_CLASS.fail,
  expired: VERDICT_CLASS.error,
  proposed: "border-secondary/40 bg-secondary/10 text-secondary",
  accepted: "border-primary/30 bg-primary/10 text-primary",
  rejected: VERDICT_CLASS.skipped,
  verified: VERDICT_CLASS.pass,
  failed_verification: VERDICT_CLASS.fail,
  open: "border-deny/40 bg-deny/10 text-deny",
  remediation_proposed: "border-secondary/40 bg-secondary/10 text-secondary",
  fixed: VERDICT_CLASS.pass,
  wont_fix: VERDICT_CLASS.skipped,
  pass: VERDICT_CLASS.pass,
};

export const REMEDIATION_LABEL: Record<string, string> = {
  add_argument_constraint: "Add argument constraint",
  narrow_resource_binding: "Narrow resource binding",
  reduce_invocation_budget: "Reduce invocation budget",
  add_hard_deny: "Add hard-deny policy",
  require_human_approval: "Require human approval",
  enforce_semantic_review: "Enforce semantic review",
  remove_unneeded_action: "Remove unneeded action",
  shorten_capability_ttl: "Shorten capability lifetime",
  rotate_credential: "Rotate credential",
  update_tool_registry: "Update tool-registry definition",
  ask_user_clarification: "Ask the user to clarify",
  replan_with_allowed_operation: "Replan with an allowed operation",
  add_regression_scenario: "Add regression scenario",
};

export const humanize = (s: string) => s.replace(/_/g, " ");

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z";
}
