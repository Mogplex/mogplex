-- Direct Control turns have a durable input and a single execution claim.
-- ai_calls retains admission and terminal status for old app/worker releases.
create table public.control_turns (
  ai_call_id uuid primary key references public.ai_calls(id) on delete cascade,
  user_id uuid not null,
  session_id uuid not null references public.control_sessions(id) on delete cascade,
  request_context jsonb not null,
  team_id uuid,
  limit_claim_id uuid,
  runtime_run_id text,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index control_turns_session_idx on public.control_turns(user_id, session_id, created_at desc);
alter table public.control_turns enable row level security;
revoke all on public.control_turns from public;
grant all on public.control_turns to service_role;

create table public.control_tool_executions (
  ai_call_id uuid not null references public.ai_calls(id) on delete cascade,
  tool_call_id text not null,
  user_id uuid not null,
  tool_name text not null,
  input jsonb,
  output jsonb,
  state text not null check (state in ('started', 'completed', 'failed')),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (ai_call_id, tool_call_id)
);
alter table public.control_tool_executions enable row level security;
revoke all on public.control_tool_executions from public;
grant all on public.control_tool_executions to service_role;

-- Native Neon installations do not have the legacy browser roles.
do $$
declare client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = client_role) then
      execute format('revoke all on public.control_turns, public.control_tool_executions from %I', client_role);
    end if;
  end loop;
end $$;
