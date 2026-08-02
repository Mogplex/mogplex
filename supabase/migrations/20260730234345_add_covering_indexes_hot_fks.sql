-- Recovered from the remote migration history table. This change was
-- applied directly to production on 2026-07-30 (PostgREST max_rows
-- hardening session) via the management API, which records history
-- without a repo file — leaving `supabase db push` unable to reconcile
-- and blocking the deploy-production workflow. Committing the file
-- restores a consistent history; db push skips already-applied versions.

-- Covering indexes for foreign keys on the largest tables (unindexed_foreign_keys
-- advisor). These are the FK paths hit by cascading deletes/joins on tables with
-- meaningful row counts; the remaining flagged FKs are on tiny tables where an
-- index would cost more in write amplification than it saves.
create index if not exists idx_automation_dispatch_events_flow_version_id
  on public.automation_dispatch_events (flow_version_id) where flow_version_id is not null;
create index if not exists idx_flow_node_runs_flow_version_id
  on public.flow_node_runs (flow_version_id) where flow_version_id is not null;
create index if not exists idx_flow_node_runs_user_id
  on public.flow_node_runs (user_id);
create index if not exists idx_ai_calls_repo_id
  on public.ai_calls (repo_id) where repo_id is not null;
create index if not exists idx_ai_call_events_repo_id
  on public.ai_call_events (repo_id) where repo_id is not null;
create index if not exists idx_job_runs_trigger_id
  on public.job_runs (trigger_id) where trigger_id is not null;
create index if not exists idx_job_runs_flow_version_id
  on public.job_runs (flow_version_id) where flow_version_id is not null;
