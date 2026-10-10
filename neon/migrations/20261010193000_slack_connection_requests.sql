-- Durable, user-bound connection proposals. Credentials stay in their existing
-- vaults; this table only retains the Slack request needed to continue a turn.
create table public.slack_connection_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  slack_installation_id uuid not null references public.slack_installations(id) on delete cascade,
  target jsonb not null check (target->>'provider' is not null and target->>'provider' in ('github', 'vercel', 'connection')),
  payload jsonb not null,
  resume_text text not null check (length(btrim(resume_text)) > 0),
  product_team_id uuid references public.teams(id) on delete cascade,
  repo_id uuid references public.repos(id) on delete cascade,
  dispatched_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.slack_connection_requests enable row level security;
revoke all on public.slack_connection_requests from public;
do $$
declare client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = client_role) then
      execute format('revoke all on public.slack_connection_requests from %I', client_role);
    end if;
  end loop;
end;
$$;
grant select, insert, update, delete on public.slack_connection_requests to service_role;
create index slack_connection_requests_user_idx on public.slack_connection_requests(user_id);
create index slack_connection_requests_installation_idx on public.slack_connection_requests(slack_installation_id);
