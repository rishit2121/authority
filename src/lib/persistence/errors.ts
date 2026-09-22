/**
 * Typed repository errors.
 *
 * Every Supabase-backed repository throws one of these rather than letting a
 * raw `PostgrestError` — or any other provider-shaped error — reach a caller.
 * Provider error text can name internal tables, columns and constraints; none
 * of that belongs in a UI, and callers that want to branch on failure should
 * branch on `code`, a small closed set, not on message text.
 */

export type RepositoryErrorCode =
  /** The tenant a caller asked for isn't the one this repository is bound to. */
  | "tenant_mismatch"
  /** A row was read from the database but failed domain-schema validation. */
  | "invalid_row"
  /** The database rejected the operation outright (RLS, constraint, etc). */
  | "database_error"
  /** A record that must exist for the operation to make sense was missing. */
  | "not_found";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepositoryError";
    this.code = code;
  }
}

/** Shape of the subset of a Postgrest/Supabase error this module ever reads. */
interface ProviderErrorLike {
  code?: string;
  message?: string;
}

/**
 * Logs a provider failure safely and throws the typed error callers should
 * handle instead.
 *
 * The provider's own `message` is logged, not the row values or query — this
 * runs entirely on the server, so a log line naming which operation failed on
 * which table is an operational detail, not user-facing text.
 */
export function throwDatabaseError(
  operation: string,
  error: ProviderErrorLike | null | undefined,
): never {
  console.error(`repository: ${operation} failed (code=${error?.code ?? "unknown"})`);
  throw new RepositoryError("database_error", `Could not complete: ${operation}.`, { cause: error });
}

/** Wraps a Zod validation failure encountered while mapping a database row. */
export function throwInvalidRow(entity: string, rowId: unknown, cause: unknown): never {
  console.error(`repository: ${entity} row ${String(rowId)} failed domain validation`);
  throw new RepositoryError(
    "invalid_row",
    `A ${entity} record could not be validated against its domain schema.`,
    { cause },
  );
}
