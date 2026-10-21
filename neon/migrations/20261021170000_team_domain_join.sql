-- Opt-in team enrollment uses Better Auth's verified email, never profile or
-- GitHub organization claims. Existing memberships and roles are preserved.
alter table public.teams add column signup_email_domain text;
alter table public.teams add constraint teams_signup_email_domain_check check (
  signup_email_domain is null or (
    signup_email_domain = lower(signup_email_domain)
    and signup_email_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  )
);
create index teams_signup_email_domain_idx on public.teams(signup_email_domain)
where signup_email_domain is not null;

-- Removing a member must remain effective even while domain joining is on.
create table public.team_domain_join_blocks (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (team_id, user_id)
);
alter table public.team_domain_join_blocks enable row level security;
revoke all on public.team_domain_join_blocks from public;
grant select, insert, update, delete on public.team_domain_join_blocks to service_role;

create function public.enroll_verified_email_teams(p_auth_user_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  with added as (
    insert into public.team_members (team_id, user_id, role)
    select t.id, p.id, 'developer'
    from public."user" u
    join public.profiles p on p.auth_user_id = u.id
    join public.teams t on t.signup_email_domain = lower(split_part(u.email, '@', 2))
    where u.id = p_auth_user_id and u."emailVerified" = true
      and u.email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
      and not exists (
        select 1 from public.team_domain_join_blocks b
        where b.team_id = t.id and b.user_id = p.id
      )
    on conflict (team_id, user_id) do nothing
    returning team_id, user_id
  )
  insert into public.team_audit_events (team_id, actor_user_id, action, target_type, target_id, payload)
  select team_id, user_id, 'member.joined_by_domain', 'member', user_id::text,
    jsonb_build_object('role', 'developer') from added;
end;
$$;
revoke all on function public.enroll_verified_email_teams(uuid) from public;
grant execute on function public.enroll_verified_email_teams(uuid) to service_role;

create function public.tg_enroll_verified_email_teams()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'profiles' then
    perform public.enroll_verified_email_teams(new.auth_user_id);
  elsif tg_table_name = 'session' then
    perform public.enroll_verified_email_teams(new."userId");
  else
    perform public.enroll_verified_email_teams(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.tg_enroll_verified_email_teams() from public;
grant execute on function public.tg_enroll_verified_email_teams() to service_role;

create trigger profiles_join_email_teams after insert on public.profiles
for each row execute function public.tg_enroll_verified_email_teams();
create trigger sessions_join_email_teams after insert on public.session
for each row execute function public.tg_enroll_verified_email_teams();
create trigger verified_users_join_email_teams after update of "emailVerified", email on public."user"
for each row when (new."emailVerified" = true)
execute function public.tg_enroll_verified_email_teams();

create function public.tg_block_removed_domain_member()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Parent deletion cascades should not create a new FK to a deleted row.
  if exists (select 1 from public.teams where id = old.team_id)
    and exists (select 1 from public.profiles where id = old.user_id) then
    insert into public.team_domain_join_blocks (team_id, user_id)
    values (old.team_id, old.user_id) on conflict do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.tg_block_removed_domain_member() from public;
grant execute on function public.tg_block_removed_domain_member() to service_role;
create trigger removed_members_block_domain_join after delete on public.team_members
for each row execute function public.tg_block_removed_domain_member();

-- Retained Supabase installations have these roles; fresh Neon installs do not.
do $client_roles$
declare client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = client_role) then
      execute format('revoke all on public.team_domain_join_blocks from %I', client_role);
      execute format('revoke all on function public.enroll_verified_email_teams(uuid), public.tg_enroll_verified_email_teams(), public.tg_block_removed_domain_member() from %I', client_role);
    end if;
  end loop;
end;
$client_roles$;
