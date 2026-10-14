import "server-only";

/**
 * Whether the sample-data installer and "Reset demo data" are offered at
 * all. Off unless explicitly enabled: on a real deployment these buttons
 * would let a user populate (or wipe) their own workspace with fictional
 * records, which only makes sense on a demo or test server.
 */
export function demoDataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTHORITY_ENABLE_DEMO_DATA === "1";
}
