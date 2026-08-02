-- Follow-up to 20260513123000:
-- - keep monthly quota state scoped to the Slack workspace, not the install row
-- - avoid a 32-bit intermediate advisory-lock hash
-- - allow failed run-start attempts to release their reserved slot
-- - make service-role access explicit for operational tooling

alter table public.slack_repo_agent_monthly_run_reservations
  drop constraint if exists slack_repo_agent_monthly_run_reservations_slack_installation_id_fkey;

alter table public.slack_repo_agent_monthly_run_reservations
  drop constraint if exists slack_repo_agent_monthly_reservations_event_unique;

delete from public.slack_repo_agent_monthly_run_reservations r
using (
  select
    ctid,
    row_number() over (
      partition by team_id, month_start, slack_event_id
      order by created_at, id
    ) as duplicate_rank
  from public.slack_repo_agent_monthly_run_reservations
) duplicates
where r.ctid = duplicates.ctid
  and duplicates.duplicate_rank > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.slack_repo_agent_monthly_run_reservations'::regclass
      and conname = 'slack_repo_agent_monthly_reservations_team_event_unique'
  ) then
    alter table public.slack_repo_agent_monthly_run_reservations
      add constraint slack_repo_agent_monthly_reservations_team_event_unique
      unique (team_id, month_start, slack_event_id);
  end if;
end $$;

drop index if exists public.slack_repo_agent_monthly_reservations_count_idx;

create index if not exists slack_repo_agent_monthly_reservations_team_month_idx
  on public.slack_repo_agent_monthly_run_reservations (
    team_id,
    month_start,
    created_at
  );

grant select, insert, delete on public.slack_repo_agent_monthly_run_reservations to service_role;

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
    ('x' || substr(
      md5('slack_repo_agent_month:' || p_team_id || ':' || p_month_start::text),
      1,
      16
    ))::bit(64)::bigint
  );

  if exists (
    select 1
    from public.slack_repo_agent_monthly_run_reservations
    where team_id = p_team_id
      and month_start = p_month_start
      and slack_event_id = p_slack_event_id
  ) then
    return true;
  end if;

  select count(*) into v_used
  from public.slack_repo_agent_monthly_run_reservations
  where team_id = p_team_id
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

grant execute on function public.reserve_slack_repo_agent_monthly_run(
  uuid,
  text,
  date,
  text,
  integer
) to service_role;

create or replace function public.release_slack_repo_agent_monthly_run(
  p_team_id text,
  p_month_start date,
  p_slack_event_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_team_id), '') is null then
    raise exception 'team id is required';
  end if;
  if p_month_start is null then
    raise exception 'month start is required';
  end if;
  if nullif(trim(p_slack_event_id), '') is null then
    raise exception 'slack event id is required';
  end if;

  delete from public.slack_repo_agent_monthly_run_reservations
  where team_id = p_team_id
    and month_start = p_month_start
    and slack_event_id = p_slack_event_id;
end;
$$;

revoke all on function public.release_slack_repo_agent_monthly_run(
  text,
  date,
  text
) from public;

grant execute on function public.release_slack_repo_agent_monthly_run(
  text,
  date,
  text
) to service_role;
