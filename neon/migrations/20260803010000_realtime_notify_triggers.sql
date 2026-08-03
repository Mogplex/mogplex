-- LISTEN/NOTIFY trigger infrastructure for Neon realtime.
--
-- Each trigger fires pg_notify('mogplex_table_events', ...) with a tiny JSON
-- payload: table name, operation, user_id (if present), and row id. The SSE
-- route in app/api/realtime/events/route.ts LISTENs on that channel and fans
-- out to connected clients by user_id.
--
-- Payload is deliberately minimal to stay under the 8KB NOTIFY limit.

-- 1. The notify function (stateless, no SECURITY DEFINER needed)
create or replace function public.mogplex_notify_table_event()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'mogplex_table_events',
    json_build_object(
      'table', TG_TABLE_NAME,
      'op', TG_OP,
      'user_id', coalesce(to_jsonb(NEW) ->> 'user_id', to_jsonb(OLD) ->> 'user_id'),
      'id', coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id')
    )::text
  );
  return coalesce(NEW, OLD);
end;
$$;

-- 2. Per-table triggers
-- Each block checks if the table exists before creating the trigger so the
-- migration survives table drift (e.g. when running before the table is added).

do $$
begin
  if to_regclass('public.agents') is not null then
    drop trigger if exists mogplex_notify_agents on public.agents;
    create trigger mogplex_notify_agents
      after insert or update or delete on public.agents
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.ai_calls') is not null then
    drop trigger if exists mogplex_notify_ai_calls on public.ai_calls;
    create trigger mogplex_notify_ai_calls
      after insert or update or delete on public.ai_calls
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.ai_call_events') is not null then
    drop trigger if exists mogplex_notify_ai_call_events on public.ai_call_events;
    create trigger mogplex_notify_ai_call_events
      after insert or update or delete on public.ai_call_events
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.assignments') is not null then
    drop trigger if exists mogplex_notify_assignments on public.assignments;
    create trigger mogplex_notify_assignments
      after insert or update or delete on public.assignments
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.automation_dispatch_events') is not null then
    drop trigger if exists mogplex_notify_automation_dispatch_events on public.automation_dispatch_events;
    create trigger mogplex_notify_automation_dispatch_events
      after insert or update or delete on public.automation_dispatch_events
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.connections') is not null then
    drop trigger if exists mogplex_notify_connections on public.connections;
    create trigger mogplex_notify_connections
      after insert or update or delete on public.connections
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.github_installations') is not null then
    drop trigger if exists mogplex_notify_github_installations on public.github_installations;
    create trigger mogplex_notify_github_installations
      after insert or update or delete on public.github_installations
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.job_runs') is not null then
    drop trigger if exists mogplex_notify_job_runs on public.job_runs;
    create trigger mogplex_notify_job_runs
      after insert or update or delete on public.job_runs
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.limit_events') is not null then
    drop trigger if exists mogplex_notify_limit_events on public.limit_events;
    create trigger mogplex_notify_limit_events
      after insert or update or delete on public.limit_events
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.repo_connection_overrides') is not null then
    drop trigger if exists mogplex_notify_repo_connection_overrides on public.repo_connection_overrides;
    create trigger mogplex_notify_repo_connection_overrides
      after insert or update or delete on public.repo_connection_overrides
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.repos') is not null then
    drop trigger if exists mogplex_notify_repos on public.repos;
    create trigger mogplex_notify_repos
      after insert or update or delete on public.repos
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.sandboxes') is not null then
    drop trigger if exists mogplex_notify_sandboxes on public.sandboxes;
    create trigger mogplex_notify_sandboxes
      after insert or update or delete on public.sandboxes
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;

do $$
begin
  if to_regclass('public.triggers') is not null then
    drop trigger if exists mogplex_notify_triggers on public.triggers;
    create trigger mogplex_notify_triggers
      after insert or update or delete on public.triggers
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;
