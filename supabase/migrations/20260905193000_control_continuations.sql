-- Durable, owner-scoped handoff from a Control turn to its exact worker set.
-- A ready handoff is eligible for dispatch, not proof the mission is complete.
create table if not exists public.control_continuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null references public.control_sessions(id) on delete cascade,
  parent_ai_call_id uuid not null,
  origin_message jsonb not null,
  worker_run_ids uuid[] not null,
  request_context jsonb not null,
  instruction text not null,
  parent_ready boolean not null default false,
  status text not null default 'waiting'
    check (status in ('waiting','ready','running','finished','needs_input','failed','cancelled')),
  runtime_run_id text,
  resume_ai_call_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, parent_ai_call_id),
  check (cardinality(worker_run_ids) > 0),
  check (jsonb_typeof(request_context) = 'object'),
  check (origin_message->>'role' = 'user')
);
create index if not exists control_continuations_session_idx
  on public.control_continuations (user_id, session_id, created_at desc);
create index if not exists control_continuations_workers_idx
  on public.control_continuations using gin (worker_run_ids)
  where status in ('waiting','ready');
alter table public.control_continuations enable row level security;
revoke all on public.control_continuations from public, anon, authenticated;
grant select, insert, update on public.control_continuations to service_role;

-- Supabase postgres_changes checks the subscriber's SELECT policy. Keep all
-- mutations server-only; a signed-in owner may read their own handoff.
do $$
declare target text;
begin
  if to_regprocedure('public.current_profile_id()') is not null then
    drop policy if exists control_continuations_owner_read on public.control_continuations;
    create policy control_continuations_owner_read on public.control_continuations
      for select to authenticated using (user_id = (select public.current_profile_id()));
    grant select on public.control_continuations to authenticated;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach target in array array['control_continuations','control_sessions'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target
      ) then
        execute format('alter publication supabase_realtime add table public.%I', target);
      end if;
    end loop;
  end if;
end $$;

create or replace function public.control_latest_user_message(p_messages jsonb)
returns jsonb language sql immutable security invoker set search_path = public as $$
  select value from jsonb_array_elements(p_messages) with ordinality m
  where value->>'role' = 'user' order by ordinality desc limit 1;
$$;

