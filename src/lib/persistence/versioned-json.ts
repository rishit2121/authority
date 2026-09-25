import { RepositoryError } from "./errors";

/**
 * Reads a `{ schemaVersion, ... }` JSONB payload, rejecting anything whose
 * version isn't in the mapper's own known set.
 *
 * This is the application-side half of the mechanism described in
 * `supabase/JSONB_VERSIONING.md`: the database's `CHECK` constraint already
 * refuses to store a payload with a missing or unrecognized version, but a
 * mapper written before a new version existed must still refuse to *read*
 * one it doesn't know how to interpret, rather than guessing. Widening a
 * mapper to a new version is a deliberate code change — see the migration
 * guide in that document.
 */
export function readVersionedJson(
  payload: unknown,
  allowedVersions: readonly number[],
  context: string,
): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RepositoryError("invalid_row", `${context}: expected a JSON object, got ${typeof payload}.`);
  }

  const record = payload as Record<string, unknown>;
  const version = record.schemaVersion;

  if (typeof version !== "number" || !allowedVersions.includes(version)) {
    throw new RepositoryError(
      "invalid_row",
      `${context}: schemaVersion ${JSON.stringify(version)} is not one this mapper recognizes ` +
        `(known: ${allowedVersions.join(", ")}).`,
    );
  }

  return record;
}
