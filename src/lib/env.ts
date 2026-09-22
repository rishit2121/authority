import { z } from "zod";

/**
 * Runtime environment validation.
 *
 * Two rules shape this file:
 *
 *  1. Values are never echoed. A misconfiguration reports which *names* are
 *     missing or malformed and nothing about what they contained, so a stack
 *     trace or CI log can never leak a key.
 *  2. Validation is lazy. Reading the environment at module scope would make
 *     an unconfigured checkout fail at import time — including for the
 *     marketing pages, which need no Supabase at all.
 */

const urlSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an absolute https URL");

/**
 * Publishable keys (`sb_publishable_…`) and the legacy anon JWT (`eyJ…`) are
 * both public by design: they carry no privileges and every request made with
 * them is still subject to row level security. The length floor only catches
 * truncated copy-paste.
 */
const publishableKeySchema = z.string().min(20);

const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: urlSchema,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKeySchema,
});

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

export class EnvironmentError extends Error {
  readonly missing: readonly string[];

  constructor(message: string, missing: readonly string[]) {
    super(message);
    this.name = "EnvironmentError";
    this.missing = missing;
  }
}

/** The variable names this application reads, for error messages and docs. */
export const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

const LEGACY_ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

/**
 * Pure parse over a plain record, so the rules are testable without touching
 * `process.env`.
 *
 * A legacy project holds an anon JWT rather than a publishable key. Rather
 * than requiring both public keys to be set, the legacy name is accepted as a
 * fallback and normalized to one field here — this is the only place the
 * distinction exists.
 */
export function parseSupabaseEnv(source: Record<string, string | undefined>): SupabaseEnv {
  const candidate = {
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || source[LEGACY_ANON_KEY]?.trim() || undefined,
  };

  const result = supabaseEnvSchema.safeParse(candidate);

  if (result.success) {
    return {
      url: result.data.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ""),
      publishableKey: result.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
  }

  // Report names and the rule that failed. Never the value.
  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "environment");
    const shown = name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" ? `${name} (or ${LEGACY_ANON_KEY})` : name;
    return `  ${shown} — ${issue.message}`;
  });

  const missing = result.error.issues.map((issue) => String(issue.path[0] ?? "environment"));

  throw new EnvironmentError(
    [
      "Supabase is not configured.",
      "",
      ...problems,
      "",
      "Copy .env.example to .env.local and fill in the values from",
      "Supabase → Project Settings → API, then restart the dev server.",
    ].join("\n"),
    missing,
  );
}

/**
 * Reads the validated Supabase environment.
 *
 * The `process.env.X` references are written out literally rather than looked
 * up dynamically because Next.js inlines NEXT_PUBLIC_ variables by matching
 * the literal text at build time; `process.env[name]` would be left as a
 * runtime lookup and come back undefined in the browser.
 */
export function getSupabaseEnv(): SupabaseEnv {
  return parseSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** True when Supabase is configured, for surfaces that must degrade rather than crash. */
export function isSupabaseConfigured(): boolean {
  try {
    getSupabaseEnv();
    return true;
  } catch {
    return false;
  }
}
