-- Store GitHub App user authorizations beside the existing OAuth grants. A
-- personal-account repository can only be created with a user token issued by
-- the GitHub App, so those grants need their own provider value. Expand only:
-- existing 'github' and 'vercel' rows and every reader of them are unchanged.
alter table public.oauth_tokens
  drop constraint oauth_tokens_provider_check;

alter table public.oauth_tokens
  add constraint oauth_tokens_provider_check
  check (provider = any (array['github'::text, 'vercel'::text, 'github_app'::text]));
