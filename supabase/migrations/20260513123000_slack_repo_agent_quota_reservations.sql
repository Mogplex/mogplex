-- Make Slack workspace monthly repo-agent caps atomic under concurrent events.
-- The first pass counted ai_calls before run creation, which could allow a
-- small overrun if several distinct Slack events arrived at the same time.
-- This reservation table is keyed by Slack event id so Trigger retries reuse
-- the same slot, while a transaction-scoped advisory lock serializes distinct
-- events for the same workspace/month before the cap decision is made.

create table if not exists public.slack_repo_agent_monthly_run_reservations (
  id uuid primary key default gen_random_uuid(),
  slack_installation_id uuid not null references public.slack_installations(id) on delete cascade,
  team_id text not null,
  month_start date not null,
  slack_event_id text not null,
  created_at timestamptz not null default now(),
  constraint slack_repo_agent_monthly_reservations_event_unique
    unique (slack_installation_id, month_start, slack_event_id)
);

create index if not exists slack_repo_agent_monthly_reservations_count_idx
  on public.slack_repo_agent_monthly_run_reservations (
    slack_installation_id,
    month_start,
    created_at
  );

alter table public.slack_repo_agent_monthly_run_reservations enable row level security;
-- Service-role only. End-user JWTs do not need direct access to quota
-- reservations, and exposing them would leak workspace usage metadata.

create or replace function public.reserve_slack_repo_agent_monthly_run(
  p_slack_installation_id uuid,
  p_team_id text,
  p_month_start date,
  p_slack_event_id text,
  p_monthly_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if p_monthly_limit is null or p_monthly_limit <= 0 then
    return true;
  end if;

  if p_slack_installation_id is null then
    raise exception 'slack installation id is required';
  end if;
  if nullif(trim(p_team_id), '') is null then
    raise exception 'team id is required';
  end if;
  if p_month_start is null then
    raise exception 'month start is required';
  end if;
  if nullif(trim(p_slack_event_id), '') is null then
    raise exception 'slack event id is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'slack_repo_agent_month',
      hashtext(p_team_id || ':' || p_month_start::text)
    )
  );

  if exists (
    select 1
    from public.slack_repo_agent_monthly_run_reservations
    where slack_installation_id = p_slack_installation_id
      and month_start = p_month_start
      and slack_event_id = p_slack_event_id
  ) then
    return true;
  end if;

  select count(*) into v_used
  from public.slack_repo_agent_monthly_run_reservations
  where slack_installation_id = p_slack_installation_id
    and month_start = p_month_start;

  if v_used >= p_monthly_limit then
    return false;
  end if;

  insert into public.slack_repo_agent_monthly_run_reservations (
    slack_installation_id,
    team_id,
    month_start,
    slack_event_id
  ) values (
    p_slack_installation_id,
    p_team_id,
    p_month_start,
    p_slack_event_id
  );

  return true;
end;
$$;

revoke all on function public.reserve_slack_repo_agent_monthly_run(
  uuid,
  text,
  date,
  text,
  integer
) from public;
