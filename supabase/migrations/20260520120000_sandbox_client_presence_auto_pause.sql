alter table public.sandboxes
  drop constraint if exists sandboxes_stop_reason_check;

alter table public.sandboxes
  add constraint sandboxes_stop_reason_check
  check (
    stop_reason in (
      'idle_timeout',
      'lifetime_timeout',
      'manual',
      'stuck_boot',
      'vm_gone',
      'auto_pause',
      'unknown'
    )
  );

alter table public.sandboxes
  drop constraint if exists sandboxes_status_check;

alter table public.sandboxes
  add constraint sandboxes_status_check
  check (
    status in (
      'creating',
      'installing',
      'running',
      'pausing',
      'stopped',
      'paused',
      'error'
    )
  );

alter table public.sandboxes
  drop constraint if exists sandboxes_health_status_check;

alter table public.sandboxes
  add constraint sandboxes_health_status_check
  check (
    health_status in (
      'unknown',
      'starting',
      'running',
      'pausing',
      'ready',
      'stopped',
      'paused',
      'error',
      'not_available',
      'idle_warning',
      'app_error',
      'unreachable'
    )
  );

create unique index if not exists sandboxes_one_active_branch_root_per_repo_user_pausing_idx
  on public.sandboxes (user_id, repo_id, working_branch, root_directory)
  nulls not distinct
  where repo_id is not null
    and working_branch is not null
    and status in ('creating', 'installing', 'running', 'pausing');

drop index if exists public.sandboxes_one_active_branch_root_per_repo_user_idx;

alter index if exists public.sandboxes_one_active_branch_root_per_repo_user_pausing_idx
  rename to sandboxes_one_active_branch_root_per_repo_user_idx;

drop index if exists public.sandboxes_repo_branch_root_idx;

create index if not exists sandboxes_repo_branch_root_idx
  on public.sandboxes (repo_id, user_id, working_branch, root_directory)
  where status in ('creating', 'installing', 'running', 'pausing');

drop index if exists public.sandboxes_user_team_active_idx;

create index if not exists sandboxes_user_team_active_idx
  on public.sandboxes (
    user_id,
    product_team_id,
    repo_id,
    working_branch,
    root_directory,
    created_at desc
  )
  where status in ('creating', 'installing', 'running', 'pausing', 'paused');

