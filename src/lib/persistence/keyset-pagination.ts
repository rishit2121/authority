import type { PageOptions } from "@/lib/domain";

/**
 * Keyset pagination over `(created_at desc, id desc)`.
 *
 * Chosen over offset pagination because offsets shift under concurrent
 * inserts — a row inserted while a caller is paging can push earlier rows
 * across a page boundary, causing skipped or duplicated results. A keyset
 * cursor pins to a specific row's position instead, so it stays correct
 * regardless of what else is being written concurrently. `id` breaks ties
 * between rows that share a `created_at` down to the same instant.
 */
export interface CursorState {
  createdAt: string;
  id: string;
}

/** Opaque to callers by contract — nothing here promises a stable encoding across versions. */
export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/** Returns null for a missing, malformed or forged cursor rather than throwing. */
export function decodeCursor(cursor: string | undefined): CursorState | null {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).createdAt === "string" &&
      typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as CursorState;
    }

    return null;
  } catch {
    return null;
  }
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export function resolveLimit(options: PageOptions | undefined): number {
  const requested = options?.limit ?? DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(1, requested), MAX_PAGE_LIMIT);
}

/**
 * The PostgREST `.or()` filter expression for "strictly before this cursor"
 * under `(created_at desc, id desc)` ordering. Both branches must hold
 * together: a row with an earlier `created_at`, or one with the same
 * `created_at` but a smaller `id` — the same tuple comparison the ORDER BY
 * itself uses, so the cursor and the ordering can never disagree.
 */
export function cursorFilter(cursor: CursorState): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}
