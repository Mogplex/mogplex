alter table public.repos
  add column if not exists snapshot_id text,
  add column if not exists snapshot_lockfile_hash text,
  add column if not exists snapshot_created_at timestamptz,
  add column if not exists snapshot_commit_sha text;

create index if not exists idx_repos_snapshot_id
  on public.repos (snapshot_id)
  where snapshot_id is not null;
