-- Index every column the prune_unconnected_repos guard probes that had none.
-- A legacy row that is still referenced stays a candidate, so the guard runs
-- on every App sync for that user (GET /api/github/repos syncs each time).
-- Without these, each run scans the referencing tables, job_runs and
-- decision_events among them. Partial on not null: only rows that point at a
-- repository are indexed.
--
-- Each write-heavy table gets its own file (the runner commits one file per
-- transaction), so a table's write lock ends when its index is built.
--
-- Expand only: new indexes, no change to any table or contract.
create index if not exists idx_control_sessions_repo_id_probe
  on public.control_sessions (repo_id) where repo_id is not null;
create index if not exists idx_control_sessions_project_probe
  on public.control_sessions (project) where project is not null;
create index if not exists idx_orchestration_tasks_repo_id_probe
  on public.orchestration_tasks (repo_id) where repo_id is not null;
create index if not exists idx_orchestration_worktrees_repo_id_probe
  on public.orchestration_worktrees (repo_id) where repo_id is not null;
create index if not exists idx_sandbox_launch_presets_repo_id_probe
  on public.sandbox_launch_presets (repo_id) where repo_id is not null;
create index if not exists idx_slack_connection_requests_repo_id_probe
  on public.slack_connection_requests (repo_id) where repo_id is not null;
