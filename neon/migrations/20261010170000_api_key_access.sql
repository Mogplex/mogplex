-- What a Mogplex API key (mog_) may do, chosen in the app.
--
-- user_api_keys.access is set by the person who owns the key:
--   'full'        the key can do what its scopes allow, as it can today
--   'automations' the key can read, and can start work only by triggering an
--                 automation with an API trigger
--
-- teams.api_key_access is set by a team owner and covers keys acting on the
-- team's repositories: 'automations' holds every member's key to the
-- automation-only rule there, whatever the key itself allows.
--
-- Additive only: both columns default to 'full', which is the behavior every
-- key and team has today, so the deployed app and workers keep working.
-- Adding a column with a constant default does not rewrite the table.
alter table public.user_api_keys
  add column if not exists access text not null default 'full'
    check (access in ('full', 'automations'));

alter table public.teams
  add column if not exists api_key_access text not null default 'full'
    check (api_key_access in ('full', 'automations'));

comment on column public.user_api_keys.access is
  'full: the key can do what its scopes allow. automations: the key reads and starts work only through automations with an API trigger.';
comment on column public.teams.api_key_access is
  'Set by a team owner. automations: members'' keys start work on this team''s repositories only through automations with an API trigger.';
