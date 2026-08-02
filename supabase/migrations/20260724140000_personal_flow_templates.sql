create table if not exists public.flow_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text,
  graph jsonb not null,
  source_flow_id uuid references public.flows(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_flow_templates_user_updated
  on public.flow_templates (user_id, updated_at desc);

alter table public.flow_templates enable row level security;

drop policy if exists "Users can manage own flow templates"
  on public.flow_templates;
create policy "Users can manage own flow templates"
  on public.flow_templates for all
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());
