-- Disambiguate the team_members → profiles embed for PostgREST.
--
-- team_members has two FKs into profiles(id):
--   user_id            (the member)
--   invited_by_user_id (the inviter, audit-only)
--
-- PostgREST refuses to embed when more than one relationship exists, so
-- `profile:profiles(...)` in app/api/teams/[teamId]/members/route.ts returns
-- PGRST201 and the handler responds with 500 ("Unable to load members").
--
-- No app code reads team_members.invited_by_user_id today — it is only written
-- on invite acceptance — so we drop that FK and preserve the prior
-- ON DELETE SET NULL behavior with a trigger on profiles.

alter table public.team_members
  drop constraint if exists team_members_invited_by_user_id_fkey;

create or replace function public.tg_profiles_null_team_members_invited_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_members
     set invited_by_user_id = null
   where invited_by_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists profiles_null_team_members_invited_by on public.profiles;
create trigger profiles_null_team_members_invited_by
  before delete on public.profiles
  for each row execute function public.tg_profiles_null_team_members_invited_by();
