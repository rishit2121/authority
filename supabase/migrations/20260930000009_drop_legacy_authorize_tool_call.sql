-- Part 7: remove the Part 4 owner-only runtime authorization function.
--
-- Since Part 6 no client role could execute it; only the table owner could, and only the
-- legacy regression suites did. The application path is gateway.commit_authorization().
-- Dropping it removes a raw-argument-taking, budget-reserving entry point that bypasses
-- semantic composition and capability issuance. Historical rows it wrote are untouched
-- (append-only tables are not modified). Suites 17/18 keep pinning the deterministic
-- semantics through a test-only shim over the gateway functions (scripts/db-test.mjs).
--
-- The Part 5 shadow-evidence helpers (get_semantic_evaluation_context, record_semantic_shadow,
-- record_agent_auth_failure) remain: they are revoked from every client role, cannot decide or
-- reserve anything, and suite 18 still exercises the historical shadow-evidence tables.

drop function if exists public.authorize_tool_call(
  text, uuid, text, text, text, jsonb, uuid, text, jsonb, text, text
);
