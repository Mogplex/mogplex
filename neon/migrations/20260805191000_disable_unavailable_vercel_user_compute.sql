-- Sign in with Vercel grants identity scopes only. Retire settings that could
-- otherwise keep routing sandbox work or env import through unavailable API
-- capabilities. Linked IDs are cleared because no supported runtime consumes
-- them after this migration.
update public.workspaces
set
  sandbox_billing_mode = 'platform',
  sandbox_vercel_team_id = null,
  sandbox_vercel_project_id = null,
  vercel_link_status = 'unknown',
  vercel_link_checked_at = null,
  vercel_link_error_code = null,
  vercel_link_message = null
where sandbox_billing_mode = 'user_vercel_project'
   or sandbox_vercel_team_id is not null
   or sandbox_vercel_project_id is not null;

update public.repos
set
  sandbox_billing_mode_override = null,
  sandbox_billing_target = 'personal',
  vercel_team_id = null,
  vercel_project_id = null,
  vercel_link_status = 'unknown',
  vercel_link_checked_at = null,
  vercel_link_error_code = null,
  vercel_link_message = null
where sandbox_billing_mode_override = 'user_vercel_project'
   or vercel_team_id is not null
   or vercel_project_id is not null;

update public.profiles
set
  default_vercel_project_id = null,
  default_vercel_team_id = null
where default_vercel_project_id is not null
   or default_vercel_team_id is not null;
