/**
 * Presentation helpers for authenticated identity.
 *
 * Kept separate from identity.ts so they carry no server-only imports and can
 * be tested directly.
 */

/**
 * Initials for the avatar chip, never more than two characters.
 *
 * Falls back to the email when there is no display name, because an avatar
 * showing nothing reads as a broken component rather than a missing name.
 */
export function initialsFor(displayName: string, email: string): string {
  const source = displayName.trim() || email.trim();
  const words = source.split(/\s+/).filter(Boolean);

  if (words.length === 0) return "?";

  if (words.length === 1) {
    const single = words[0];
    // An email local part is more recognizable by its first letters than by
    // its first and last.
    return single.slice(0, 2).toUpperCase();
  }

  const first = words[0][0];
  const last = words[words.length - 1][0];

  return `${first}${last}`.toUpperCase();
}
