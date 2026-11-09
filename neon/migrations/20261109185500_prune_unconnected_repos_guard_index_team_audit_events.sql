-- prune_unconnected_repos guard index on team_audit_events, in its own transaction.
-- See 20261109180500_prune_unconnected_repos_guard_indexes.sql.
create index if not exists idx_team_audit_events_repo_id_probe
  on public.team_audit_events (repo_id) where repo_id is not null;
