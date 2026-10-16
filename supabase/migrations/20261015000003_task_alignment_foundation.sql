-- Task alignment, increment 1: task objectives, plan/value review records, and
-- inspection of external content an application routes through Authority.
--
-- Grounded in Task Shield (Jia et al., ACL 2025): user objectives form a task
-- set; every other instruction is scored for its contribution to that set.
-- The model calls happen in application code (src/lib/alignment); this
-- migration only stores their results, binds them to exact subjects and
-- versions, and gates contract activation on them when an application turns
-- enforcement on.
--
-- Everything is additive and OFF by default: an application with no
-- alignment_settings row behaves exactly as before.

-- ---------------------------------------------------------------------------
-- 1. Per-application rollout switch.
-- ---------------------------------------------------------------------------
create table public.alignment_settings (
  application_id uuid primary key references public.applications (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- off: nothing runs. shadow: reviews run and are recorded, outcomes never change.
  -- enforce: misaligned/ambiguous/unreviewed results hold or stop work.
  mode text not null default 'off' check (mode in ('off', 'shadow', 'enforce')),
  -- reference: Task Shield as published (zero-contribution rule, original output plus feedback).
  -- production: reference scores plus value checks, quarantine and review holds.
  policy text not null default 'production' check (policy in ('reference', 'production')),
  max_content_bytes integer not null default 32768 check (max_content_bytes between 1024 and 131072),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Task-scoped alignment state and versioned objectives.
-- ---------------------------------------------------------------------------
create table public.task_alignment_state (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  objective_version integer not null default 0 check (objective_version >= 0),
  -- Bumped for every inspected piece of external content: evidence bound to an
  -- older revision is stale once new content entered the task's context.
  context_revision integer not null default 0 check (context_revision >= 0),
  updated_at timestamptz not null default now()
);

create table public.task_objectives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  version integer not null check (version > 0),
  -- Only the task's own request or an authenticated application update; never agent output or content.
  source text not null check (source in ('original_request', 'application_update')),
  request_text text not null check (char_length(request_text) between 1 and 8000),
  -- {"schemaVersion":1,"taskInstructions":[...],"prohibitions":[...],"requirements":[...],"quotedMaterial":[...]}
  extraction jsonb not null check (pg_column_size(extraction) <= 32768),
  status text not null check (status in ('extracted', 'unreviewed')),
  reviewer jsonb not null default '{}'::jsonb check (pg_column_size(reviewer) <= 2048),
  created_at timestamptz not null default now(),
  unique (task_id, version)
);
create index task_objectives_task_idx on public.task_objectives (task_id, version desc);

-- ---------------------------------------------------------------------------
-- 3. Review records (plan now; content and action reviews share the table).
-- ---------------------------------------------------------------------------
create table public.alignment_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  kind text not null check (kind in ('plan', 'content', 'action')),
  mode text not null check (mode in ('shadow', 'enforce')),
  policy text not null check (policy in ('reference', 'production')),
  -- sha256 of the exact subject: the compiled plan's input hash, the content, or the request.
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  objective_version integer not null check (objective_version > 0),
  context_revision integer not null check (context_revision >= 0),
  contract_id uuid,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) <= 200),
  outcome text not null check (outcome in ('aligned', 'misaligned', 'ambiguous', 'unreviewed')),
  findings jsonb not null default '[]'::jsonb check (pg_column_size(findings) <= 16384),
  scores jsonb not null default '[]'::jsonb check (pg_column_size(scores) <= 16384),
  feedback text check (feedback is null or char_length(feedback) <= 4000),
  reviewer jsonb not null default '{}'::jsonb check (pg_column_size(reviewer) <= 2048),
  usage jsonb not null default '{}'::jsonb check (pg_column_size(usage) <= 1024),
  decision text check (decision in ('approved', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  check ((decision is null) = (decided_at is null))
);
create index alignment_reviews_lookup_idx on public.alignment_reviews (task_id, kind, subject_hash, objective_version);
create index alignment_reviews_contract_idx on public.alignment_reviews (contract_id) where contract_id is not null;
create index alignment_reviews_tenant_idx on public.alignment_reviews (tenant_id, created_at desc);

create table public.external_content_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  review_id uuid references public.alignment_reviews (id) on delete set null,
  origin text not null check (origin in ('api', 'connector')),
  -- Descriptive only: what the caller says the content is. Never proof of trust.
  source_kind text not null check (source_kind in ('web', 'document', 'email', 'slack', 'database', 'api', 'memory', 'tool_result', 'other')),
  source_label text check (source_label is null or char_length(source_label) <= 200),
  source_uri text check (source_uri is null or char_length(source_uri) <= 500),
  content_type text not null check (content_type in ('text/plain', 'text/markdown', 'application/json')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size >= 0),
  status text not null check (status in ('passed', 'flagged', 'quarantined', 'held', 'unreviewed')),
  context_revision integer not null check (context_revision > 0),
  receipt_id uuid,
  -- Held/quarantined content only, encrypted in Supabase Vault, purged after retained_until.
  vault_secret_id uuid,
  retained_until timestamptz,
  last_revealed_by uuid references auth.users (id) on delete set null,
  last_revealed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((vault_secret_id is null) = (retained_until is null))
);
create index external_content_items_task_idx on public.external_content_items (task_id, created_at desc);
create index external_content_items_retention_idx on public.external_content_items (retained_until) where vault_secret_id is not null;

