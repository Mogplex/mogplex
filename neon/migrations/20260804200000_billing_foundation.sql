-- Billing foundation (pricing-plan 02/03): app-owned prepaid ledger, Stripe
-- for money movement only. Ships dark — no code path writes here until the
-- STRIPE_* env keys are configured, and gating stays off during beta
-- (CLAUDE.md billing posture).

create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  -- Billing is scoped like every other resource: a personal (user) scope or
  -- a team scope. No FKs to the pre-cutover tables so this migration also
  -- applies cleanly to fresh environments built from neon/migrations alone.
  owner_type text not null check (owner_type in ('user', 'team')),
  owner_user_id uuid,
  product_team_id uuid,
  stripe_customer_id text unique,
  -- Support/debugging handle for the active subscription; synced by the
  -- webhook, derivable from the customer at any time.
  stripe_subscription_id text,
  -- Tier is synced from the active Stripe subscription price metadata by the
  -- webhook — never edited by hand, so Stripe and app cannot drift.
  tier text not null default 'free' check (tier in ('free', 'pro', 'team')),
  period_anchor date,
  auto_topup_enabled boolean not null default false,
  auto_topup_threshold_cents bigint not null default 500,
  auto_topup_amount_cents bigint not null default 2500,
  budget_cap_cents bigint,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'frozen_topups')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_accounts_owner_shape check (
    (owner_type = 'user' and owner_user_id is not null and product_team_id is null)
    or (owner_type = 'team' and product_team_id is not null and owner_user_id is null)
  )
);

create unique index if not exists billing_accounts_owner_user_key
  on public.billing_accounts (owner_user_id) where owner_type = 'user';
create unique index if not exists billing_accounts_product_team_key
  on public.billing_accounts (product_team_id) where owner_type = 'team';

-- Append-only: corrections are new rows, never updates. All money columns
-- are bigint cents — no floats anywhere in billing.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id),
  delta_cents bigint not null,
  bucket text not null check (bucket in ('included', 'purchased')),
  kind text not null check (kind in
    ('grant', 'grant_adjustment', 'grant_expiry', 'topup', 'usage_tokens',
     'usage_sandbox', 'refund', 'adjustment', 'beta_credit')),
  source_ref text not null,
  period text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists credit_ledger_source_ref_key
  on public.credit_ledger (source_ref);
create index if not exists credit_ledger_account_created_idx
  on public.credit_ledger (account_id, created_at desc);

-- Stripe webhook idempotency: event id is claimed (received_at) before
-- processing, marked processed_at on success. A claim with null
-- processed_at older than the takeover window is considered stuck and can
-- be re-claimed, so a crashed handler never permanently wedges an event.
create table if not exists public.billing_events (
  stripe_event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null
);

-- App access is service-role/pg-shim only (bypasses RLS); enabling RLS with
-- no policies makes the tables default-deny if any environment ever exposes
-- the public schema through PostgREST.
alter table public.billing_accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.billing_events enable row level security;

-- Balance and rollups stay RPCs (pricing-plan 03 §0). Billing lands on Neon
-- so the PostgREST-aggregates constraint technically drops, but the RPC
-- pattern is kept for consistency with the rest of the codebase.
create or replace function public.billing_balance(p_account uuid)
returns table (included_cents bigint, purchased_cents bigint, total_cents bigint)
language sql stable as $$
  select
    coalesce(sum(delta_cents) filter (where bucket = 'included'), 0)::bigint,
    coalesce(sum(delta_cents) filter (where bucket = 'purchased'), 0)::bigint,
    coalesce(sum(delta_cents), 0)::bigint
  from public.credit_ledger where account_id = p_account;
$$;

create or replace function public.billing_monthly_spend(p_account uuid, p_period text)
returns bigint language sql stable as $$
  select coalesce(-sum(delta_cents), 0)::bigint from public.credit_ledger
  where account_id = p_account
    and delta_cents < 0
    and kind in ('usage_tokens', 'usage_sandbox')
    and to_char(created_at at time zone 'utc', 'YYYY-MM') = p_period;
$$;
