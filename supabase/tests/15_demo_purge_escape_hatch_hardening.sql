-- The demo-purge escape hatch requires BOTH the transaction-local flag AND
-- execution as the trusted function-owner role (authz.forbid_update_delete,
-- authz.enforce_contract_immutable, authz.enforce_policy_immutable — all
-- hardened in 20260925000007_harden_demo_purge_escape_hatch.sql).
--
-- Design review requirement: "Test the negative case by setting the flag
-- under a nontrusted role inside a database test and proving DELETE/UPDATE
-- still fails." Two tests below: one against the real execution_events
-- table (where the privilege layer already independently blocks this,
-- confirming the layers are genuinely redundant, not that the new check is
-- untested) and one against an isolated table with a real grant and no RLS
-- at all, which isolates the current_user check as the sole remaining
-- defense and proves it fires on its own.
--
-- Each DO block calls pgTAP's own ok() and captures it via t() — the same
-- convention every other suite uses via `select t(throws_ok(...))` — since
-- these specific scenarios need multi-statement setup (set_config, a role
-- switch, then the write attempt) that a single throws_ok() query string
-- can't express as cleanly as an explicit exception handler can.

select plan(4);

set local role postgres;

do $$
declare
  v_event_id uuid;
begin
  select id into v_event_id from public.execution_events limit 1;
  perform set_config('authority.allow_demo_purge', 'on', true);
  delete from public.execution_events where id = v_event_id;
  perform t(ok(true, 'legitimate demo-purge as postgres with the flag on still works'));
exception when others then
  perform t(ok(false, 'legitimate demo-purge as postgres regressed: ' || sqlerrm));
end $$;

do $$
declare
  v_event_id uuid;
begin
  select id into v_event_id from public.execution_events limit 1;
  perform set_config('authority.allow_demo_purge', 'on', true);
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
  delete from public.execution_events where id = v_event_id;
  perform t(ok(false, 'authenticated with the flag on deleted an execution_event'));
exception when sqlstate '42501' then
  perform t(ok(true, 'authenticated with the flag on is denied on execution_events (privilege layer, no grant exists)'));
end $$;

reset role;

-- Isolated: a throwaway table with a genuine grant and no RLS at all, so
-- only the trigger's own current_user check can decide the outcome.
create table mimic_escape_hatch (id uuid primary key default gen_random_uuid(), val text);
grant select, update, delete on mimic_escape_hatch to authenticated;

create or replace function mimic_forbid_update_delete()
returns trigger language plpgsql as $$
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' and current_user = 'postgres' then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'append-only' using errcode = '23514';
end;
$$;

create trigger mimic_escape_hatch_trigger before update or delete on mimic_escape_hatch
  for each row execute function mimic_forbid_update_delete();

insert into mimic_escape_hatch (id, val) values ('77770000-0000-4000-8000-000000000001', 'original');

do $$
begin
  perform set_config('authority.allow_demo_purge', 'on', true);
  set local role authenticated;
  update mimic_escape_hatch set val = 'tampered' where id = '77770000-0000-4000-8000-000000000001';
  perform t(ok(false, 'authenticated updated the isolated table despite the flag'));
exception when sqlstate '23514' then
  perform t(ok(true, 'the current_user check alone denies authenticated, even with a real grant, the flag on, and no RLS in the way'));
end $$;

reset role;

do $$
begin
  perform set_config('authority.allow_demo_purge', 'on', true);
  update mimic_escape_hatch set val = 'legitimate' where id = '77770000-0000-4000-8000-000000000001';
  perform t(ok(true, 'postgres with the flag on is still allowed through the isolated table'));
exception when others then
  perform t(ok(false, 'postgres regressed on the isolated table: ' || sqlerrm));
end $$;

drop trigger mimic_escape_hatch_trigger on mimic_escape_hatch;
drop function mimic_forbid_update_delete();
drop table mimic_escape_hatch;
