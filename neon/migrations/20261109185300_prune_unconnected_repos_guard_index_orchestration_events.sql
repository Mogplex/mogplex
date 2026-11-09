-- prune_unconnected_repos guard index on orchestration_events, in its own transaction.
-- See 20261109180500_prune_unconnected_repos_guard_indexes.sql.
create index if not exists idx_orchestration_events_repo_id_probe
  on public.orchestration_events (repo_id) where repo_id is not null;
