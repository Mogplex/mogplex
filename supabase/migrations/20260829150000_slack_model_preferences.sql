-- Slack slash-command model preferences. A selection belongs to one Slack
-- user in one channel so it never changes another participant's preference.

create table if not exists public.slack_model_preferences (
  id uuid primary key default gen_random_uuid(),
  slack_installation_id uuid not null
    references public.slack_installations(id) on delete cascade,
  channel_id text not null check (length(btrim(channel_id)) > 0),
  slack_user_id text not null check (length(btrim(slack_user_id)) > 0),
  model_id text not null references public.ai_models(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slack_model_preferences_scope_unique
    unique (slack_installation_id, channel_id, slack_user_id)
);

create index if not exists slack_model_preferences_model_idx
  on public.slack_model_preferences (model_id);

alter table public.slack_model_preferences enable row level security;
-- Service-role only. Slash commands are authenticated by Slack's request
-- signature and resolved to a linked Mogplex profile on the server.

revoke all on table public.slack_model_preferences from anon, authenticated;
grant select, insert, update on table public.slack_model_preferences
  to service_role;
