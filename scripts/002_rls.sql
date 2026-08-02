-- Enable RLS
alter table profiles enable row level security;
alter table repos enable row level security;
alter table agents enable row level security;
alter table assignments enable row level security;
alter table job_runs enable row level security;
alter table tool_calls enable row level security;

-- Profiles
create policy "profiles_select" on profiles for select using (auth.uid() = id);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- Repos
create policy "repos_select" on repos for select using (auth.uid() = user_id);
create policy "repos_insert" on repos for insert with check (auth.uid() = user_id);
create policy "repos_update" on repos for update using (auth.uid() = user_id);
create policy "repos_delete" on repos for delete using (auth.uid() = user_id);

-- Agents
create policy "agents_select" on agents for select using (auth.uid() = user_id);
create policy "agents_insert" on agents for insert with check (auth.uid() = user_id);
create policy "agents_update" on agents for update using (auth.uid() = user_id);
create policy "agents_delete" on agents for delete using (auth.uid() = user_id);

-- Assignments (via repo ownership)
create policy "assignments_select" on assignments for select using (
  repo_id in (select id from repos where user_id = auth.uid())
);
create policy "assignments_insert" on assignments for insert with check (
  repo_id in (select id from repos where user_id = auth.uid())
);
create policy "assignments_update" on assignments for update using (
  repo_id in (select id from repos where user_id = auth.uid())
);
create policy "assignments_delete" on assignments for delete using (
  repo_id in (select id from repos where user_id = auth.uid())
);

-- Job runs (via assignment -> repo ownership)
create policy "job_runs_select" on job_runs for select using (
  assignment_id in (
    select a.id from assignments a
    join repos r on a.repo_id = r.id
    where r.user_id = auth.uid()
  )
);
create policy "job_runs_insert" on job_runs for insert with check (
  assignment_id in (
    select a.id from assignments a
    join repos r on a.repo_id = r.id
    where r.user_id = auth.uid()
  )
);

-- Tool calls (via job_run -> assignment -> repo)
create policy "tool_calls_select" on tool_calls for select using (
  job_run_id in (
    select jr.id from job_runs jr
    join assignments a on jr.assignment_id = a.id
    join repos r on a.repo_id = r.id
    where r.user_id = auth.uid()
  )
);
