/** Fixed egress and safety limits for the GitHub connector. Nothing here is tenant- or agent-configurable. */

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const GITHUB_WEB_ORIGIN = "https://github.com";
export const GITHUB_API_VERSION = "2022-11-28";

/**
 * The complete least-privilege permission set the Authority GitHub App
 * requests. Anything else on an installation (administration, secrets,
 * workflows, actions, organization permissions, ...) is drift and disables the
 * installation until the owner removes it.
 */
export const EXPECTED_PERMISSIONS: Readonly<Record<string, "read" | "write">> = Object.freeze({
  contents: "write",
  issues: "read",
  metadata: "read",
  pull_requests: "write",
});

/** Webhook events the App subscribes to. `installation*` events are delivered to every App by default. */
export const EXPECTED_EVENTS: readonly string[] = Object.freeze([]);

export const REQUEST_TIMEOUT_MS = 8_000;
/** Whole-operation deadline; must be well under LEASE_SECONDS. */
export const OPERATION_DEADLINE_MS = 25_000;
export const LEASE_SECONDS = 45;
export const MAX_RESPONSE_BYTES = 1_048_576;
/** Largest file the connector will return to an agent. */
export const MAX_FILE_RETURN_BYTES = 262_144;
export const MAX_COMMIT_MESSAGE_CHARS = 200;
export const MAX_PR_TITLE_CHARS = 200;
export const MAX_PR_BODY_CHARS = 4_000;
