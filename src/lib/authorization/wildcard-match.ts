/**
 * Deterministic wildcard matching — no regex engine involved anywhere.
 *
 * Supports exactly: literal printable ASCII, and `*` meaning zero or more
 * characters. Matching is full-string (implicitly anchored at both ends) and
 * case-insensitive after lowercasing both sides. Both pattern and candidate
 * are ASCII-only by construction upstream (see policy-conditions.ts), so
 * lowercasing here is unambiguous — no locale or Unicode case-folding
 * question ever arises.
 *
 * Implementation is a plain dynamic-programming table, the textbook
 * wildcard-matching algorithm restricted to `*` (no `?`). Its worst-case cost
 * is exactly `(pattern.length + 1) * (candidate.length + 1)` table cells —
 * provable from the code shape, not measured. With both inputs capped at 200
 * characters (enforced by the caller), the absolute worst case is 40,401
 * cells: trivial, and immune to the catastrophic-backtracking risk a regex
 * built from escaped-and-starred segments would carry for adversarial input.
 */

/** Collapses consecutive `*` characters — `"**"` and `"*"` are equivalent. */
export function normalizeWildcardPattern(pattern: string): string {
  return pattern.replace(/\*+/g, "*");
}

/** Number of DP cells this call will compute — the deterministic work bound, for tests that assert on operation count rather than wall-clock time. */
export function wildcardMatchCost(pattern: string, candidate: string): number {
  const normalized = normalizeWildcardPattern(pattern);
  return (normalized.length + 1) * (candidate.length + 1);
}

export function wildcardMatch(pattern: string, candidate: string): boolean {
  const p = normalizeWildcardPattern(pattern).toLowerCase();
  const c = candidate.toLowerCase();
  const P = p.length;
  const C = c.length;

  // dp[j] tracks row i of the full (P+1) x (C+1) table, rolled to one
  // dimension — same O(P*C) cell count, O(C) space.
  let dp = new Array<boolean>(C + 1).fill(false);
  dp[0] = true;

  for (let i = 1; i <= P; i++) {
    const next = new Array<boolean>(C + 1).fill(false);
    const isStar = p[i - 1] === "*";
    next[0] = isStar ? dp[0] : false;
    for (let j = 1; j <= C; j++) {
      next[j] = isStar ? next[j - 1] || dp[j] : dp[j - 1] && p[i - 1] === c[j - 1];
    }
    dp = next;
  }

  return dp[C];
}
