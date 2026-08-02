-- Team-owned project/repo foundation.
--
-- Keep legacy user_id columns for backward compatibility, but make ownership
-- explicit so team-scoped API routes can list and create shared resources.
--
-- This file contains the transactional DDL + backfill + check constraints.
-- The CREATE/DROP INDEX CONCURRENTLY operations live in a separate migration
-- file (20260518210100_team_owned_projects_indexes.sql) because they cannot
-- run inside a pipeline / transaction and `supabase db push` runs every
-- statement in a single file as one pipeline.

alter table public.workspaces
  add column if not exists owner_type text not null default 'user'
    check (owner_type in ('user', 'team')),
  add column if not exists owner_user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists product_team_id uuid references public.teams(id) on delete cascade,
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null;

alter table public.repos
  add column if not exists owner_type text not null default 'user'
    check (owner_type in ('user', 'team')),
  add column if not exists owner_user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists product_team_id uuid references public.teams(id) on delete cascade,
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null;

update public.workspaces
set
  owner_type = 'user',
  owner_user_id = coalesce(owner_user_id, user_id),
  product_team_id = null,
  created_by_user_id = coalesce(created_by_user_id, user_id)
where owner_type = 'user'
  and (
    owner_user_id is null
    or created_by_user_id is null
    or product_team_id is not null
  );

update public.repos
set
  owner_type = 'user',
  owner_user_id = coalesce(owner_user_id, user_id),
  product_team_id = null,
  created_by_user_id = coalesce(created_by_user_id, user_id)
where owner_type = 'user'
  and (
    owner_user_id is null
    or created_by_user_id is null
    or product_team_id is not null
  );

alter table public.workspaces
  drop constraint if exists workspaces_owner_shape_check,
  add constraint workspaces_owner_shape_check check (
    (owner_type = 'user' and owner_user_id is not null and product_team_id is null)
    or
    (owner_type = 'team' and owner_user_id is null and product_team_id is not null)
  ) not valid;

alter table public.repos
  drop constraint if exists repos_owner_shape_check,
  add constraint repos_owner_shape_check check (
    (owner_type = 'user' and owner_user_id is not null and product_team_id is null)
    or
    (owner_type = 'team' and owner_user_id is null and product_team_id is not null)
  ) not valid;

alter table public.workspaces validate constraint workspaces_owner_shape_check;
alter table public.repos validate constraint repos_owner_shape_check;
