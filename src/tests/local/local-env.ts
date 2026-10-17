/**
 * Connection settings for the local-only suites, from `supabase status -o env`
 * (API_URL, ANON_KEY, DB_URL). Refuses anything that is not this machine, so
 * these tests can never run against the shared hosted project.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function local(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(`${name} is not set. Run \`supabase start\` and export \`supabase status -o env\`.`);
  const host = new URL(value).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`${name} points at ${host}; these tests only run against a local Supabase.`);
  }
  return value;
}

export function localSupabaseEnv(env: NodeJS.ProcessEnv = process.env) {
  const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY;
  if (!anonKey) throw new Error("ANON_KEY is not set (from `supabase status -o env`).");
  return {
    url: local("API_URL", env.API_URL),
    anonKey,
    dbUrl: local("DB_URL", env.DB_URL),
  };
}

export const FIXTURE_PASSWORD = "Authority-Dev-2026!";
export const OWNER_A = "owner.a@authority.test";
export const OWNER_B = "owner.b@authority.test";
export const VIEWER_A = "viewer.a@authority.test";
