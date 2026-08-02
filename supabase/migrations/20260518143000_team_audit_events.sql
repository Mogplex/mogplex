-- Teams + RBAC Phase 5 (issue #580).
-- Team audit trail for administration and denied-action events.

alter table public.team_members
  add column if not exists id uuid not null default gen_random_uuid();

create unique index if not exists team_members_id_key
  on public.team_members (id);

create table if not exists public.team_audit_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  actor_user_id uuid null references public.profiles(id) on delete set null,
  actor_member_id uuid null references public.team_members(id) on delete set null,
  action text not null,
  decision_code text null,
  target_type text not null,
  target_id text null,
  repo_id uuid null references public.repos(id) on delete set null,
  sandbox_record_id uuid null references public.sandboxes(id) on delete set null,
  ai_call_id uuid null references public.ai_calls(id) on delete set null,
  job_run_id uuid null references public.job_runs(id) on delete set null,
  request_id text null,
  auth_source text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists team_audit_events_team_created_idx
  on public.team_audit_events (team_id, created_at desc);

create index if not exists team_audit_events_actor_created_idx
  on public.team_audit_events (actor_user_id, created_at desc);

create index if not exists team_audit_events_action_created_idx
  on public.team_audit_events (action, created_at desc);

create index if not exists team_audit_events_decision_created_idx
  on public.team_audit_events (decision_code, created_at desc);

alter table public.team_audit_events enable row level security;

drop policy if exists team_audit_events_admin_select on public.team_audit_events;
create policy team_audit_events_admin_select on public.team_audit_events
  for select using (public.is_team_admin(team_id));

comment on table public.team_audit_events is
  'Team administration and denied-action audit events. Payloads must not contain secrets, plaintext invite tokens, provider keys, or prompts.';
