-- Team-owned project/repo indexes.
--
-- Companion to 20260518210000_team_owned_projects.sql. These run inside
-- the normal `supabase db push` pipeline, so plain (non-CONCURRENTLY)
-- index DDL is used here. Tables are small enough that the brief write
-- lock is acceptable; if traffic grows enough that index builds need to
-- be online, switch to a one-off ops migration applied out of band.
--
-- Idempotent via `if not exists` / `if exists`, so re-running this file
-- against a database where the indexes already exist is a no-op.

create unique index if not exists workspaces_personal_default_idx
  on public.workspaces (owner_user_id)
  where owner_type = 'user' and is_default = true;

create unique index if not exists workspaces_team_default_idx
  on public.workspaces (product_team_id)
  where owner_type = 'team' and is_default = true;

create unique index if not exists workspaces_personal_name_key
  on public.workspaces (owner_user_id, lower(name))
  where owner_type = 'user';

create unique index if not exists workspaces_team_name_key
  on public.workspaces (product_team_id, lower(name))
  where owner_type = 'team';

create index if not exists workspaces_product_team_id_idx
  on public.workspaces (product_team_id, created_at);

create unique index if not exists repos_personal_github_root_directory_key
  on public.repos (owner_user_id, github_id, coalesce(root_directory, ''))
  where owner_type = 'user';

create unique index if not exists repos_team_github_root_directory_key
  on public.repos (product_team_id, github_id, coalesce(root_directory, ''))
  where owner_type = 'team';

create index if not exists repos_product_team_workspace_idx
  on public.repos (product_team_id, workspace_id);

drop index if exists public.workspaces_user_id_default_idx;
drop index if exists public.workspaces_user_id_name_key;
drop index if exists public.repos_user_id_github_id_root_directory_key;
