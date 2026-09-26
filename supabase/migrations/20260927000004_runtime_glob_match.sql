-- Part 4: a small, faithful SQL port of the glob matching
-- `evaluateToolRequest()` uses in TypeScript (src/lib/authorization/
-- evaluate.ts's private matchesGlob) — full-string, case-sensitive, `*`
-- meaning zero or more characters, every other character literal.
--
-- authorize_tool_call() must independently re-check forbidden resources and
-- resource constraints inside the same atomic transaction that reserves
-- budget, so it cannot simply call into TypeScript. This is a second,
-- independent implementation of the same rule, not a wrapper around the
-- other — the two are held to the same test cases (see
-- src/tests/unit/authorization/evaluate.test.ts and
-- supabase/tests/17_runtime_authorization.sql), exactly like
-- contract-runtime.ts's isContractCurrentlyActive() and
-- authz.contract_is_currently_active() already are for a different
-- invariant.
--
-- Implemented with plain, non-regex `replace()` calls rather than a
-- character class inside a POSIX regex: backslash is escaped first (so it
-- is never re-escaped by a later step), then every other regex-special
-- character is escaped individually, then `*` is expanded to `.*` — the
-- exact order `matchesGlob`'s own `.replace(/[.+^${}()|[\]\\]/g,
-- "\\$&").replace(/\*/g, ".*")` uses.
create or replace function authz.glob_match(p_pattern text, p_candidate text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_escaped text := coalesce(p_pattern, '');
  v_char text;
begin
  if p_candidate is null then
    return false;
  end if;

  v_escaped := replace(v_escaped, '\', '\\');
  foreach v_char in array array['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']'] loop
    v_escaped := replace(v_escaped, v_char, '\' || v_char);
  end loop;
  v_escaped := replace(v_escaped, '*', '.*');

  return p_candidate ~ ('^' || v_escaped || '$');
end;
$$;

revoke all on function authz.glob_match(text, text) from public, anon, authenticated;
