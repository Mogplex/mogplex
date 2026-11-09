-- prune_unconnected_repos guard index on job_runs, in its own transaction.
-- See 20261109180500_prune_unconnected_repos_guard_indexes.sql.
create index if not exists idx_job_runs_metadata_repo_id_probe
  on public.job_runs ((metadata ->> 'repo_id'))
  where (metadata ->> 'repo_id') is not null;
