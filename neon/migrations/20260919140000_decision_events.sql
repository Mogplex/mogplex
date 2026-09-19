-- Decision layer audit log. Every closed question the runtime asks an
-- evaluation model (command risk, tool-result checks, claim verification,
-- loop checks, memory promotion gating) lands here with the state it judged,
-- the answers and probabilities, any language-model second opinion, what the
-- system did without it (baseline), and whether the runtime acted on it.
-- The judged state is stored because run telemetry omits most tool inputs and
-- outputs; without it a decision could not be audited or re-scored.
-- Additive only: no existing table, function, or contract changes. All access
-- goes through the service role with explicit user_id filters.

create table if not exists public.decision_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  repo_id uuid references public.repos(id) on delete set null,
  ai_call_id uuid references public.ai_calls(id) on delete set null,
  conversation_id text,
  surface text not null,
  decision_id text not null,
  question_version text not null,
  mode text not null check (mode in ('shadow', 'advise', 'enforce')),
  status text not null check (status in ('ok', 'unavailable')),
  model text,
  state jsonb,
  questions jsonb,
  answers jsonb,
  confidence jsonb not null default '{}'::jsonb,
  verdict text,
  acted boolean not null default false,
  baseline jsonb,
  latency_ms integer,
  input_tokens integer,
  cost_usd numeric,
  escalated boolean not null default false,
  escalation_model text,
  escalation_answers jsonb,
  escalation_latency_ms integer,
  escalation_cost_usd numeric,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_decision_events_user_created
  on public.decision_events (user_id, created_at desc);

create index if not exists idx_decision_events_decision_created
  on public.decision_events (decision_id, created_at desc);

create index if not exists idx_decision_events_ai_call
  on public.decision_events (ai_call_id)
  where ai_call_id is not null;

alter table public.decision_events enable row level security;
-- Fresh databases may lack the Supabase-style roles; grants only apply
-- where they exist. Access goes through the service role either way.
do $$
begin
  if exists (select 1 from pg_roles where rolname in ('anon', 'authenticated')) then
    execute 'revoke all on table public.decision_events from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.decision_events to service_role';
  end if;
end
$$;
