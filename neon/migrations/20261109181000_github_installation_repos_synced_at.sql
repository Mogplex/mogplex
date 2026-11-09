-- When Mogplex last synced an installation's full repository list. Settings →
-- Repositories shows the latest one next to Sync GitHub. Additive and nullable:
-- rows from before this column read as not synced yet.
alter table public.github_installations
  add column if not exists repos_synced_at timestamp with time zone;
