import { z } from "zod";

/**
 * Cursor-based pagination for list operations whose result can grow without
 * bound — tasks, decisions, tool requests and execution events all
 * accumulate with tenant activity, unlike (for example) tenant memberships
 * or policies, which stay small.
 *
 * This is deliberately additive to the repository interfaces: every
 * existing `listX(id): Promise<X[]>` method keeps its exact signature, so
 * every Part 1/2A caller, test and mock implementation is untouched. A
 * paginated sibling method (`listXPaged`) is added alongside it wherever the
 * table backing it is expected to grow. See `repositories.ts`.
 */

export interface PageOptions {
  /** Defaults are chosen by the repository implementation, not here. */
  limit?: number;
  /** Opaque — callers must treat this as a token, never parse it. */
  cursor?: string;
}

export interface PageResult<T> {
  items: T[];
  /** Null once there is nothing further to fetch. */
  nextCursor: string | null;
}

export const pageOptionsSchema = z
  .object({
    limit: z.number().int().positive().max(200).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();