create table if not exists public.sandbox_client_sessions (
  id uuid primary key default gen_random_uuid(),
  sandbox_record_id uuid not null references public.sandboxes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tab_id text not null check (char_length(tab_id) between 1 and 128),
  session_id text not null check (char_length(session_id) between 1 and 128),
  attached_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  release_event_id uuid,
  auto_pause_queued_at timestamptz,
  last_event_at timestamptz not null default now(),
  event_seq integer not null default 0 check (event_seq >= 0),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.sandbox_client_sessions
  add column if not exists release_event_id uuid,
  add column if not exists auto_pause_queued_at timestamptz,
  add column if not exists event_seq integer not null default 0;

alter table public.sandbox_client_sessions
  drop constraint if exists sandbox_client_sessions_event_seq_check;

alter table public.sandbox_client_sessions
  add constraint sandbox_client_sessions_event_seq_check
  check (event_seq >= 0);

create unique index if not exists sandbox_client_sessions_identity_idx
  on public.sandbox_client_sessions (
    sandbox_record_id,
    user_id,
    tab_id,
    session_id
  );

create index if not exists sandbox_client_sessions_active_idx
  on public.sandbox_client_sessions (sandbox_record_id, last_event_at desc)
  where released_at is null;

create index if not exists sandbox_client_sessions_last_event_idx
  on public.sandbox_client_sessions (sandbox_record_id, last_event_at desc);

create or replace function public.record_sandbox_client_attach_event(
  p_sandbox_record_id uuid,
  p_user_id uuid,
  p_tab_id text,
  p_session_id text,
  p_event_seq integer
)
returns table (
  session_row_id uuid,
  applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  perform pg_advisory_xact_lock(
    hashtextextended('sandbox-presence:' || p_sandbox_record_id::text, 0)
  );

  return query
  with upserted as (
    insert into public.sandbox_client_sessions (
      sandbox_record_id,
      user_id,
      tab_id,
      session_id,
      attached_at,
      released_at,
      release_reason,
      last_event_at,
      event_seq
    )
    values (
      p_sandbox_record_id,
      p_user_id,
      p_tab_id,
      p_session_id,
      v_now,
      null,
      null,
      v_now,
      p_event_seq
    )
    on conflict (sandbox_record_id, user_id, tab_id, session_id)
    do update set
      attached_at = excluded.attached_at,
      released_at = null,
      release_reason = null,
      release_event_id = null,
      auto_pause_queued_at = null,
      last_event_at = excluded.last_event_at,
      event_seq = excluded.event_seq
    where sandbox_client_sessions.event_seq < excluded.event_seq
    returning sandbox_client_sessions.id
  ),
  existing as (
    select scs.id
    from public.sandbox_client_sessions scs
    where scs.sandbox_record_id = p_sandbox_record_id
      and scs.user_id = p_user_id
      and scs.tab_id = p_tab_id
      and scs.session_id = p_session_id
      and not exists (select 1 from upserted)
    limit 1
  )
  select upserted.id, true from upserted
  union all
  select existing.id, false from existing;
end;
$$;

revoke all on function public.record_sandbox_client_attach_event(
  uuid,
  uuid,
  text,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.record_sandbox_client_attach_event(
  uuid,
  uuid,
  text,
  text,
  integer
) to service_role;

create table if not exists public.sandbox_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  sandbox_record_id uuid references public.sandboxes(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  tab_id text,
  session_id text,
  event_type text not null check (
    event_type in (
      'tab_attached',
      'tab_released',
      'auto_pause_queued',
      'auto_pause_decision',
      'auto_pause_succeeded',
      'auto_pause_failed',
      'resume_after_auto_pause'
    )
  ),
  decision_code text,
  worker_run_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sandbox_lifecycle_events_sandbox_created_idx
  on public.sandbox_lifecycle_events (sandbox_record_id, created_at desc);

create index if not exists sandbox_lifecycle_events_decision_created_idx
  on public.sandbox_lifecycle_events (decision_code, created_at desc)
  where decision_code is not null;

create or replace function public.record_sandbox_client_release_event(
  p_sandbox_record_id uuid,
  p_user_id uuid,
  p_tab_id text,
  p_session_id text,
  p_event_seq integer,
  p_release_reason text
)
returns table (
  session_row_id uuid,
  applied boolean,
  should_queue boolean,
  released_at timestamptz,
  release_event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_session_row_id uuid;
  v_released_at timestamptz;
  v_release_event_id uuid;
  v_auto_pause_queued_at timestamptz;
  v_event_seq integer;
  v_release_reason text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('sandbox-presence:' || p_sandbox_record_id::text, 0)
  );

  insert into public.sandbox_client_sessions as scs (
    sandbox_record_id,
    user_id,
    tab_id,
    session_id,
    attached_at,
    released_at,
    release_reason,
    auto_pause_queued_at,
    last_event_at,
    event_seq
  )
  values (
    p_sandbox_record_id,
    p_user_id,
    p_tab_id,
    p_session_id,
    v_now,
    v_now,
    p_release_reason,
    null,
    v_now,
    p_event_seq
  )
  on conflict (sandbox_record_id, user_id, tab_id, session_id)
  do update set
    released_at = excluded.released_at,
    release_reason = excluded.release_reason,
    release_event_id = null,
    auto_pause_queued_at = null,
    last_event_at = excluded.last_event_at,
    event_seq = excluded.event_seq
  where scs.event_seq <= excluded.event_seq
    and scs.released_at is null
  returning
    scs.id,
    scs.released_at,
    scs.release_event_id,
    scs.auto_pause_queued_at,
    scs.event_seq,
    scs.release_reason
  into
    v_session_row_id,
    v_released_at,
    v_release_event_id,
    v_auto_pause_queued_at,
    v_event_seq,
    v_release_reason;

  if v_session_row_id is not null then
    insert into public.sandbox_lifecycle_events (
      sandbox_record_id,
      user_id,
      tab_id,
      session_id,
      event_type,
      payload,
      created_at
    )
    values (
      p_sandbox_record_id,
      p_user_id,
      p_tab_id,
      p_session_id,
      'tab_released',
      jsonb_build_object(
        'event_seq', v_event_seq,
        'session_row_id', v_session_row_id,
        'reason', v_release_reason,
        'released_at', v_released_at
      ),
      v_now
    )
    returning id into v_release_event_id;

    update public.sandbox_client_sessions scs
    set release_event_id = v_release_event_id
    where scs.id = v_session_row_id;

    return query
    select
      v_session_row_id,
      true,
      true,
      v_released_at,
      v_release_event_id;
    return;
  end if;

  select
    scs.id,
    scs.released_at,
    scs.release_event_id,
    scs.auto_pause_queued_at,
    scs.event_seq,
    scs.release_reason
  into
    v_session_row_id,
    v_released_at,
    v_release_event_id,
    v_auto_pause_queued_at,
    v_event_seq,
    v_release_reason
  from public.sandbox_client_sessions scs
  where scs.sandbox_record_id = p_sandbox_record_id
    and scs.user_id = p_user_id
    and scs.tab_id = p_tab_id
    and scs.session_id = p_session_id
  limit 1
  for update;

  if v_session_row_id is null then
    return;
  end if;

  if v_released_at is not null and v_release_event_id is null then
    insert into public.sandbox_lifecycle_events (
      sandbox_record_id,
      user_id,
      tab_id,
      session_id,
      event_type,
      payload,
      created_at
    )
    values (
      p_sandbox_record_id,
      p_user_id,
      p_tab_id,
      p_session_id,
      'tab_released',
      jsonb_build_object(
        'event_seq', v_event_seq,
        'session_row_id', v_session_row_id,
        'reason', v_release_reason,
        'released_at', v_released_at
      ),
      v_now
    )
    returning id into v_release_event_id;

    update public.sandbox_client_sessions scs
    set release_event_id = v_release_event_id
    where scs.id = v_session_row_id
      and scs.release_event_id is null;
  end if;

  return query
  select
    v_session_row_id,
    false,
    v_released_at is not null
      and v_auto_pause_queued_at is null
      and v_release_event_id is not null,
    v_released_at,
    v_release_event_id;
end;
$$;

revoke all on function public.record_sandbox_client_release_event(
  uuid,
  uuid,
  text,
  text,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.record_sandbox_client_release_event(
  uuid,
  uuid,
  text,
  text,
  integer,
  text
) to service_role;

create or replace function public.claim_sandbox_auto_pause(
  p_sandbox_record_id uuid,
  p_sandbox_id text,
  p_released_at timestamptz
)
returns table (
  claimed boolean,
  previous_health_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('sandbox-presence:' || p_sandbox_record_id::text, 0)
  );

  return query
  with candidate as (
    select s.id, s.health_status
    from public.sandboxes s
    where s.id = p_sandbox_record_id
      and s.sandbox_id = p_sandbox_id
      and s.status = 'running'
      and s.persistent is true
      and s.exec_lock_token is null
      and not exists (
        select 1
        from public.sandbox_client_sessions scs
        where scs.sandbox_record_id = s.id
          and (
            scs.released_at is null
            or scs.last_event_at > p_released_at
          )
      )
      and not exists (
        select 1
        from public.ai_calls ac
        where ac.status in ('pending', 'streaming')
          and (
            ac.metadata->>'sandbox_record_id' = s.id::text
            or ac.metadata->>'sandbox_id' = s.id::text
            or ac.metadata->>'sandbox_id' = s.sandbox_id
          )
      )
      and not exists (
        select 1
        from public.external_agent_runs ear
        where ear.sandbox_record_id = s.id
          and ear.status in ('pending', 'streaming')
      )
    limit 1
  ),
  updated as (
    update public.sandboxes s
    set
      status = 'pausing',
      health_status = 'pausing',
      stop_reason = 'auto_pause',
      last_active_at = now()
    from candidate c
    where s.id = c.id
    returning c.health_status
  )
  select true, updated.health_status
  from updated
  union all
  select false, null::text
  where not exists (select 1 from updated);
end;
$$;

revoke all on function public.claim_sandbox_auto_pause(
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_sandbox_auto_pause(
  uuid,
  text,
  timestamptz
) to service_role;

alter table public.sandbox_client_sessions enable row level security;

drop policy if exists sandbox_client_sessions_owner_select
  on public.sandbox_client_sessions;
create policy sandbox_client_sessions_owner_select
  on public.sandbox_client_sessions
  for select using (user_id = public.current_profile_id());

alter table public.sandbox_lifecycle_events enable row level security;

drop policy if exists sandbox_lifecycle_events_owner_select
  on public.sandbox_lifecycle_events;
create policy sandbox_lifecycle_events_owner_select
  on public.sandbox_lifecycle_events
  for select using (user_id = public.current_profile_id());

comment on table public.sandbox_client_sessions is
  'Best-effort browser tab/session presence for sandbox lifecycle decisions. Writes go through server routes; no interval heartbeats.';

comment on table public.sandbox_lifecycle_events is
  'Append-only sandbox attach/release and auto-pause decision audit trail. Payloads must not contain prompts, secrets, or provider tokens.';
