-- Claim each approval once before executing any approved tool side effects.
create table if not exists public.control_approval_executions (
  session_id uuid not null references public.control_sessions(id) on delete cascade,
  approval_id text not null,
  user_id uuid not null,
  message_id text not null,
  ai_call_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (session_id, approval_id)
);
alter table public.control_approval_executions enable row level security;
revoke all on public.control_approval_executions from public, anon, authenticated;
grant select, insert on public.control_approval_executions to service_role;

-- Checkpoints replace an entire message, not an individual tool part. Only
-- one continuation may write it until its final durable checkpoint completes.
create table if not exists public.control_approval_continuations (
  session_id uuid not null references public.control_sessions(id) on delete cascade,
  message_id text not null,
  user_id uuid not null,
  ai_call_id uuid not null,
  primary key (session_id, message_id)
);
alter table public.control_approval_continuations enable row level security;
revoke all on public.control_approval_continuations from public, anon, authenticated;
grant select, insert, delete on public.control_approval_continuations to service_role;

create or replace function public.control_claim_approvals(
  p_user_id uuid, p_session_id uuid, p_message_id text,
  p_approval_ids text[], p_ai_call_id uuid, p_expected_message jsonb
) returns boolean
language plpgsql security invoker set search_path = public as $$
declare
  session_row public.control_sessions%rowtype;
  saved_message jsonb;
begin
  if p_ai_call_id is null or coalesce(cardinality(p_approval_ids), 0) = 0
     or (select count(*) <> count(distinct id) from unnest(p_approval_ids) id)
  then return false; end if;
  select * into session_row from public.control_sessions
    where id = p_session_id and user_id = p_user_id and archived = false for update;
  if not found then return false; end if;
  -- A newer turn supersedes this approval continuation. Check under the same
  -- row lock as the claim, not only against a request's earlier snapshot.
  if session_row.messages->-1->>'id' is distinct from p_message_id then return false; end if;
  select m into saved_message from jsonb_array_elements(session_row.messages) m
    where m->>'id' = p_message_id and m->>'role' = 'assistant';
  if saved_message is null or saved_message is distinct from p_expected_message then return false; end if;
  if exists (
    select 1 from public.control_approval_continuations
    where session_id = p_session_id and message_id = p_message_id
  ) then return false; end if;
  if exists (
    select 1 from unnest(p_approval_ids) id
    where not exists (
      select 1 from jsonb_array_elements(saved_message->'parts') part
      where part->>'state' = 'approval-requested'
        and part->'approval'->>'id' = id
    ) or exists (
      select 1 from public.control_approval_executions c
      where c.session_id = p_session_id and c.approval_id = id
    )
  ) then return false; end if;
  insert into public.control_approval_continuations
    (session_id, message_id, user_id, ai_call_id)
    values (p_session_id, p_message_id, p_user_id, p_ai_call_id);
  insert into public.control_approval_executions
    (session_id, approval_id, user_id, message_id, ai_call_id)
    select p_session_id, id, p_user_id, p_message_id, p_ai_call_id from unnest(p_approval_ids) id;
  return true;
end;
$$;
revoke all on function public.control_claim_approvals(uuid, uuid, text, text[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.control_claim_approvals(uuid, uuid, text, text[], uuid, jsonb) to service_role;

-- Never expire or steal a live writer's claim. A crash or failed checkpoint
-- retains the fence; an uncertain action must be inspected, not replayed.
create or replace function public.control_finish_approval_continuation(
  p_user_id uuid, p_session_id uuid, p_message_id text, p_ai_call_id uuid
) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.control_sessions
    where id = p_session_id and user_id = p_user_id for update;
  if not found then return false; end if;
  delete from public.control_approval_continuations
    where session_id = p_session_id and message_id = p_message_id
      and user_id = p_user_id and ai_call_id = p_ai_call_id;
  return found;
end;
$$;
revoke all on function public.control_finish_approval_continuation(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.control_finish_approval_continuation(uuid, uuid, text, uuid) to service_role;
