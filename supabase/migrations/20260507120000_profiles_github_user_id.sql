-- Persist GitHub's numeric user id alongside the login so we can author
-- sandbox commits with the canonical <id>+<login>@users.noreply.github.com
-- form, which Vercel matches against team-member GitHub accounts when
-- gating preview deploys.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS github_user_id BIGINT;
