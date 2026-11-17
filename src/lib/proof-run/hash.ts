import { createHash } from "node:crypto";

import { proofRunRecipeSchema, type ProofRunRecipe } from "./recipe";

/**
 * The identity of a Proof Run recipe: SHA-256 over the parsed recipe, serialized in schema order. The runner stores it
 * in every captured transcript and the site compares it with the checked-in recipe, so a changed scope (a different
 * channel, budget, tool or expectation) is never presented as covered by an older run. Whitespace and key order in the
 * file do not matter; any change in content does.
 *
 * Node-only (node:crypto). Use it from server components, the runner and the CLI, never from client code.
 */
export function recipeHash(recipe: ProofRunRecipe): string {
  const canonical = JSON.stringify(proofRunRecipeSchema.parse(recipe));
  return createHash("sha256").update(canonical).digest("hex");
}
