-- Serialize Slack repo-agent quota releases with reservations. The preceding
-- migration locked reserve calls against each other, but release could delete a
-- failed reservation while a concurrent reserve was counting the same month.
-- Replacing both RPCs keeps the lock key derivation identical and DateStyle-safe.

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

  -- Advisory lock ids are 64-bit, so this intentionally uses the first
  -- 64 bits of a stable hash. Format the date explicitly so the key does
  -- not depend on the session DateStyle.
  perform pg_advisory_xact_lock(
    ('x' || substr(
      md5(
        'slack_repo_agent_month:'
        || p_team_id
        || ':'
        || to_char(p_month_start, 'YYYY-MM-DD')
      ),
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

  perform pg_advisory_xact_lock(
    ('x' || substr(
      md5(
        'slack_repo_agent_month:'
        || p_team_id
        || ':'
        || to_char(p_month_start, 'YYYY-MM-DD')
      ),
      1,
      16
    ))::bit(64)::bigint
  );

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
