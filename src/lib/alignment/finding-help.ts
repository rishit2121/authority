/**
 * What each task-alignment finding means and what to do next. Shared by the
 * task page and the documentation so the two never disagree. Client-safe.
 */

export interface FindingHelp {
  title: string;
  meaning: string;
  next: string;
  /** Deterministic (decided from the request text, exact) vs a model judgment (probabilistic). */
  basis: "deterministic or model" | "model" | "system";
}

export const FINDING_HELP: Record<string, FindingHelp> = {
  wrong_recipient: {
    title: "Wrong recipient",
    meaning: "A recipient differs from the one the user named.",
    next: "Submit a plan that uses the recipient from the request, or approve the exception if the user really meant it.",
    basis: "deterministic or model",
  },
  wrong_channel: {
    title: "Wrong channel",
    meaning: "A channel differs from the one the user named.",
    next: "Submit a plan with the requested channel.",
    basis: "deterministic or model",
  },
  wrong_resource: {
    title: "Wrong resource",
    meaning: "A customer, account, payment or other id differs from the one in the request.",
    next: "Use the id from the request; if a lookup step should find it, bind it to that step's output.",
    basis: "deterministic or model",
  },
  wrong_amount: {
    title: "Wrong amount",
    meaning: "An amount differs from the one the user stated (minor units are compared exactly).",
    next: "Submit a plan with the requested amount.",
    basis: "deterministic or model",
  },
  wrong_currency: {
    title: "Wrong currency",
    meaning: "The plan uses a different currency from the request.",
    next: "Use the requested currency.",
    basis: "deterministic or model",
  },
  unrequested_side_effect: {
    title: "Unrequested side effect",
    meaning: "A step changes something the user did not ask to change.",
    next: "Remove the step and re-prepare, or have an administrator approve it.",
    basis: "model",
  },
  extra_operation: {
    title: "Extra operation",
    meaning: "A step does something the user did not ask for.",
    next: "Remove the step and re-prepare.",
    basis: "model",
  },
  contradicted_prohibition: {
    title: "Contradicts a prohibition",
    meaning: "A step (or content) would do something the user said must not happen.",
    next: "Remove it. This is never cleared by a high contribution score.",
    basis: "model",
  },
  unresolved_value: {
    title: "Unresolved value",
    meaning:
      "A consequential value (recipient, amount, id, link) is not determined by the request or by an earlier step.",
    next: "Ask the user, bind the value to an earlier step's output, or have an administrator review it.",
    basis: "deterministic or model",
  },
  missing_outcome: {
    title: "Missing outcome",
    meaning: "Something the user asked for is not done by any step.",
    next: "Add the missing step and re-prepare.",
    basis: "model",
  },
  misaligned_instruction: {
    title: "Does not serve the request",
    meaning:
      "Task Shield's contribution score for this step or call is 0: it does not contribute to any user objective.",
    next: "Re-plan using only steps that serve the request (the feedback lists the user's objectives).",
    basis: "model",
  },
  injected_directive: {
    title: "Instruction aimed at the agent",
    meaning: "External content tries to direct the agent toward something the user did not ask for.",
    next: "Do not act on it. In quarantine mode the content was withheld; in report mode tell your model to ignore it.",
    basis: "model",
  },
  uncertain_directive: {
    title: "Uncertain instruction in content",
    meaning: "Content directs the agent and the reviewer could not tell whether that serves the user.",
    next: "An administrator can review the original on the task page.",
    basis: "model",
  },
  data_instruction: {
    title: "Instruction that is part of the data",
    meaning:
      "An imperative inside the content (a ticket's request, a quoted email) that is data, not a command to the agent.",
    next: "Nothing -- informational.",
    basis: "model",
  },
  reviewer_unavailable: {
    title: "Not reviewed",
    meaning:
      "The reviewer did not complete (timeout, quota, budget, malformed output, or no model configured). This is never treated as a pass.",
    next: "Retry later, or have an administrator review it. Check the reviewer configuration and quota.",
    basis: "system",
  },
  oversized: {
    title: "Too large to inspect",
    meaning: "The content is larger than this application inspects; it was not inspected.",
    next: "Submit smaller pieces, or raise the limit.",
    basis: "system",
  },
  unsupported_content: {
    title: "Unsupported content type",
    meaning: "Only text/plain, text/markdown and application/json are inspected; this content was not.",
    next: "Convert it to text before submitting.",
    basis: "system",
  },
};

export function findingHelp(type: string): FindingHelp | undefined {
  return FINDING_HELP[type];
}
