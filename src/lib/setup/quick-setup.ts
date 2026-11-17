/**
 * Small pure helpers shared by the Setup page (src/app/app/setup), its hand-off text (./handoff.ts) and the
 * Quickstart docs. Kept free of database and server-only imports so client components can render the same text
 * the server computed.
 */

export interface SetupEnv {
  AUTHORITY_URL: string;
  AUTHORITY_BACKEND_API_KEY: string;
  AUTHORITY_AGENT_ID: string;
  AUTHORITY_AGENT_RUNTIME_KEY: string;
}

export function envFileText(env: SetupEnv): string {
  return [
    `AUTHORITY_URL=${env.AUTHORITY_URL}`,
    `AUTHORITY_BACKEND_API_KEY=${env.AUTHORITY_BACKEND_API_KEY}`,
    `AUTHORITY_AGENT_ID=${env.AUTHORITY_AGENT_ID}`,
    `AUTHORITY_AGENT_RUNTIME_KEY=${env.AUTHORITY_AGENT_RUNTIME_KEY}`,
    "",
  ].join("\n");
}

export function installCommand(baseUrl: string): string {
  return `npm install ${baseUrl}/sdk/authority-sdk.tgz`;
}
