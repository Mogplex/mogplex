create table if not exists public.custom_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  template text not null,
  created_at timestamptz default now()
);

alter table public.custom_commands enable row level security;

create policy "custom_commands_select" on public.custom_commands 
  for select using (auth.uid() = user_id);
create policy "custom_commands_insert" on public.custom_commands 
  for insert with check (auth.uid() = user_id);
create policy "custom_commands_delete" on public.custom_commands 
  for delete using (auth.uid() = user_id);
