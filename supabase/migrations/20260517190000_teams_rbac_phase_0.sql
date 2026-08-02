-- Teams + RBAC Phase 0 (issue #557).
-- Schema: teams, team_members, team_invites, team_provider_keys, profiles.slug.
-- Solo workflows stay user-scoped; teams are opt-in.

-- ---------------------------------------------------------------
-- 1. Slug validation + reserved list (DB-side fail-closed)
--    Keep in sync with lib/reserved-slugs.ts.
-- ---------------------------------------------------------------

create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(p_slug) = any (array[
    -- existing top-level routes
    'api','auth','cli-auth','conduct','install','login',
    'privacy','request-access','slack','terms','unsubscribe',
    -- future reservations
    'new','invite','account','admin','support','status',
    -- infra / static
    'favicon.ico','robots.txt','sitemap.xml','opengraph-image',
    'apple-icon','icon','manifest.webmanifest',
    'global-error','not-found','error'
  ]);
$$;

-- GitHub-style: 1-39 chars, [a-z0-9-], no leading/trailing/consecutive hyphens.
create or replace function public.is_valid_scope_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_slug ~ '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$';
$$;

-- ---------------------------------------------------------------
-- 2. profiles.slug column
-- ---------------------------------------------------------------

alter table public.profiles
  add column if not exists slug text;

create unique index if not exists profiles_slug_key
  on public.profiles (slug)
  where slug is not null;

-- ---------------------------------------------------------------
-- 3. teams + memberships + invites + provider keys
-- ---------------------------------------------------------------

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 80),
  slug          text not null,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists teams_slug_key on public.teams (slug);
create index if not exists teams_owner_user_id_idx on public.teams (owner_user_id);

