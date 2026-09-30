/**
 * OpenAI environment lookup, mirroring `lib/env.ts`'s two rules: never echo a
 * value, and resolve lazily so an unconfigured checkout doesn't fail at
 * import time. Unlike Supabase's env, this one is optional by design — its
 * absence is a normal, supported configuration (manual plan entry only),
 * never an error.
 */

export interface OpenAiEnv {
  apiKey: string;
  model: string;
}

// Verified directly against developers.openai.com/api/docs/models/gpt-6-luna (2026-09-30): OpenAI's current
// cheapest model ($0.10 / $0.50 per M input/output tokens), 1.05M context, supports the Chat Completions API and
// structured JSON output — plan proposal here uses neither function calling nor a non-default reasoning_effort,
// so gpt-6-luna's one documented caveat ("function calling only with reasoning_effort=none") does not apply.
// Overridable via OPENAI_MODEL; every plan this produces is untrusted and re-validated regardless of model.
const DEFAULT_MODEL = "gpt-6-luna";

/**
 * Returns null when no key is configured — callers fall back to manual plan
 * entry, never to a different provider silently. Takes an explicit env
 * record (defaulting to `process.env`) so this stays a pure, directly
 * testable function rather than one that can only be exercised by mutating
 * global process state.
 */
export function getOpenAiEnv(env: Record<string, string | undefined> = process.env): OpenAiEnv | null {
  const apiKey = env.OPENAI_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return null;
  const model = env.OPENAI_MODEL?.trim();
  return { apiKey, model: model && model.length > 0 ? model : DEFAULT_MODEL };
}