-- Members can read records (no raw content lives in these tables); every write goes through the functions below.
do $$
declare t text;
begin
  foreach t in array array['alignment_settings', 'task_alignment_state', 'task_objectives', 'alignment_reviews', 'external_content_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (authz.is_member_of(tenant_id))', t || '_select_within_tenant', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Credential -> task access for every alignment call.
-- ---------------------------------------------------------------------------
-- A backend key reaches its own application's tasks; a task session reaches only
-- its own task; a raw runtime key reaches its agent's tasks (reported as
-- 'runtime_key' so callers can require a session).
create or replace function gateway.alignment_auth(p_secret text, p_task_id uuid)
returns table (aa_status text, aa_tenant_id uuid, aa_application_id uuid, aa_credential_kind text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid; v_agent uuid; v_cred uuid;
  v_task_tenant uuid; v_task_agent uuid; v_task_app uuid; v_session_task uuid;
begin
  select t.tenant_id, t.agent_id, c.application_id into v_task_tenant, v_task_agent, v_task_app
  from public.tasks t left join public.customers c on c.id = t.customer_id
  where t.id = p_task_id;

  if left(coalesce(p_secret, ''), 13) = 'authority_dk_' then
    select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
    from gateway.resolve_backend_credential(p_secret);
    if v_status <> 'ok' then return query select v_status, null::uuid, null::uuid, null::text; return; end if;
    if v_task_tenant is null or v_task_tenant <> v_tenant or v_task_app is distinct from v_app then
      return query select 'task_not_found'::text, null::uuid, null::uuid, null::text; return;
    end if;
    return query select 'ok'::text, v_tenant, v_app, 'backend'::text; return;
  end if;

  select rc_status, rc_tenant_id, rc_agent_id, rc_credential_id into v_status, v_tenant, v_agent, v_cred
  from gateway.resolve_credential(p_secret);
  if v_status <> 'ok' then return query select v_status, null::uuid, null::uuid, null::text; return; end if;
  if v_task_tenant is null or v_task_tenant <> v_tenant then
    return query select 'task_not_found'::text, null::uuid, null::uuid, null::text; return;
  end if;
  if left(p_secret, 13) = 'authority_ts_' then
    select ts.task_id into v_session_task from public.task_sessions ts
    where ts.token_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
    if v_session_task is distinct from p_task_id then
      return query select 'session_task_mismatch'::text, null::uuid, null::uuid, null::text; return;
    end if;
  end if;
  if v_task_agent is distinct from v_agent then
    return query select 'agent_mismatch'::text, null::uuid, null::uuid, null::text; return;
  end if;
  return query select 'ok'::text, v_tenant, v_task_app,
    case when left(p_secret, 13) = 'authority_ts_' then 'session' else 'runtime_key' end;
end;
$fn$;
revoke all on function gateway.alignment_auth(text, uuid) from public;
grant execute on function gateway.alignment_auth(text, uuid) to authority_gateway;

-- Everything a reviewer needs, read in one call: settings, versions, the latest
-- objectives and the active contract. No model output is trusted from the caller.
create or replace function gateway.alignment_context(p_secret text, p_task_id uuid)
returns table (
  ac_status text, ac_credential_kind text, ac_tenant_id uuid, ac_application_id uuid,
  ac_mode text, ac_policy text, ac_max_content_bytes integer,
  ac_objective_version integer, ac_context_revision integer,
  ac_task_intent text, ac_objective_request text, ac_objective_extraction jsonb, ac_objective_status text,
  ac_contract_id uuid, ac_allowed_actions jsonb
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid; v_kind text;
  v_mode text := 'off'; v_policy text := 'production'; v_max integer := 32768;
  v_obj_version integer := 0; v_ctx integer := 0;
  v_intent text; v_req text; v_ext jsonb; v_obj_status text;
  v_contract uuid; v_actions jsonb;
begin
  select aa_status, aa_tenant_id, aa_application_id, aa_credential_kind into v_status, v_tenant, v_app, v_kind
  from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then
    return query select v_status, null::text, null::uuid, null::uuid, null::text, null::text, null::integer,
      null::integer, null::integer, null::text, null::text, null::jsonb, null::text, null::uuid, null::jsonb;
    return;
  end if;

  if v_app is not null then
    select s.mode, s.policy, s.max_content_bytes into v_mode, v_policy, v_max
    from public.alignment_settings s where s.application_id = v_app;
    v_mode := coalesce(v_mode, 'off'); v_policy := coalesce(v_policy, 'production'); v_max := coalesce(v_max, 32768);
  end if;

  select t.intent into v_intent from public.tasks t where t.id = p_task_id;
  select st.objective_version, st.context_revision into v_obj_version, v_ctx
  from public.task_alignment_state st where st.task_id = p_task_id;
  v_obj_version := coalesce(v_obj_version, 0); v_ctx := coalesce(v_ctx, 0);
  if v_obj_version > 0 then
    select o.request_text, o.extraction, o.status into v_req, v_ext, v_obj_status
    from public.task_objectives o where o.task_id = p_task_id and o.version = v_obj_version;
  end if;

  select tac.id, tac.allowed_actions into v_contract, v_actions
  from public.task_authority_contracts tac
  where tac.task_id = p_task_id and authz.contract_is_currently_active(tac.contract_status, tac.expires_at)
  limit 1;

  return query select 'ok'::text, v_kind, v_tenant, v_app, v_mode, v_policy, v_max, v_obj_version, v_ctx,
    v_intent, v_req, v_ext, v_obj_status, v_contract, v_actions;
end;
$fn$;
revoke all on function gateway.alignment_context(text, uuid) from public;
grant execute on function gateway.alignment_context(text, uuid) to authority_gateway;

create or replace function gateway.ensure_task_alignment_state(p_task_id uuid, p_tenant uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_alignment_state (task_id, tenant_id) values (p_task_id, p_tenant)
  on conflict (task_id) do nothing;
$$;
revoke all on function gateway.ensure_task_alignment_state(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 5. Recording objectives. Version N+1 only on top of version N (optimistic).
-- ---------------------------------------------------------------------------
create or replace function gateway.record_task_objectives(
  p_secret text, p_task_id uuid, p_source text, p_request_text text, p_extraction jsonb,
  p_status text, p_reviewer jsonb, p_expected_version integer
)
returns table (rto_status text, rto_version integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_kind text; v_current integer; v_intent text;
begin
  select aa_status, aa_tenant_id, aa_credential_kind into v_status, v_tenant, v_kind
  from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then return query select v_status, null::integer; return; end if;

  if p_source not in ('original_request', 'application_update') or p_status not in ('extracted', 'unreviewed') then
    return query select 'invalid_request'::text, null::integer; return;
  end if;
  -- Agents and content can never revise what the user asked for.
  if p_source = 'application_update' and v_kind <> 'backend' then
    return query select 'forbidden'::text, null::integer; return;
  end if;
  if p_request_text is null or char_length(p_request_text) not between 1 and 8000
     or p_extraction is null or jsonb_typeof(p_extraction) <> 'object' then
    return query select 'invalid_request'::text, null::integer; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.alignment:' || p_task_id::text, 0));
  perform gateway.ensure_task_alignment_state(p_task_id, v_tenant);
  select objective_version into v_current from public.task_alignment_state where task_id = p_task_id;

  if v_current <> coalesce(p_expected_version, -1) then
    return query select 'stale'::text, v_current; return;
  end if;
  if p_source = 'original_request' then
    select intent into v_intent from public.tasks where id = p_task_id;
    -- The original request is the task's stored intent, and only ever version 1.
    if v_current <> 0 or p_request_text is distinct from v_intent then
      return query select 'stale'::text, v_current; return;
    end if;
  end if;

  insert into public.task_objectives (tenant_id, task_id, version, source, request_text, extraction, status, reviewer)
  values (v_tenant, p_task_id, v_current + 1, p_source, p_request_text, p_extraction, p_status, coalesce(p_reviewer, '{}'::jsonb));
  update public.task_alignment_state set objective_version = v_current + 1, updated_at = now() where task_id = p_task_id;
  return query select 'ok'::text, v_current + 1;
end;
$fn$;
revoke all on function gateway.record_task_objectives(text, uuid, text, text, jsonb, text, jsonb, integer) from public;
grant execute on function gateway.record_task_objectives(text, uuid, text, text, jsonb, text, jsonb, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 6. Recording and finding reviews.
-- ---------------------------------------------------------------------------
create or replace function gateway.record_alignment_review(
  p_secret text, p_task_id uuid, p_kind text, p_mode text, p_policy text, p_subject_hash text,
  p_objective_version integer, p_context_revision integer, p_contract_id uuid, p_idempotency_key text,
  p_outcome text, p_findings jsonb, p_scores jsonb, p_feedback text, p_reviewer jsonb, p_usage jsonb
)
returns table (rar_status text, rar_review_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_obj integer; v_ctx integer; v_id uuid;
begin
  select aa_status, aa_tenant_id into v_status, v_tenant from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then return query select v_status, null::uuid; return; end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.alignment:' || p_task_id::text, 0));
  perform gateway.ensure_task_alignment_state(p_task_id, v_tenant);
  select objective_version, context_revision into v_obj, v_ctx from public.task_alignment_state where task_id = p_task_id;
  -- Evidence about superseded objectives or an older context is never recorded as current.
  if p_objective_version is distinct from v_obj or p_context_revision is distinct from v_ctx then
    return query select 'stale'::text, null::uuid; return;
  end if;
  if p_contract_id is not null and not exists (
    select 1 from public.task_authority_contracts where id = p_contract_id and task_id = p_task_id
  ) then
    return query select 'invalid_request'::text, null::uuid; return;
  end if;

  insert into public.alignment_reviews (
    tenant_id, task_id, kind, mode, policy, subject_hash, objective_version, context_revision,
    contract_id, idempotency_key, outcome, findings, scores, feedback, reviewer, usage
  ) values (
    v_tenant, p_task_id, p_kind, p_mode, p_policy, p_subject_hash, p_objective_version, p_context_revision,
    p_contract_id, p_idempotency_key, p_outcome, coalesce(p_findings, '[]'::jsonb), coalesce(p_scores, '[]'::jsonb),
    p_feedback, coalesce(p_reviewer, '{}'::jsonb), coalesce(p_usage, '{}'::jsonb)
  ) returning id into v_id;
  return query select 'ok'::text, v_id;
end;
$fn$;
revoke all on function gateway.record_alignment_review(text, uuid, text, text, text, text, integer, integer, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb) from public;
grant execute on function gateway.record_alignment_review(text, uuid, text, text, text, text, integer, integer, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb) to authority_gateway;

-- The newest review of exactly this subject under exactly these versions, so a
-- retry reuses its result instead of asking the model again.
create or replace function gateway.find_alignment_review(
  p_secret text, p_task_id uuid, p_kind text, p_subject_hash text, p_objective_version integer, p_context_revision integer
)
returns table (
  far_status text, far_review_id uuid, far_outcome text, far_decision text, far_findings jsonb,
  far_scores jsonb, far_feedback text, far_policy text, far_mode text, far_contract_id uuid
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  select aa_status into v_status from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::text, null::jsonb, null::jsonb, null::text, null::text, null::text, null::uuid;
    return;
  end if;
  return query
    select 'ok'::text, r.id, r.outcome, r.decision, r.findings, r.scores, r.feedback, r.policy, r.mode, r.contract_id
    from public.alignment_reviews r
    where r.task_id = p_task_id and r.kind = p_kind and r.subject_hash = p_subject_hash
      and r.objective_version = p_objective_version
      and (p_context_revision is null or r.context_revision = p_context_revision)
    order by r.created_at desc
    limit 1;
end;
$fn$;
revoke all on function gateway.find_alignment_review(text, uuid, text, text, integer, integer) from public;
grant execute on function gateway.find_alignment_review(text, uuid, text, text, integer, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 7. External content.
-- ---------------------------------------------------------------------------
create or replace function gateway.purge_expired_alignment_content(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare r record; n integer := 0;
begin
  for r in
    select id, vault_secret_id from public.external_content_items
    where vault_secret_id is not null and retained_until < now()
    order by retained_until limit greatest(1, least(p_limit, 500))
    for update skip locked
  loop
    -- Overwrite rather than delete: update_secret is the vault API this schema already relies on.
    perform vault.update_secret(r.vault_secret_id, '');
    update public.external_content_items set vault_secret_id = null, retained_until = null where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
revoke all on function gateway.purge_expired_alignment_content(integer) from public;
grant execute on function gateway.purge_expired_alignment_content(integer) to authority_gateway;

create or replace function gateway.record_external_content(
  p_secret text, p_task_id uuid, p_review_id uuid, p_origin text, p_source_kind text, p_source_label text,
  p_source_uri text, p_content_type text, p_content_hash text, p_byte_size integer, p_status text,
  p_receipt_id uuid, p_retain_content text, p_retention_seconds integer
)
returns table (rec_status text, rec_item_id uuid, rec_context_revision integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_ctx integer; v_id uuid; v_vault uuid; v_until timestamptz;
begin
  select aa_status, aa_tenant_id into v_status, v_tenant from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then return query select v_status, null::uuid, null::integer; return; end if;
  if p_review_id is not null and not exists (
    select 1 from public.alignment_reviews where id = p_review_id and task_id = p_task_id and kind = 'content'
  ) then
    return query select 'invalid_request'::text, null::uuid, null::integer; return;
  end if;

  perform gateway.purge_expired_alignment_content(20);
  perform pg_advisory_xact_lock(hashtextextended('authority.alignment:' || p_task_id::text, 0));
  perform gateway.ensure_task_alignment_state(p_task_id, v_tenant);
  update public.task_alignment_state set context_revision = context_revision + 1, updated_at = now()
  where task_id = p_task_id returning context_revision into v_ctx;

  -- Only content that was not passed is kept, encrypted, for a bounded review window.
  if p_retain_content is not null and p_status in ('flagged', 'quarantined', 'held', 'unreviewed') then
    if char_length(p_retain_content) > 131072 then
      return query select 'invalid_request'::text, null::uuid, null::integer; return;
    end if;
    v_vault := vault.create_secret(p_retain_content, null, 'Authority alignment review content');
    v_until := now() + make_interval(secs => least(greatest(coalesce(p_retention_seconds, 604800), 3600), 2592000));
  end if;

  insert into public.external_content_items (
    tenant_id, task_id, review_id, origin, source_kind, source_label, source_uri, content_type,
    content_hash, byte_size, status, context_revision, receipt_id, vault_secret_id, retained_until
  ) values (
    v_tenant, p_task_id, p_review_id, p_origin, p_source_kind, p_source_label, p_source_uri, p_content_type,
    p_content_hash, p_byte_size, p_status, v_ctx, p_receipt_id, v_vault, v_until
  ) returning id into v_id;
  return query select 'ok'::text, v_id, v_ctx;
end;
$fn$;
revoke all on function gateway.record_external_content(text, uuid, uuid, text, text, text, text, text, text, integer, text, uuid, text, integer) from public;
grant execute on function gateway.record_external_content(text, uuid, uuid, text, text, text, text, text, text, integer, text, uuid, text, integer) to authority_gateway;

-- Status for the caller that submitted it; the original text only once a person approved it.
create or replace function gateway.get_external_content(p_secret text, p_item_id uuid)
returns table (
  gec_status text, gec_task_id uuid, gec_item_status text, gec_decision text, gec_content_hash text,
  gec_context_revision integer, gec_findings jsonb, gec_content text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task uuid; v_status text; v_item public.external_content_items; v_decision text; v_findings jsonb; v_text text;
begin
  select * into v_item from public.external_content_items where id = p_item_id;
  if v_item.id is null then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text, null::integer, null::jsonb, null::text; return;
  end if;
  select aa_status into v_status from gateway.alignment_auth(p_secret, v_item.task_id);
  if v_status <> 'ok' then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text, null::integer, null::jsonb, null::text; return;
  end if;
  select r.decision, r.findings into v_decision, v_findings from public.alignment_reviews r where r.id = v_item.review_id;
  if v_decision = 'approved' and v_item.vault_secret_id is not null and v_item.retained_until > now() then
    select ds.decrypted_secret into v_text from vault.decrypted_secrets ds where ds.id = v_item.vault_secret_id;
  end if;
  return query select 'ok'::text, v_item.task_id, v_item.status, v_decision, v_item.content_hash,
    v_item.context_revision, coalesce(v_findings, '[]'::jsonb), v_text;
end;
$fn$;
revoke all on function gateway.get_external_content(text, uuid) from public;
grant execute on function gateway.get_external_content(text, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 8. Activation gate: under enforcement a contract needs a clean plan review
--    (or a person's explicit exception) for the task's current objectives.
-- ---------------------------------------------------------------------------
create or replace function gateway.contract_alignment_cleared(p_contract_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_task uuid; v_mode text; v_obj integer;
begin
  select tac.task_id, s.mode into v_task, v_mode
  from public.task_authority_contracts tac
  join public.tasks t on t.id = tac.task_id
  left join public.customers c on c.id = t.customer_id
  left join public.alignment_settings s on s.application_id = c.application_id
  where tac.id = p_contract_id;
  if coalesce(v_mode, 'off') <> 'enforce' then return true; end if;
  select objective_version into v_obj from public.task_alignment_state where task_id = v_task;
  return exists (
    select 1 from public.alignment_reviews r
    where r.contract_id = p_contract_id and r.kind = 'plan' and r.mode = 'enforce'
      and r.objective_version = coalesce(v_obj, 0)
      and (r.outcome = 'aligned' or r.decision = 'approved')
      and r.decision is distinct from 'rejected'
  );
end;
$fn$;
revoke all on function gateway.contract_alignment_cleared(uuid) from public;

create or replace function gateway.activate_task_contract_core(
  p_contract_id uuid, p_activator_principal_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_task_id uuid;
  v_status public.contract_status;
  v_ephemeral_limits jsonb;
  v_required_approvals_spec jsonb;
  v_expires_at timestamptz;
  v_existing_active_id uuid;
  v_item jsonb;
begin
  select tenant_id, task_id, contract_status, ephemeral_limits, required_approvals_spec
    into v_tenant_id, v_task_id, v_status, v_ephemeral_limits, v_required_approvals_spec
  from public.task_authority_contracts
  where id = p_contract_id;

  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if v_status not in ('proposed', 'awaiting_approval') then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.contract_activation:' || v_task_id::text, 0));

  for v_item in select * from jsonb_array_elements(coalesce(v_required_approvals_spec -> 'items', '[]'::jsonb))
  loop
    if exists (
      select 1 from public.approvals a
      where a.contract_id = p_contract_id
        and a.required_kind = (v_item ->> 'kind')::public.approval_requirement_kind
        and a.required_role is not distinct from nullif(v_item ->> 'role', '')::public.tenant_role
        and a.status <> 'approved'
    ) then
      raise exception 'a required approval is missing or was rejected (kind %, role %)',
        v_item ->> 'kind', v_item ->> 'role'
        using errcode = '23514';
    end if;
  end loop;

  if not gateway.contract_alignment_cleared(p_contract_id) then
    raise exception 'the plan has not passed task-alignment review' using errcode = '23514';
  end if;

  select id into v_existing_active_id
  from public.task_authority_contracts
  where task_id = v_task_id and contract_status = 'active' and id <> p_contract_id;

  v_expires_at := now() + make_interval(secs => (v_ephemeral_limits ->> 'expiresInSeconds')::integer);

  if v_existing_active_id is not null then
    update public.task_authority_contracts
    set contract_status = 'superseded', superseded_at = now(), superseded_by_contract_id = p_contract_id
    where id = v_existing_active_id;
  end if;

  update public.task_authority_contracts
  set contract_status = 'active', activated_at = now(), activated_by_principal_id = p_activator_principal_id,
      expires_at = v_expires_at
  where id = p_contract_id and contract_status in ('proposed', 'awaiting_approval');

  if not found then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;

  update public.tasks
  set status = 'contract_issued', updated_at = now()
  where id = v_task_id and status = 'pending';
end;
$fn$;
revoke all on function gateway.activate_task_contract_core(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 9. Dashboard RPCs (authenticated users, security_admin and above).
-- ---------------------------------------------------------------------------
create or replace function public.set_alignment_settings(p_application_id uuid, p_mode text, p_policy text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'set_alignment_settings() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.applications where id = p_application_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then return 'forbidden'; end if;
  if p_mode not in ('off', 'shadow', 'enforce') or p_policy not in ('reference', 'production') then
    return 'invalid_request';
  end if;
  insert into public.alignment_settings (application_id, tenant_id, mode, policy, updated_by, updated_at)
  values (p_application_id, v_tenant, p_mode, p_policy, (select auth.uid()), now())
  on conflict (application_id) do update
    set mode = excluded.mode, policy = excluded.policy, updated_by = excluded.updated_by, updated_at = now();
  return 'ok';
end;
$fn$;
revoke all on function public.set_alignment_settings(uuid, text, text) from public, anon;
grant execute on function public.set_alignment_settings(uuid, text, text) to authenticated;

-- A person's exception (or refusal) for exactly one review: its subject hash and
-- versions are fixed on the row, so approval never carries over to anything else.
create or replace function public.decide_alignment_review(p_review_id uuid, p_decision text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_tenant uuid; v_outcome text; v_decision text;
begin
  if (select auth.uid()) is null then
    raise exception 'decide_alignment_review() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id, outcome, decision into v_tenant, v_outcome, v_decision from public.alignment_reviews where id = p_review_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then return 'forbidden'; end if;
  if p_decision not in ('approved', 'rejected') or char_length(coalesce(p_note, '')) > 1000 then return 'invalid_request'; end if;
  if v_outcome = 'aligned' then return 'not_required'; end if;
  if v_decision is not null then return 'already_decided'; end if;
  update public.alignment_reviews
  set decision = p_decision, decided_by = (select auth.uid()), decided_at = now(), decision_note = nullif(btrim(p_note), '')
  where id = p_review_id and decision is null;
  return 'ok';
end;
$fn$;
revoke all on function public.decide_alignment_review(uuid, text, text) from public, anon;
grant execute on function public.decide_alignment_review(uuid, text, text) to authenticated;

-- The original of held/quarantined content, for reviewers only, while retained. Every reveal is recorded.
create or replace function public.reveal_external_content(p_item_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_tenant uuid; v_vault uuid; v_until timestamptz; v_text text;
begin
  if (select auth.uid()) is null then
    raise exception 'reveal_external_content() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id, vault_secret_id, retained_until into v_tenant, v_vault, v_until
  from public.external_content_items where id = p_item_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return null; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then
    raise exception 'insufficient privileges to view held content' using errcode = '42501';
  end if;
  if v_vault is null or v_until <= now() then return null; end if;
  select ds.decrypted_secret into v_text from vault.decrypted_secrets ds where ds.id = v_vault;
  update public.external_content_items set last_revealed_by = (select auth.uid()), last_revealed_at = now() where id = p_item_id;
  return v_text;
end;
$fn$;
revoke all on function public.reveal_external_content(uuid) from public, anon;
grant execute on function public.reveal_external_content(uuid) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261015000003'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
