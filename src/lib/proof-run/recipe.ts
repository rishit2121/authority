import { z } from "zod";

import capturedRunJson from "../../../examples/proof-run/captured-run.json";
import recipeJson from "../../../examples/proof-run/engineering-update.json";

/**
 * Proof Run: one checked-in recipe (examples/proof-run/engineering-update.json) is the single source for the public
 * example, the local runner (src/tests/local/proof-run.test.ts, `npm run authority -- demo`) and the code shown on the
 * site. The runner compares every attempt with its `expect` and fails when an expected block becomes an allow or an
 * unexpected provider dispatch happens. Authority itself decides each attempt; nothing here is a policy engine.
 *
 * Isomorphic: no Node-only imports, so the client-side playback can use it.
 */

const argumentValue = z.union([z.string(), z.number(), z.boolean()]);

export const proofRunRecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    title: z.string().min(1).max(120),
    request: z.string().min(1).max(500),
    connection: z.object({
      connector: z.string().min(1),
      identity: z.string().min(1),
      note: z.string().min(1),
    }),
    channels: z.record(z.string(), z.string()),
    plan: z
      .array(
        z.object({
          id: z.string().min(1),
          tool: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/),
          arguments: z.record(z.string(), argumentValue),
          agentGenerated: z.array(z.string()).optional(),
          expectedSideEffect: z.enum(["read", "write_create", "write_update", "write_delete", "admin"]),
          maxInvocations: z.number().int().min(1).max(20),
        }),
      )
      .min(1),
    attempts: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]{1,60}$/),
          label: z.string().min(1),
          /** Run in the same task, after this attempt (to prove a spent budget). Otherwise a fresh task. */
          after: z.string().optional(),
          tool: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/),
          arguments: z.record(z.string(), argumentValue),
          expect: z.object({
            outcome: z.enum(["executed", "blocked"]),
            reasonCode: z.string().optional(),
            dispatches: z.number().int().min(0),
          }),
        }),
      )
      .min(1),
  })
  .strict();

export type ProofRunRecipe = z.infer<typeof proofRunRecipeSchema>;
export type ProofRunAttempt = ProofRunRecipe["attempts"][number];

export const engineeringUpdateRecipe: ProofRunRecipe = proofRunRecipeSchema.parse(recipeJson);

/**
 * Attempts grouped into independent task runs: an attempt with `after` runs in the same task as (and right after) the
 * attempt it names; every other attempt gets a fresh task, so a block is proven for its own reason (a wrong
 * destination is refused while the budget is still unspent).
 */
export function taskRunsFor(recipe: ProofRunRecipe): ProofRunAttempt[][] {
  const byId = new Map(recipe.attempts.map((a) => [a.id, a]));
  const runs: ProofRunAttempt[][] = [];
  const runOf = new Map<string, ProofRunAttempt[]>();
  for (const attempt of recipe.attempts) {
    if (attempt.after) {
      const parent = byId.get(attempt.after);
      if (!parent) throw new Error(`attempt ${attempt.id} runs after unknown attempt ${attempt.after}`);
      const run = runOf.get(parent.id);
      if (!run) throw new Error(`attempt ${attempt.id} must come after ${attempt.after} in the recipe`);
      run.push(attempt);
      runOf.set(attempt.id, run);
    } else {
      const run = [attempt];
      runs.push(run);
      runOf.set(attempt.id, run);
    }
  }
  return runs;
}

/** What happened to one attempt. These are different things and the UI never merges them. */
export type ProofRunResult =
  /** Authority allowed it and the provider confirmed the write (a receipt exists). */
  | "executed"
  /** Authority refused it; nothing reached the provider. */
  | "blocked_before_dispatch"
  /** Allowed, but the result was held for review before reaching the agent. */
  | "result_held"
  /** Allowed and dispatched, but the provider outcome is unknown (never retried automatically). */
  | "indeterminate"
  /** Allowed, dispatched, and the provider refused or failed. */
  | "failed";

export interface ProofRunTranscriptAttempt {
  id: string;
  /** Authority's decision status, exactly as returned by POST /api/v1/authorize. */
  decision: string;
  reasonCodes: string[];
  /** Authority's own summary of the decision. */
  summary: string;
  /** How many requests reached the (mock) provider for this attempt. */
  dispatches: number;
  result: ProofRunResult;
  /** Present only when the provider accepted the write. Identifiers are redacted. */
  receipt: { result: string; receiptId: string } | null;
}

export interface ProofRunTranscript {
  schemaVersion: 1;
  recipeId: string;
  /** SHA-256 of the recipe the run used. A different recipe is a different scope; the old proof does not cover it. */
  recipeHash: string;
  /**
   * "local-fixture": captured from a real run of the local runner against the mock Slack transport.
   * "illustrative": written by hand to show the format; the UI must label it as such.
   */
  source: "local-fixture" | "illustrative";
  provider: "mock-slack";
  capturedAt: string;
  attempts: ProofRunTranscriptAttempt[];
}

/** One plain sentence per attempt, readable without color. */
export function describeResult(result: ProofRunResult): string {
  switch (result) {
    case "executed":
      return "Allowed and executed: the provider received one request and returned a receipt.";
    case "blocked_before_dispatch":
      return "Blocked before dispatch: nothing reached the provider.";
    case "result_held":
      return "Allowed, but the result is held for review.";
    case "indeterminate":
      return "Allowed and dispatched, but the provider's outcome is unknown. It is not retried.";
    case "failed":
      return "Allowed and dispatched, but the provider refused or failed.";
  }
}

/** The transcript the public example plays back (sanitized; see examples/proof-run/README.md). */
export const capturedRun = capturedRunJson as ProofRunTranscript;
