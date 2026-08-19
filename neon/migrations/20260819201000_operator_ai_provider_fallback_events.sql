create table if not exists public.operator_ai_provider_fallback_events (
  id bigint generated always as identity primary key,
  affected_user_id uuid null references public.profiles(id) on delete set null,
  job_run_id uuid null references public.job_runs(id) on delete set null,
  repo_id uuid null references public.repos(id) on delete set null,
  model_call_started_at timestamptz not null,
  phase text not null check (char_length(trim(phase)) > 0),
  requested_model_id text null,
  pinned_model_id text null,
  served_provider text not null check (char_length(trim(served_provider)) > 0),
  fallback_providers text[] not null default '{}',
  blackbox_failure_count integer not null check (blackbox_failure_count > 0),
  blackbox_failure_status_codes integer[] not null default '{}',
  blackbox_provider_timeout boolean not null default false,
  gateway_model_attempt_count integer not null
    check (gateway_model_attempt_count > 0),
  generation_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists operator_ai_provider_fallback_call_key
  on public.operator_ai_provider_fallback_events (
    job_run_id,
    phase,
    model_call_started_at
  );

create index if not exists operator_ai_provider_fallback_created_idx
  on public.operator_ai_provider_fallback_events (created_at desc);

create index if not exists operator_ai_provider_fallback_user_created_idx
  on public.operator_ai_provider_fallback_events (
    affected_user_id,
    created_at desc
  );

alter table public.operator_ai_provider_fallback_events
  enable row level security;

revoke all on table public.operator_ai_provider_fallback_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.operator_ai_provider_fallback_events
  to service_role;

revoke all on sequence public.operator_ai_provider_fallback_events_id_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.operator_ai_provider_fallback_events_id_seq
  to service_role;

comment on table public.operator_ai_provider_fallback_events is
  'Operator-only Blackbox fallback diagnostics. Never expose through user-facing APIs, observability metadata, or product metrics.';
