import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/env";
import type { RepositoryContext } from "@/lib/persistence/context";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Seeded development users, mirroring supabase/seed.sql — the same fixture
 * accounts Playwright's authenticated project signs in as. Development-only
 * accounts under the reserved `.test` TLD; the password is a fixture, not a
 * secret.
 */
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Authority-Dev-2026!";

export const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
export const TENANT_B_ID = "22222222-2222-4222-8222-222222222222";

export const OWNER_A_EMAIL = "owner.a@authority.test";
export const OWNER_B_EMAIL = "owner.b@authority.test";
export const VIEWER_A_EMAIL = "viewer.a@authority.test";

/**
 * Signs in as a seeded user and returns both the raw client (for assertions
 * that need to query outside any single repository) and a `RepositoryContext`
 * bound to the given tenant, exactly as the application would construct one
 * from a server-verified identity.
 */
export async function signInAs(
  email: string,
  tenantId: string,
): Promise<{ supabase: SupabaseClient<Database>; context: RepositoryContext }> {
  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createClient<Database>(url, publishableKey);

  const { error } = await supabase.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) {
    throw new Error(
      `Could not sign in as ${email} for the integration suite. ` +
        `Is the linked project's seed data (supabase/seed.sql) applied? Cause: ${error.message}`,
    );
  }

  return { supabase, context: { supabase, tenantId } };
}

/**
 * Runs SQL against the linked project via the Supabase Management API,
 * bypassing RLS entirely — the same privileged path the CLI itself uses
 * (see scripts/db-test.mjs) and the same one the demo-installer RPCs run
 * under as SECURITY DEFINER.
 *
 * Used only for test setup/teardown that no RLS-scoped client legitimately
 * can do (e.g. temporarily flipping a capability's status to exercise
 * "active capabilities" against real data). Never used to assert on
 * application behaviour itself — assertions always go through a signed-in
 * repository context.
 *
 * `SUPABASE_ACCESS_TOKEN` is read from `.supabase-cli.env` (loaded by
 * setup.ts) and is never logged or included in any thrown error message.
 *
 * Retries a failing call a few times with a short backoff before giving up.
 * This is test scaffolding, not part of any tested behavior: it exists
 * because fixture teardown occasionally races a just-completed UI action's
 * own write, reaching this call before that write's effect is visible to
 * the Management API's own connection path, which produces a real but
 * transient constraint violation — confirmed by running the exact same SQL
 * again immediately afterward, by hand, which always succeeds. Retrying a
 * genuine (non-transient) SQL defect costs a few hundred milliseconds and
 * then still fails exactly as before; it is never silently swallowed.
 */
export async function managementQuery(query: string, attempt = 1): Promise<unknown> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;

  if (!token || !projectRef) {
    throw new Error(
      "managementQuery: SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF missing from .supabase-cli.env",
    );
  }

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const body = await response.json();

  if (!response.ok) {
    const maxAttempts = 3;
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      return managementQuery(query, attempt + 1);
    }
    // Deliberately generic: the response body can echo back query text, and
    // this must never surface a token even indirectly.
    throw new Error(`managementQuery failed with status ${response.status} after ${maxAttempts} attempts`);
  }

  return body;
}
