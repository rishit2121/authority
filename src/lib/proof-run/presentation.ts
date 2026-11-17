import type {
  ProofRunAttempt,
  ProofRunRecipe,
  ProofRunResult,
  ProofRunTranscript,
  ProofRunTranscriptAttempt,
} from "./recipe";

/**
 * Pure presentation helpers for the public Proof Run (home page and /demo). Nothing here decides anything:
 * Authority's decision, reason codes and dispatch count come from the transcript; this only turns them into
 * words. Isomorphic, so the client-side playback and the unit tests share it.
 */

// ---------------------------------------------------------------------------------------------------------------
// Scope card
// ---------------------------------------------------------------------------------------------------------------

export interface ScopeRow {
  label: string;
  value: string;
  /** A short qualifier shown after the value, e.g. "pinned". */
  qualifier?: string;
  /** The value is an identifier (a tool name) and renders in monospace. */
  code?: boolean;
}

export interface ScopeCard {
  request: string;
  rows: ScopeRow[];
}

/** Human labels for argument names the recipe pins or leaves to the agent. Unknown names fall back to the key. */
const ARGUMENT_LABELS: Record<string, string> = {
  channel: "Destination",
  text: "Message text",
  to: "Recipient",
  subject: "Subject",
  body: "Body",
};

/** What one invocation of a tool is called in the limit row ("1 post"). */
const INVOCATION_NOUNS: Record<string, [singular: string, plural: string]> = {
  "slack.post_message": ["post", "posts"],
  "gmail.send_email": ["email", "emails"],
};

/** What an out-of-contract connector is called in the "Not allowed" row. */
const CONNECTOR_NOUNS: Record<string, string> = {
  gmail: "email",
  slack: "Slack",
  github: "GitHub",
  stripe: "Stripe",
  linear: "Linear",
  notion: "Notion",
};

function argumentLabel(key: string): string {
  return ARGUMENT_LABELS[key] ?? key;
}

function invocationLimit(tool: string, max: number): string {
  const [singular, plural] = INVOCATION_NOUNS[tool] ?? ["call", "calls"];
  return `${max} ${max === 1 ? singular : plural}`;
}

/** Show a channel ID as its name when the recipe knows it; any other value as itself. */
export function displayArgumentValue(
  recipe: Pick<ProofRunRecipe, "channels">,
  key: string,
  value: string | number | boolean,
): string {
  if (key === "channel" && typeof value === "string") return recipe.channels[value] ?? value;
  return String(value);
}

/**
 * The scope card's rows, derived from the recipe's plan (tool, pinned arguments, agent-written fields, limit) and
 * from the attempts whose tool is not in the plan ("Not allowed").
 */
export function scopeCardFor(recipe: ProofRunRecipe): ScopeCard {
  const rows: ScopeRow[] = [];
  for (const action of recipe.plan) {
    rows.push({ label: "Tool", value: action.tool, code: true });
    for (const [key, value] of Object.entries(action.arguments)) {
      rows.push({
        label: argumentLabel(key),
        value: displayArgumentValue(recipe, key, value),
        qualifier: "pinned",
      });
    }
    for (const key of action.agentGenerated ?? []) {
      rows.push({ label: argumentLabel(key), value: "written by the agent" });
    }
    rows.push({ label: "Limit", value: invocationLimit(action.tool, action.maxInvocations) });
  }

  const planned = new Set(recipe.plan.map((action) => action.tool));
  const notAllowed: string[] = [];
  for (const attempt of recipe.attempts) {
    if (planned.has(attempt.tool)) continue;
    const connector = attempt.tool.split(".")[0] ?? attempt.tool;
    const noun = CONNECTOR_NOUNS[connector] ?? attempt.tool;
    if (!notAllowed.includes(noun)) notAllowed.push(noun);
  }
  if (notAllowed.length > 0) rows.push({ label: "Not allowed", value: notAllowed.join(", ") });

  return { request: recipe.request, rows };
}

// ---------------------------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------------------------

/** Plain-language reason per Authority reason code. Unknown codes fall back to Authority's own summary. */
export const REASON_SENTENCES: Record<string, string> = {
  WITHIN_CONTRACT: "Matches the contract: right tool, pinned destination, budget available.",
  CONSTRAINT_VIOLATION: "The destination is pinned to #engineering; #general is outside the contract.",
  INVOCATION_LIMIT_REACHED:
    "This task allowed one post and it was already used. A new attempt with a new idempotency key is refused, not retried.",
  TOOL_NOT_IN_CONTRACT: "Email is not part of this task's contract.",
};

