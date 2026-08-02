-- Enforce that a stored default_vercel_team_id always pairs with a
-- default_vercel_project_id. Clearing the project must clear the team to
-- avoid a ghost team scope surfacing in billing resolution.
--
-- Wrapped in an explicit transaction so the orphan-clearing UPDATE and the
-- ADD CONSTRAINT land atomically. If anything in the file fails, we don't
-- want partial cleanup with no enforcement going forward.

begin;

update profiles
  set default_vercel_team_id = null
  where default_vercel_project_id is null
    and default_vercel_team_id is not null;

alter table profiles
  add constraint profiles_default_vercel_team_requires_project
  check (
    default_vercel_project_id is not null
    or default_vercel_team_id is null
  );

commit;
