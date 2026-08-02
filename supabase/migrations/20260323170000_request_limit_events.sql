create table if not exists public.limit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  route_key text not null check (
    route_key in ('chat', 'sandbox_boot', 'snapshot_build', 'sandbox_exec')
  ),
  resource_id text,
  repo_id uuid references public.repos(id) on delete set null,
  sandbox_id uuid references public.sandboxes(id) on delete set null,
  decision text not null check (decision in ('allowed', 'denied')),
  reason text,
  limit_name text,
  window_seconds int,
  limit_value int,
  remaining int,
  retry_after_seconds int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.limit_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'limit_events'
      and policyname = 'owner_access'
  ) then
    create policy "owner_access" on public.limit_events
      for all
      using (user_id = public.current_profile_id())
      with check (user_id = public.current_profile_id());
  end if;
end
$$;

create index if not exists idx_limit_events_user_route_created
  on public.limit_events (user_id, route_key, created_at desc);

create index if not exists idx_limit_events_sandbox_created
  on public.limit_events (sandbox_id, created_at desc)
  where sandbox_id is not null;

create index if not exists idx_limit_events_repo_created
  on public.limit_events (repo_id, created_at desc)
  where repo_id is not null;

alter table public.sandboxes
  add column if not exists exec_lock_token text,
  add column if not exists exec_lock_started_at timestamptz;