create or replace function public.control_register_continuation(
  p_user_id uuid, p_session_id uuid, p_parent_ai_call_id uuid,
  p_origin_message_id text, p_worker_run_ids uuid[],
  p_request_context jsonb, p_instruction text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  session_row public.control_sessions%rowtype;
  current_origin jsonb;
  existing public.control_continuations%rowtype;
  worker_ids uuid[];
begin
  select * into session_row from public.control_sessions
    where id = p_session_id and user_id = p_user_id and archived = false for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  current_origin := public.control_latest_user_message(session_row.messages);
  if current_origin is null or current_origin->>'id' is distinct from p_origin_message_id
  then return jsonb_build_object('status','superseded'); end if;
  if session_row.orchestration_run_id is null or session_row.repo_id is null
    or not exists (select 1 from public.ai_calls where id = p_parent_ai_call_id
      and user_id = p_user_id and metadata->>'mission_id' = p_session_id::text)
  then return jsonb_build_object('status','not_found'); end if;
  if coalesce(cardinality(p_worker_run_ids),0) = 0
    or (select count(*) <> count(distinct id) from unnest(p_worker_run_ids) id)
    or array_position(p_worker_run_ids, null) is not null
    or jsonb_typeof(p_request_context) is distinct from 'object'
    or p_request_context->>'repoId' is distinct from session_row.repo_id::text
    or p_request_context->>'missionId' is distinct from p_session_id::text
    or p_request_context->>'mode' = 'plan'
    or coalesce(btrim(p_request_context->>'model'),'') = ''
    or coalesce(btrim(p_instruction),'') = ''
  then return jsonb_build_object('status','invalid'); end if;
  select array_agg(id order by id) into worker_ids from unnest(p_worker_run_ids) id;
  if exists (
    select 1 from unnest(worker_ids) requested(worker_id) where not exists (
      select 1 from public.external_agent_runs r
      join public.orchestration_worktrees w on w.id = r.worktree_id
      where r.id = requested.worker_id and r.user_id = p_user_id and r.repo_id = session_row.repo_id
        and w.user_id = p_user_id and w.run_id = session_row.orchestration_run_id
        and w.repo_id = session_row.repo_id
    )
  ) then return jsonb_build_object('status','not_found'); end if;
  select * into existing from public.control_continuations
    where session_id = p_session_id and parent_ai_call_id = p_parent_ai_call_id;
  if found then
    if existing.worker_run_ids <> worker_ids or existing.request_context <> p_request_context
      or existing.instruction <> p_instruction or existing.origin_message <> current_origin
    then return jsonb_build_object('status','conflict'); end if;
    return jsonb_build_object('status','ok','continuation',to_jsonb(existing),'replayed',true);
  end if;
  if exists (select 1 from public.external_agent_runs where id = any(worker_ids) and status = 'awaiting_input')
  then return jsonb_build_object('status','needs_input'); end if;
  if not exists (select 1 from public.external_agent_runs where id = any(worker_ids) and status in ('pending','streaming'))
  then return jsonb_build_object('status','already_finished'); end if;
  insert into public.control_continuations
    (user_id, session_id, parent_ai_call_id, origin_message, worker_run_ids, request_context, instruction)
    values (p_user_id,p_session_id,p_parent_ai_call_id,current_origin,worker_ids,p_request_context,p_instruction)
    returning * into existing;
  return jsonb_build_object('status','ok','continuation',to_jsonb(existing),'replayed',false);
end;
$$;

-- Recheck readiness on both parent completion and worker completion. This
-- closes the race where every worker finishes before handoff registration.
create or replace function public.control_refresh_continuation(
  p_user_id uuid, p_continuation_id uuid,
  p_parent_ai_call_id uuid default null, p_parent_message jsonb default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  ticket public.control_continuations%rowtype;
  session_row public.control_sessions%rowtype;
begin
  select * into ticket from public.control_continuations where id = p_continuation_id and user_id = p_user_id;
  if not found then return null; end if;
  select * into session_row from public.control_sessions where id = ticket.session_id and user_id = p_user_id for update;
  if not found then return null; end if;
  select * into ticket from public.control_continuations where id = p_continuation_id and user_id = p_user_id for update;
  if ticket.status not in ('waiting','ready') then return to_jsonb(ticket); end if;
  if session_row.archived or session_row.repo_id::text is distinct from ticket.request_context->>'repoId'
    or public.control_latest_user_message(session_row.messages) is distinct from ticket.origin_message then
    update public.control_continuations set status = 'cancelled', error = 'Superseded by a newer user request.', updated_at = clock_timestamp()
      where id = ticket.id returning * into ticket;
    return to_jsonb(ticket);
  end if;
  if p_parent_ai_call_id is not null then
    if p_parent_ai_call_id <> ticket.parent_ai_call_id
      or p_parent_message is null
      or p_parent_message->>'role' is distinct from 'assistant'
      or p_parent_message->'metadata'->>'ai_call_id' is distinct from p_parent_ai_call_id::text
      or not exists (select 1 from jsonb_array_elements(session_row.messages) m where m = p_parent_message)
    then raise exception 'Parent transcript checkpoint is not durable' using errcode = '22023'; end if;
    update public.control_continuations set parent_ready = true, updated_at = clock_timestamp()
      where id = ticket.id returning * into ticket;
  end if;
  if ticket.parent_ready and not exists (
    select 1 from unnest(ticket.worker_run_ids) requested(worker_id) where not exists (
      select 1 from public.external_agent_runs r where r.id = requested.worker_id and r.user_id = p_user_id
        and r.status in ('success','failed','cancelled','awaiting_input')
    )
  ) then
    update public.control_continuations set status = 'ready', updated_at = clock_timestamp()
      where id = ticket.id returning * into ticket;
  end if;
  return to_jsonb(ticket);
end;
$$;

create or replace function public.control_claim_continuation(
  p_user_id uuid, p_continuation_id uuid, p_runtime_run_id text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  ticket jsonb;
begin
  if coalesce(btrim(p_runtime_run_id),'') = '' then return null; end if;
  ticket := public.control_refresh_continuation(p_user_id,p_continuation_id);
  if ticket is null or ticket->>'status' <> 'ready' then return null; end if;
  update public.control_continuations set status = 'running', runtime_run_id = p_runtime_run_id, error = null, updated_at = clock_timestamp()
    where id = p_continuation_id and user_id = p_user_id and status = 'ready' returning to_jsonb(control_continuations.*) into ticket;
  return ticket;
end;
$$;

-- New user instructions/archive supersede pending or active automation in the
-- same transaction as the session update. Runtime cancellation is delivered by
-- the application; every background tool must also check this durable fence.
create or replace function public.control_supersede_continuations()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  update public.control_continuations set status = 'cancelled',
    error = 'Superseded by a newer user request.', updated_at = clock_timestamp()
    where session_id = new.id and user_id = new.user_id
      and status in ('waiting','ready','running')
      and (new.archived or new.repo_id::text is distinct from request_context->>'repoId'
        or public.control_latest_user_message(new.messages) is distinct from origin_message);
  return new;
end;
$$;
drop trigger if exists control_supersede_continuations on public.control_sessions;
create trigger control_supersede_continuations after update of messages, archived, repo_id on public.control_sessions
  for each row execute function public.control_supersede_continuations();

-- Kept local so both migration ledgers work without Neon's base notify helper.
create or replace function public.control_notify_continuation_event()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  perform pg_notify('mogplex_table_events', json_build_object(
    'table', TG_TABLE_NAME, 'op', TG_OP,
    'user_id', coalesce(to_jsonb(NEW)->>'user_id', to_jsonb(OLD)->>'user_id'),
    'id', coalesce(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id')
  )::text);
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.control_notify_continuation_event() from public, anon, authenticated;
grant execute on function public.control_notify_continuation_event() to service_role;
drop trigger if exists mogplex_notify_control_continuations on public.control_continuations;
create trigger mogplex_notify_control_continuations after insert or update or delete on public.control_continuations
  for each row execute function public.control_notify_continuation_event();
drop trigger if exists mogplex_notify_control_sessions on public.control_sessions;
create trigger mogplex_notify_control_sessions after insert or update or delete on public.control_sessions
  for each row execute function public.control_notify_continuation_event();

revoke all on function public.control_latest_user_message(jsonb) from public, anon, authenticated;
revoke all on function public.control_register_continuation(uuid,uuid,uuid,text,uuid[],jsonb,text) from public, anon, authenticated;
revoke all on function public.control_refresh_continuation(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.control_claim_continuation(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.control_supersede_continuations() from public, anon, authenticated;
grant execute on function public.control_latest_user_message(jsonb) to service_role;
grant execute on function public.control_register_continuation(uuid,uuid,uuid,text,uuid[],jsonb,text) to service_role;
grant execute on function public.control_refresh_continuation(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.control_claim_continuation(uuid,uuid,text) to service_role;
grant execute on function public.control_supersede_continuations() to service_role;