create table if not exists public.team_members (
  team_id             uuid not null references public.teams(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  role                text not null check (role in ('owner','admin','developer','viewer')),
  invited_by_user_id  uuid references public.profiles(id) on delete set null,
  joined_at           timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx on public.team_members (user_id);

create table if not exists public.team_invites (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams(id) on delete cascade,
  email               text not null,
  role                text not null check (role in ('admin','developer','viewer')),
  token               text not null unique,
  invited_by_user_id  uuid references public.profiles(id) on delete set null,
  expires_at          timestamptz not null default (now() + interval '7 days'),
  accepted_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists team_invites_team_id_idx on public.team_invites (team_id);
create index if not exists team_invites_email_idx on public.team_invites (lower(email))
  where accepted_at is null;

-- Mirror provider_keys: vault_secret_id, no encrypted material on row.
-- CHECK list mirrors provider_keys_provider_check (20260427120000_provider_keys_openrouter.sql).
create table if not exists public.team_provider_keys (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  provider        text not null check (provider in ('ai_gateway','anthropic','openai','openrouter')),
  vault_secret_id uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (team_id, provider)
);

-- ---------------------------------------------------------------
-- 4. updated_at triggers (project convention: <table>_set_updated_at).
-- ---------------------------------------------------------------

create or replace function public.teams_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.teams_set_updated_at();

create or replace function public.team_provider_keys_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists team_provider_keys_set_updated_at on public.team_provider_keys;
create trigger team_provider_keys_set_updated_at
  before update on public.team_provider_keys
  for each row execute function public.team_provider_keys_set_updated_at();

-- ---------------------------------------------------------------
-- 5. Owner-seed trigger: every team gets an owner row on insert.
--    SECURITY DEFINER so it bypasses team_members RLS — the creator
--    is not yet a member, so is_team_admin() would reject the insert.
-- ---------------------------------------------------------------

create or replace function public.tg_team_seed_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_members (team_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (team_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists teams_seed_owner on public.teams;
create trigger teams_seed_owner
  after insert on public.teams
  for each row execute function public.tg_team_seed_owner();

-- ---------------------------------------------------------------
-- 6. Owner-floor trigger: never let the last owner be removed or
--    demoted (locked decision #6: blocked until ownership transferred).
--    Short-circuits when the parent team is gone (cascade delete).
-- ---------------------------------------------------------------

create or replace function public.tg_team_members_owner_floor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_remaining_owners int;
begin
  v_team_id := coalesce(old.team_id, new.team_id);

  -- Cascade from team delete: the team row is gone, allow.
  if not exists (select 1 from public.teams where id = v_team_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and old.role = 'owner' and new.role = 'owner' then
    return new;
  end if;

  if tg_op = 'DELETE' and old.role <> 'owner' then
    return old;
  end if;
  if tg_op = 'UPDATE' and old.role <> 'owner' then
    return new;
  end if;

  select count(*) into v_remaining_owners
  from public.team_members
  where team_id = v_team_id
    and role = 'owner'
    and user_id <> old.user_id;

  if v_remaining_owners = 0 then
    raise exception 'cannot remove or demote the last owner of team %', v_team_id
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists team_members_owner_floor on public.team_members;
create trigger team_members_owner_floor
  before update or delete on public.team_members
  for each row execute function public.tg_team_members_owner_floor();

-- ---------------------------------------------------------------
-- 7. Slug-guard triggers: reserved-list + cross-table uniqueness.
-- ---------------------------------------------------------------

-- SECURITY DEFINER: cross-table reads below must bypass profiles/teams
-- RLS, otherwise a user who can't see another user's profile (or a team
-- they're not in) would pass the uniqueness check and create a duplicate
-- slug across the namespace.
create or replace function public.assert_slug_available(
  p_slug    text,
  p_kind    text,    -- 'profile' | 'team'
  p_self_id uuid     -- id of the row being upserted; null on insert
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_slug is null then
    return;
  end if;

  if not public.is_valid_scope_slug(p_slug) then
    raise exception 'invalid slug %: must match [a-z0-9-], 1-39 chars, no leading/trailing/double hyphens', p_slug
      using errcode = 'check_violation';
  end if;

  if public.is_reserved_slug(p_slug) then
    raise exception 'slug % is reserved', p_slug
      using errcode = 'check_violation';
  end if;

  if p_kind = 'profile' then
    if exists (select 1 from public.teams where slug = p_slug) then
      raise exception 'slug % already taken by a team', p_slug using errcode = 'unique_violation';
    end if;
  elsif p_kind = 'team' then
    if exists (
      select 1 from public.profiles
      where slug = p_slug and (p_self_id is null or id <> p_self_id)
    ) then
      raise exception 'slug % already taken by a personal account', p_slug using errcode = 'unique_violation';
    end if;
  end if;
end;
$$;

create or replace function public.tg_profiles_slug_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;
  perform public.assert_slug_available(new.slug, 'profile', new.id);
  return new;
end;
$$;

drop trigger if exists profiles_slug_guard on public.profiles;
create trigger profiles_slug_guard
  before insert or update of slug on public.profiles
  for each row execute function public.tg_profiles_slug_guard();

create or replace function public.tg_teams_slug_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;
  perform public.assert_slug_available(new.slug, 'team', new.id);
  return new;
end;
$$;

drop trigger if exists teams_slug_guard on public.teams;
create trigger teams_slug_guard
  before insert or update of slug on public.teams
  for each row execute function public.tg_teams_slug_guard();

-- ---------------------------------------------------------------
-- 8. Role helpers (mirror current_profile_id() pattern).
-- ---------------------------------------------------------------

create or replace function public.user_team_role(p_team_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = public.current_profile_id()
  limit 1
$$;

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_team_role(p_team_id) is not null
$$;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_team_role(p_team_id) in ('owner','admin')
$$;

-- ---------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------

alter table public.teams              enable row level security;
alter table public.team_members       enable row level security;
alter table public.team_invites       enable row level security;
alter table public.team_provider_keys enable row level security;

-- teams: members read; admins+ update; only owners delete; any authed user inserts (becomes owner via seed trigger)
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select using (public.is_team_member(id));

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams
  for insert with check (owner_user_id = public.current_profile_id());

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams
  for update using (public.is_team_admin(id))
  with check (public.is_team_admin(id));

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams
  for delete using (public.user_team_role(id) = 'owner');

-- team_members: visible to fellow members; admins+ mutate
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select using (public.is_team_member(team_id));

drop policy if exists team_members_write on public.team_members;
create policy team_members_write on public.team_members
  for all using (public.is_team_admin(team_id))
  with check (public.is_team_admin(team_id));

-- team_invites: admin-only end-to-end
drop policy if exists team_invites_admin on public.team_invites;
create policy team_invites_admin on public.team_invites
  for all using (public.is_team_admin(team_id))
  with check (public.is_team_admin(team_id));

-- team_provider_keys: members see which providers are configured (not values);
-- writes go through SECURITY DEFINER RPCs only — no insert/update/delete policies.
drop policy if exists team_provider_keys_select on public.team_provider_keys;
create policy team_provider_keys_select on public.team_provider_keys
  for select using (public.is_team_member(team_id));

-- ---------------------------------------------------------------
-- 10. Vault RPCs for team-shared keys (mirror provider_keys RPCs).
--     No auth check inside — only callable via service-role
--     (supabaseAdmin) from server code; app layer enforces admin role.
-- ---------------------------------------------------------------

create or replace function public.store_team_provider_key(
  p_team_id  uuid,
  p_provider text,
  p_key      text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id      uuid;
begin
  select vault_secret_id into v_existing_secret_id
  from public.team_provider_keys
  where team_id = p_team_id and provider = p_provider;

  if v_existing_secret_id is not null then
    delete from vault.secrets where id = v_existing_secret_id;
  end if;

  insert into vault.secrets (secret, name, description)
  values (
    p_key,
    'team:' || p_team_id || '/' || p_provider,
    'Team-shared API key for ' || p_provider
  )
  returning id into v_new_secret_id;

  insert into public.team_provider_keys (team_id, provider, vault_secret_id, updated_at)
  values (p_team_id, p_provider, v_new_secret_id, now())
  on conflict (team_id, provider)
  do update set vault_secret_id = v_new_secret_id, updated_at = now();
end;
$$;

create or replace function public.get_team_provider_key(
  p_team_id  uuid,
  p_provider text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
  v_decrypted text;
begin
  select vault_secret_id into v_secret_id
  from public.team_provider_keys
  where team_id = p_team_id and provider = p_provider;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_decrypted
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_decrypted;
end;
$$;

create or replace function public.delete_team_provider_key(
  p_team_id  uuid,
  p_provider text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.team_provider_keys
  where team_id = p_team_id and provider = p_provider;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    delete from public.team_provider_keys where team_id = p_team_id and provider = p_provider;
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 11. Backfill profiles.slug for existing users.
--     Source order: github_username → email local-part → 'user'.
--     On collision (with another profile OR a team): append -2, -3, ...
--     Reserved/invalid sources fall back to 'user'.
-- ---------------------------------------------------------------

do $$
declare
  r           record;
  v_base      text;
  v_candidate text;
  v_n         int;
begin
  for r in
    select id, github_username, email
    from public.profiles
    where slug is null
    order by created_at nulls last, id
  loop
    v_base := lower(coalesce(
      nullif(regexp_replace(coalesce(r.github_username,''), '[^a-z0-9-]', '-', 'gi'), ''),
      nullif(regexp_replace(split_part(coalesce(r.email,''), '@', 1), '[^a-z0-9-]', '-', 'gi'), ''),
      'user'
    ));
    v_base := regexp_replace(v_base, '-+', '-', 'g');
    v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
    v_base := left(v_base, 39);
    if v_base = '' or not public.is_valid_scope_slug(v_base) or public.is_reserved_slug(v_base) then
      v_base := 'user';
    end if;

    v_candidate := v_base;
    v_n := 1;
    while
      exists (select 1 from public.profiles where slug = v_candidate)
      or exists (select 1 from public.teams    where slug = v_candidate)
    loop
      v_n := v_n + 1;
      v_candidate := left(v_base, 39 - length('-' || v_n::text)) || '-' || v_n::text;
    end loop;

    update public.profiles set slug = v_candidate where id = r.id;
  end loop;
end $$;
