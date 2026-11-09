-- prune_unconnected_repos guard index on review_findings, in its own transaction.
-- See 20261109180500_prune_unconnected_repos_guard_indexes.sql.
create index if not exists idx_review_findings_repo_full_name_probe
  on public.review_findings (repo_full_name) where repo_full_name is not null;
