alter table public.profiles
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists auth_provider text,
  add column if not exists last_auth_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_auth_provider_check;

alter table public.profiles
  add constraint profiles_auth_provider_check
  check (auth_provider in ('github', 'vercel') or auth_provider is null);

create index if not exists idx_profiles_auth_user_id
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

alter table public.connections
  drop constraint if exists connections_user_id_fkey;
alter table public.connections
  add constraint connections_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.user_model_preferences
  drop constraint if exists user_model_preferences_user_id_fkey;
alter table public.user_model_preferences
  add constraint user_model_preferences_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.provider_keys
  drop constraint if exists provider_keys_user_id_fkey;
alter table public.provider_keys
  add constraint provider_keys_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.ai_calls
  drop constraint if exists ai_calls_user_id_fkey;
alter table public.ai_calls
  add constraint ai_calls_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.ai_call_events
  drop constraint if exists ai_call_events_user_id_fkey;
alter table public.ai_call_events
  add constraint ai_call_events_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.automation_dispatch_events
  drop constraint if exists automation_dispatch_events_user_id_fkey;
alter table public.automation_dispatch_events
  add constraint automation_dispatch_events_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
  limit 1
$$;

drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles for select using (id = public.current_profile_id());
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = auth_user_id);
create policy "profiles_update" on public.profiles for update using (id = public.current_profile_id());

drop policy if exists "repos_select" on public.repos;
drop policy if exists "repos_insert" on public.repos;
drop policy if exists "repos_update" on public.repos;
drop policy if exists "repos_delete" on public.repos;
create policy "repos_select" on public.repos for select using (user_id = public.current_profile_id());
create policy "repos_insert" on public.repos for insert with check (user_id = public.current_profile_id());
create policy "repos_update" on public.repos for update using (user_id = public.current_profile_id());
create policy "repos_delete" on public.repos for delete using (user_id = public.current_profile_id());

drop policy if exists "agents_select" on public.agents;
drop policy if exists "agents_insert" on public.agents;
drop policy if exists "agents_update" on public.agents;
drop policy if exists "agents_delete" on public.agents;
create policy "agents_select" on public.agents for select using (user_id = public.current_profile_id());
create policy "agents_insert" on public.agents for insert with check (user_id = public.current_profile_id());
create policy "agents_update" on public.agents for update using (user_id = public.current_profile_id());
create policy "agents_delete" on public.agents for delete using (user_id = public.current_profile_id());

drop policy if exists "assignments_select" on public.assignments;
drop policy if exists "assignments_insert" on public.assignments;
drop policy if exists "assignments_update" on public.assignments;
drop policy if exists "assignments_delete" on public.assignments;
create policy "assignments_select" on public.assignments for select using (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
);
create policy "assignments_insert" on public.assignments for insert with check (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
);
create policy "assignments_update" on public.assignments for update using (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
);
create policy "assignments_delete" on public.assignments for delete using (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
);

drop policy if exists "job_runs_select" on public.job_runs;
drop policy if exists "job_runs_insert" on public.job_runs;
create policy "job_runs_select" on public.job_runs for select using (
  assignment_id in (
    select a.id
    from public.assignments a
    join public.repos r on r.id = a.repo_id
    where r.user_id = public.current_profile_id()
  )
);
create policy "job_runs_insert" on public.job_runs for insert with check (
  assignment_id in (
    select a.id
    from public.assignments a
    join public.repos r on r.id = a.repo_id
    where r.user_id = public.current_profile_id()
  )
);

drop policy if exists "tool_calls_select" on public.tool_calls;
create policy "tool_calls_select" on public.tool_calls for select using (
  job_run_id in (
    select jr.id
    from public.job_runs jr
    join public.assignments a on a.id = jr.assignment_id
    join public.repos r on r.id = a.repo_id
    where r.user_id = public.current_profile_id()
  )
);

drop policy if exists "custom_commands_select" on public.custom_commands;
drop policy if exists "custom_commands_insert" on public.custom_commands;
drop policy if exists "custom_commands_delete" on public.custom_commands;
create policy "custom_commands_select" on public.custom_commands for select using (user_id = public.current_profile_id());
create policy "custom_commands_insert" on public.custom_commands for insert with check (user_id = public.current_profile_id());
create policy "custom_commands_delete" on public.custom_commands for delete using (user_id = public.current_profile_id());