export function reasonSentence(attempt: Pick<ProofRunTranscriptAttempt, "reasonCodes" | "summary">): string {
  for (const code of attempt.reasonCodes) {
    const sentence = REASON_SENTENCES[code];
    if (sentence) return sentence;
  }
  return attempt.summary;
}

/** Authority's decision status as a word. Kept apart from the result: "Allowed" is not "Executed". */
export function decisionLabel(decision: string): string {
  switch (decision) {
    case "allow":
    case "allow_constrained":
      return "Allowed";
    case "deny":
      return "Denied";
    case "replan":
      return "Replan required";
    case "clarify":
      return "Clarification required";
    case "require_approval":
      return "Approval required";
    default:
      return decision;
  }
}

export type OutcomeTone = "executed" | "blocked" | "held" | "unknown" | "failed";

export interface OutcomePresentation {
  /** The status word shown everywhere this attempt is summarized. Never shared between two results. */
  label: string;
  tone: OutcomeTone;
}

export function outcomeFor(result: ProofRunResult): OutcomePresentation {
  switch (result) {
    case "executed":
      return { label: "Executed", tone: "executed" };
    case "blocked_before_dispatch":
      return { label: "Blocked before dispatch", tone: "blocked" };
    case "result_held":
      return { label: "Result held", tone: "held" };
    case "indeterminate":
      return { label: "Outcome unknown", tone: "unknown" };
    case "failed":
      return { label: "Provider refused", tone: "failed" };
  }
}

export function dispatchStatus(dispatches: number): string {
  if (dispatches === 0) return "Not dispatched — blocked before the provider";
  if (dispatches === 1) return "Reached the provider once";
  return `Reached the provider ${dispatches} times`;
}

// ---------------------------------------------------------------------------------------------------------------
// Playback rows: recipe attempt + transcript entry
// ---------------------------------------------------------------------------------------------------------------

export interface PlaybackArgument {
  key: string;
  /** As sent to Authority (a channel ID stays an ID here). */
  raw: string;
  /** As a person reads it (a channel ID becomes its name). */
  display: string;
}

export interface PlaybackAttempt {
  attempt: ProofRunAttempt;
  transcript: ProofRunTranscriptAttempt;
  arguments: PlaybackArgument[];
  /** The label of the attempt this one runs after, in the same task (a spent budget). */
  afterLabel: string | null;
}

/** Recipe attempts in recipe order, each joined with its transcript entry. Throws if the transcript is missing one. */
export function playbackFor(recipe: ProofRunRecipe, transcript: ProofRunTranscript): PlaybackAttempt[] {
  const entries = new Map(transcript.attempts.map((entry) => [entry.id, entry]));
  const labels = new Map(recipe.attempts.map((attempt) => [attempt.id, attempt.label]));
  return recipe.attempts.map((attempt) => {
    const entry = entries.get(attempt.id);
    if (!entry) throw new Error(`transcript has no entry for attempt ${attempt.id}`);
    return {
      attempt,
      transcript: entry,
      arguments: Object.entries(attempt.arguments).map(([key, value]) => ({
        key,
        raw: String(value),
        display: displayArgumentValue(recipe, key, value),
      })),
      afterLabel: attempt.after ? (labels.get(attempt.after) ?? attempt.after) : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------------------------------------------

export interface Provenance {
  badge: string;
  /** "Illustrative transcript" or "Captured from the local fixture run". */
  source: string;
  /** ISO date (YYYY-MM-DD) when the run was captured; only for a real capture. */
  capturedOn: string | null;
  /** Set when the recipe changed after the capture: the old run does not prove the new scope. */
  staleWarning: string | null;
}

export const STALE_RECIPE_WARNING =
  "Recipe changed since this run was captured — this run does not cover the new scope.";

export function provenanceFor(
  transcript: Pick<ProofRunTranscript, "source" | "capturedAt">,
  recipeHashMatches: boolean,
): Provenance {
  // Only a real capture can be stale. A hand-written transcript has no hash and was never captured from any recipe;
  // it is labeled illustrative instead of "changed since capture".
  const captured = transcript.source === "local-fixture";
  return {
    badge: "Example run · No accounts connected",
    source: captured ? "Captured from the local fixture run" : "Illustrative transcript",
    capturedOn: captured ? transcript.capturedAt.slice(0, 10) : null,
    staleWarning: captured && !recipeHashMatches ? STALE_RECIPE_WARNING : null,
  };
}
