create table if not exists public.agent_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists idx_agent_categories_user
  on public.agent_categories (user_id, created_at desc);

alter table public.agent_categories enable row level security;

drop policy if exists "agent_categories_select" on public.agent_categories;
create policy "agent_categories_select" on public.agent_categories
  for select using (user_id = public.current_profile_id());

drop policy if exists "agent_categories_insert" on public.agent_categories;
create policy "agent_categories_insert" on public.agent_categories
  for insert with check (user_id = public.current_profile_id());

drop policy if exists "agent_categories_update" on public.agent_categories;
create policy "agent_categories_update" on public.agent_categories
  for update using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

drop policy if exists "agent_categories_delete" on public.agent_categories;
create policy "agent_categories_delete" on public.agent_categories
  for delete using (user_id = public.current_profile_id());
