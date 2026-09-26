-- Part 6: the trusted-gateway trust boundary.
--
-- Until now authorize_tool_call() and the Part 5 semantic RPCs were granted to
-- `anon`, so anyone holding the public publishable key and a valid agent key
-- could call them directly, skip any check made in the Next.js server, and
-- record "semantic evidence" the database had no way to attribute. Part 6
-- closes that by moving the whole runtime pipeline behind a role that only the
-- Authority server holds:
--
--   * A dedicated LOGIN role, `authority_gateway`, created here NOLOGIN. Its
--     password is set out-of-band (scripts/provision-gateway-role.mjs), never
--     in a migration or in git. It owns nothing, holds no table privileges, and
--     can execute only functions in the `gateway` schema.
--   * The `gateway` schema is not exposed by PostgREST, and neither `anon` nor
--     `authenticated` has USAGE on it, so the anonymous key cannot even name
--     these functions.
--   * The legacy public.* runtime RPCs lose every grant except the owner's.
--
-- This is deliberately not the service-role key: service_role bypasses RLS and
-- can read and write every table, so a leak of it is a total compromise. A leak
-- of the gateway credential lets an attacker call the gateway functions —
-- which still authenticate every agent key — and nothing else.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authority_gateway') then
    create role authority_gateway nologin noinherit nobypassrls;
  end if;
end;
$$;

-- Bounded blast radius for the credential whichever way it is used.
alter role authority_gateway set statement_timeout = '15s';
alter role authority_gateway set idle_in_transaction_session_timeout = '15s';
alter role authority_gateway connection limit 40;

create schema if not exists gateway;
revoke all on schema gateway from public, anon, authenticated;
grant usage on schema gateway to authority_gateway;

-- Functions default to EXECUTE for PUBLIC in Postgres; make new gateway
-- functions closed by default so a forgotten REVOKE cannot open one.
alter default privileges in schema gateway revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Close the direct-RPC bypass: the Part 4 / Part 5 runtime functions are no
-- longer callable by anon, authenticated, service_role or PUBLIC. They remain
-- only for the table owner (used by the pgTAP regression suites) and are not
-- reachable from the application.
-- ---------------------------------------------------------------------------
revoke all on function public.authorize_tool_call(
  text, uuid, text, text, text, jsonb, uuid, text, jsonb, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.get_semantic_evaluation_context(text, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.record_semantic_shadow(
  text, uuid, text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level,
  double precision, integer, text, jsonb, text
) from public, anon, authenticated, service_role;

revoke all on function public.record_agent_auth_failure(text) from public, anon, authenticated, service_role;

revoke execute on function authz.contract_is_currently_active(public.contract_status, timestamptz) from anon;

-- ---------------------------------------------------------------------------
-- Monotonicity primitive. Ranks how *permissive* an outcome is; the
-- final-decision table CHECKs that a composed outcome never outranks the
-- deterministic one, so "semantic can only narrow" is a storage-layer fact.
-- ---------------------------------------------------------------------------
create or replace function gateway.outcome_rank(p_outcome public.authorization_outcome)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_outcome
    when 'allow' then 5
    when 'allow_constrained' then 4
    when 'require_approval' then 3
    when 'clarify' then 2
    when 'replan' then 1
    when 'deny' then 0
  end;
$$;
revoke all on function gateway.outcome_rank(public.authorization_outcome) from public;
-- CHECK constraints run in the inserting role's context; grant to everyone who
-- can insert (only definer functions do) is unnecessary, but keep it callable.
grant execute on function gateway.outcome_rank(public.authorization_outcome) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Argument privacy: new requests never persist raw arguments. The request
-- hash (already present) identifies the call; argument_audit holds only an
-- explicitly redacted representation. Existing rows are left untouched.
-- ---------------------------------------------------------------------------
alter table public.tool_requests
  add column argument_audit jsonb,
  add column arguments_redacted boolean not null default false,
  add column arguments_hash text check (arguments_hash is null or arguments_hash ~ '^[0-9a-f]{64}$');

alter table public.tool_requests
  add constraint tool_requests_audit_bounded
    check (argument_audit is null or pg_column_size(argument_audit) <= 8192),
  -- A redacted row must actually have had its raw values withheld.
  add constraint tool_requests_redacted_has_no_values
    check (not arguments_redacted or (normalized_arguments -> 'values') = '{}'::jsonb);

comment on column public.tool_requests.argument_audit is
  'Explicitly redacted audit representation of the request arguments '
  '(keys, types, lengths, short hashes, and values only for a small '
  'allow-list of identifier-like keys). Raw arguments are never stored for '
  'rows with arguments_redacted = true.';