drop policy if exists "ssh_select_own" on public.ssh_connections;
drop policy if exists "ssh_insert_own" on public.ssh_connections;
drop policy if exists "ssh_update_own" on public.ssh_connections;
drop policy if exists "ssh_delete_own" on public.ssh_connections;
create policy "ssh_select_own" on public.ssh_connections for select using (user_id = public.current_profile_id());
create policy "ssh_insert_own" on public.ssh_connections for insert with check (user_id = public.current_profile_id());
create policy "ssh_update_own" on public.ssh_connections for update using (user_id = public.current_profile_id());
create policy "ssh_delete_own" on public.ssh_connections for delete using (user_id = public.current_profile_id());

drop policy if exists "rules_own" on public.agent_rules;
create policy "rules_own" on public.agent_rules for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());

drop policy if exists "skills_own" on public.agent_skills;
create policy "skills_own" on public.agent_skills for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());

drop policy if exists "conversations_select" on public.conversations;
drop policy if exists "conversations_insert" on public.conversations;
drop policy if exists "conversations_update" on public.conversations;
drop policy if exists "conversations_delete" on public.conversations;
create policy "conversations_select" on public.conversations for select using (user_id = public.current_profile_id());
create policy "conversations_insert" on public.conversations for insert with check (user_id = public.current_profile_id());
create policy "conversations_update" on public.conversations for update using (user_id = public.current_profile_id());
create policy "conversations_delete" on public.conversations for delete using (user_id = public.current_profile_id());

drop policy if exists "skills_select" on public.skills;
drop policy if exists "skills_insert" on public.skills;
drop policy if exists "skills_update" on public.skills;
drop policy if exists "skills_delete" on public.skills;
create policy "skills_select" on public.skills for select using (user_id = public.current_profile_id() or is_public = true);
create policy "skills_insert" on public.skills for insert with check (user_id = public.current_profile_id());
create policy "skills_update" on public.skills for update using (user_id = public.current_profile_id());
create policy "skills_delete" on public.skills for delete using (user_id = public.current_profile_id());

drop policy if exists "sandboxes_own" on public.sandboxes;
create policy "sandboxes_own" on public.sandboxes for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());

drop policy if exists "owner_access" on public.user_model_preferences;
create policy "owner_access" on public.user_model_preferences for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());

drop policy if exists "owner_select" on public.provider_keys;
create policy "owner_select" on public.provider_keys for select using (user_id = public.current_profile_id());

drop policy if exists "owner_via_repo" on public.repo_rule_overrides;
create policy "owner_via_repo" on public.repo_rule_overrides for all using (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
) with check (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
);

drop policy if exists "owner_via_repo" on public.repo_skill_overrides;
create policy "owner_via_repo" on public.repo_skill_overrides for all using (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
) with check (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
);

drop policy if exists "owner_via_repo" on public.repo_model_overrides;
create policy "owner_via_repo" on public.repo_model_overrides for all using (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
) with check (
  repo_id in (select id from public.repos where user_id = public.current_profile_id())
);

drop policy if exists "owner_access" on public.ai_calls;
create policy "owner_access" on public.ai_calls for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());

drop policy if exists "Users can view own connections" on public.connections;
drop policy if exists "Users can insert own connections" on public.connections;
drop policy if exists "Users can update own connections" on public.connections;
drop policy if exists "Users can delete own connections" on public.connections;
create policy "Users can view own connections" on public.connections for select using (user_id = public.current_profile_id());
create policy "Users can insert own connections" on public.connections for insert with check (user_id = public.current_profile_id());
create policy "Users can update own connections" on public.connections for update using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());
create policy "Users can delete own connections" on public.connections for delete using (user_id = public.current_profile_id());

drop policy if exists "Users can manage own triggers" on public.triggers;
create policy "Users can manage own triggers" on public.triggers for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());

drop policy if exists "repo_connection_overrides_owner" on public.repo_connection_overrides;
create policy "repo_connection_overrides_owner" on public.repo_connection_overrides for all using (
  exists (select 1 from public.repos r where r.id = repo_id and r.user_id = public.current_profile_id())
) with check (
  exists (select 1 from public.repos r where r.id = repo_id and r.user_id = public.current_profile_id())
);

drop policy if exists "owner_access" on public.automation_dispatch_events;
create policy "owner_access" on public.automation_dispatch_events for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());

drop policy if exists "owner_access" on public.ai_call_events;
create policy "owner_access" on public.ai_call_events for all using (user_id = public.current_profile_id()) with check (user_id = public.current_profile_id());
