-- Let each account choose whether the decision layer runs for it. The layer
-- sends short excerpts of commands, tool output, and final messages to an
-- evaluation model, so it is a choice made once per team by an owner or
-- admin, and per profile for work outside a team.
--
-- Additive only: both columns default to true, which is the behavior every
-- account has today, and nothing the deployed app or workers read or write
-- changes. Adding a column with a constant default does not rewrite the table.
alter table public.teams
  add column if not exists decision_checks_enabled boolean not null default true;

alter table public.profiles
  add column if not exists decision_checks_enabled boolean not null default true;

comment on column public.teams.decision_checks_enabled is
  'When false, the decision layer and automation Classify nodes never run for work in this team.';
comment on column public.profiles.decision_checks_enabled is
  'When false, the decision layer and automation Classify nodes never run for this person''s work outside a team.';
