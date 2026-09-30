/**
 * OpenRouter environment lookup, mirroring `lib/ai/env.ts` and `lib/semantic`'s pattern: never echo a value, resolve
 * lazily, and treat absence as a normal, supported configuration (every OpenRouter-backed feature has a non-OpenRouter
 * or disabled fallback), never an error by itself.
 *
 * Three distinct roles read this same key but never each other's model configuration (see docs/jev/OVERVIEW.md):
 *  - `OPENROUTER_PLAN_MODEL` (default `typesafe/jev-router`): candidate-plan proposal, behind the existing
 *    `PlanProposalProvider` port — a general chat-completions-style model, requested with structured JSON output.
 *  - `OPENROUTER_JEV_DECISION_MODEL`: the direct Jev structured-decision model, called through OpenRouter's separate
 *    Decisions API (`/api/alpha/decisions`), never the chat-completions endpoint. No default: this must be set
 *    explicitly once the exact model slug you want to pin is confirmed (see docs/jev/SETUP.md) — the necessity and
 *    risk evaluators refuse to run rather than guess a slug.
 */

export interface OpenRouterEnv {
  apiKey: string;
  baseUrl: string;
  planModel: string;
  /** null when not configured — necessity/risk evaluation is then unavailable, never silently mocked. */
  jevDecisionModel: string | null;
  /** Sent as `HTTP-Referer` / `X-Title` — optional attribution OpenRouter's dashboard uses; never authentication. */
  referer: string | null;
  title: string | null;
  /** When true, requests carry `provider: { data_collection: "deny" }` — see docs/jev/OVERVIEW.md's privacy section. */
  denyDataCollection: boolean;
  zdrOnly: boolean;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_PLAN_MODEL = "typesafe/jev-router";

export function getOpenRouterEnv(
  env: Record<string, string | undefined> = process.env,
): OpenRouterEnv | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL,
    planModel: env.OPENROUTER_PLAN_MODEL?.trim() || DEFAULT_PLAN_MODEL,
    jevDecisionModel: env.OPENROUTER_JEV_DECISION_MODEL?.trim() || null,
    referer: env.OPENROUTER_HTTP_REFERER?.trim() || null,
    title: env.OPENROUTER_X_TITLE?.trim() || null,
    denyDataCollection: env.OPENROUTER_DENY_DATA_COLLECTION === "1",
    zdrOnly: env.OPENROUTER_ZDR_ONLY === "1",
  };
}
