-- Replaces 20261003000011's approach after it turned out to be the wrong
-- shape of fix. That migration added a hard `(tenant_id, user_id)`
-- uniqueness constraint on principals to make public.decide_contract_approval's
-- ambiguous self-identity lookup deterministic -- but at least five other
-- pgTAP suites (14, 17, 18, 20, 22) legitimately insert a second,
-- test-fixture principal row for a real seeded user within their own
-- rolled-back transaction, the same documented pattern 16's own module
-- comment describes ("the demo-installer's own fixture principals are
-- deliberately never linked to a real auth user ... so self-approval and
-- distinct-approver comparisons would silently compare NULL to NULL and
-- never trigger without these"). The constraint broke all of them outright,
-- and deleting the pre-existing row first (tried for 16/19) fails with a
-- foreign key violation whenever that row is already referenced by a real,
-- previously-committed task (`tasks.principal_id`) -- which, in this shared
-- dev database, admin.a's and dev.a's already are, from earlier real
-- browser-driven testing. A hard constraint is the wrong tool: this system
-- already has a working, documented answer to "can one person hold more
-- than one principal row," in decide_runtime_approval
-- (20260930000007_approval_distinct_people.sql, "Part 7: approver identity
-- is the signed-in USER: self-approval and distinct-approver rules consider
-- every principal row a user holds") -- it just never made it into
-- decide_contract_approval, decide_contract_approval's own older (Part 3B)
-- sibling, which is the actual bug this migration fixes.

drop index if exists public.principals_tenant_user_id_unique;

-- Reverts actor_principal's on-conflict form (which required the dropped
-- index as its arbiter) back to a narrower, constraint-free guard: an
-- advisory lock keyed on this exact (tenant, user) pair serializes two
-- concurrent first-uses without needing a table-level uniqueness guarantee.
create or replace function gateway.actor_principal(p_tenant_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_name text;
begin
  if not exists (select 1 from public.tenant_memberships m where m.tenant_id = p_tenant_id and m.user_id = p_user_id) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.actor_principal:' || p_tenant_id::text || ':' || p_user_id::text, 0));

  select p.id into v_id from public.principals p
  where p.tenant_id = p_tenant_id and p.user_id = p_user_id order by p.created_at, p.id limit 1;
  if v_id is not null then return v_id; end if;

  select coalesce(nullif(btrim(pr.display_name), ''), nullif(split_part(u.email, '@', 1), ''), 'Member')
    into v_name
  from auth.users u left join public.profiles pr on pr.user_id = u.id where u.id = p_user_id;

  insert into public.principals (tenant_id, kind, display_name, email, user_id)
  select p_tenant_id, 'human', left(coalesce(v_name, 'Member'), 200), u.email, p_user_id
  from auth.users u where u.id = p_user_id
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function gateway.actor_principal(uuid, uuid) from public;
grant execute on function gateway.actor_principal(uuid, uuid) to authority_gateway;

-- decide_contract_approval, brought in line with decide_runtime_approval's
-- already-correct design: every identity check below compares by the
-- signed-in USER (auth.uid(), joined through principals.user_id), not by a
-- single arbitrarily-resolved principal row -- so it no longer matters how
-- many principal rows this tenant member happens to hold, in a test fixture
-- or otherwise. `v_responder_principal_id` is still resolved once,
-- deterministically (oldest row wins, same tie-break decide_runtime_approval
-- itself uses), purely to decide which single row gets credited in
-- `approvals.responded_by_principal_id` -- never used for a security
-- decision here.
create or replace function public.decide_contract_approval(
  p_approval_id uuid,
  p_decision public.approval_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_contract_id uuid;
  v_required_kind public.approval_requirement_kind;
  v_required_role public.tenant_role;
  v_self_approval_allowed boolean;
  v_requested_from_principal_id uuid;
  v_status public.approval_status;
  v_submitted_by_principal_id uuid;
  v_submitted_by_user_id uuid;
  v_responder_principal_id uuid;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'decide_contract_approval() requires an authenticated caller' using errcode = '28000';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;

  select a.tenant_id, a.contract_id, a.required_kind, a.required_role, a.self_approval_allowed,
         a.requested_from_principal_id, a.status
    into v_tenant_id, v_contract_id, v_required_kind, v_required_role, v_self_approval_allowed,
         v_requested_from_principal_id, v_status
  from public.approvals a
  where a.id = p_approval_id and a.contract_id is not null;

  if v_tenant_id is null then
    raise exception 'contract approval not found' using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'this approval has already been decided' using errcode = '23514';
  end if;

  -- Resolved once, deterministically, purely to decide which single row is
  -- credited as the responder below -- every actual security check in this
  -- function compares by user_id instead (see module comment above).
  select id into v_responder_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid())
  order by created_at, id limit 1;

  if v_required_kind = 'task_owner' then
    -- Any principal this USER holds counts, not just whichever one the
    -- (now-deterministic, but still arbitrary) lookup above happened to pick.
    if not exists (
      select 1 from public.principals mine
      where mine.tenant_id = v_tenant_id and mine.user_id = (select auth.uid())
        and mine.id = v_requested_from_principal_id
    ) then
      raise exception 'only the task''s own owner may satisfy this approval' using errcode = '42501';
    end if;
  else
    if not authz.has_min_role(v_tenant_id, v_required_role) then
      raise exception 'insufficient privileges to decide this approval' using errcode = '42501';
    end if;
  end if;

  select submitted_by_principal_id into v_submitted_by_principal_id
  from public.task_authority_contracts where id = v_contract_id;

  -- Compare the submitter's and responder's real identities (user_id), not
  -- their principal row ids -- a second principal row for the same human
  -- must not be usable to approve one's own submission.
  select user_id into v_submitted_by_user_id from public.principals where id = v_submitted_by_principal_id;

  if not v_self_approval_allowed and v_submitted_by_user_id is not null
     and v_submitted_by_user_id = (select auth.uid()) then
    raise exception 'the principal who submitted this contract may not satisfy this approval' using errcode = '42501';
  end if;

  -- Distinct-approver enforcement for a requirement needing more than one
  -- slot: the same HUMAN cannot fill two slots of the same tier alone, even
  -- via two different principal rows. Only checked for an "approved"
  -- decision — a rejection already blocks the whole tier via
  -- activate_task_contract()'s "every slot must be approved" check,
  -- regardless of who made it.
  if p_decision = 'approved' and exists (
    select 1 from public.approvals a2
    join public.principals rp on rp.id = a2.responded_by_principal_id and rp.tenant_id = a2.tenant_id
    where a2.contract_id = v_contract_id
      and a2.required_kind = v_required_kind
      and a2.required_role is not distinct from v_required_role
      and a2.id <> p_approval_id
      and a2.status = 'approved'
      and rp.user_id = (select auth.uid())
  ) then
    raise exception 'this principal already approved another slot of this same requirement; a distinct principal is needed for each required approval'
      using errcode = '42501';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'a rejection reason is required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 2000 then
    raise exception 'reason exceeds maximum length' using errcode = '22023';
  end if;

  update public.approvals
  set status = p_decision, decided_at = now(), responded_by_principal_id = v_responder_principal_id,
      decision_reason = v_reason
  where id = p_approval_id and status = 'pending';

  if not found then
    raise exception 'this approval has already been decided' using errcode = '23514';
  end if;
end;
$fn$;
revoke all on function public.decide_contract_approval(uuid, public.approval_status, text) from public, anon;
grant execute on function public.decide_contract_approval(uuid, public.approval_status, text) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000012'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
