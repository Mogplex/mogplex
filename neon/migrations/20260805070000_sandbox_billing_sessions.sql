-- Sandbox compute is billed per Vercel provider session, not per durable
-- Mogplex sandbox row. Persistent resume and restart can replace the provider
-- session while keeping the same sandbox record.

alter table public.billing_accounts
  add column if not exists sandbox_usage_remainder_units bigint not null default 0;

alter table public.billing_accounts
  drop constraint if exists billing_accounts_sandbox_usage_remainder_check;
alter table public.billing_accounts
  add constraint billing_accounts_sandbox_usage_remainder_check
  check (
    -- usage units are elapsed milliseconds multiplied by micro-USD/minute.
    -- One cent is 10,000 micro-USD over a 60,000ms minute.
    sandbox_usage_remainder_units >= 0
    and sandbox_usage_remainder_units < 600000000
  );

create table if not exists public.sandbox_billing_sessions (
  id uuid primary key default gen_random_uuid(),
  sandbox_record_id uuid not null,
  vercel_sandbox_id text not null,
  vercel_session_id text not null unique,
  account_id uuid not null references public.billing_accounts (id) on delete restrict,
  billing_source text not null default 'platform' check (billing_source = 'platform'),
  actor_user_id uuid not null,
  product_team_id uuid,
  state text not null default 'open'
    check (state in ('open', 'closing', 'closed', 'closed_unmetered')),
  started_at timestamptz not null,
  metered_through_at timestamptz not null,
  close_generation bigint not null default 0 check (close_generation >= 0),
  close_requested_at timestamptz,
  ended_at timestamptz,
  rate_micro_usd_per_minute bigint not null
    check (rate_micro_usd_per_minute > 0),
  usage_units bigint not null default 0 check (usage_units >= 0),
  billed_cents bigint not null default 0 check (billed_cents >= 0),
  accrual_seq bigint not null default 0 check (accrual_seq >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sandbox_billing_session_clock_check
    check (metered_through_at >= started_at),
  constraint sandbox_billing_session_end_check
    check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists sandbox_billing_sessions_active_record_key
  on public.sandbox_billing_sessions (sandbox_record_id)
  where state in ('open', 'closing');
create index if not exists sandbox_billing_sessions_active_meter_idx
  on public.sandbox_billing_sessions (metered_through_at, id)
  where state in ('open', 'closing');
create index if not exists sandbox_billing_sessions_account_created_idx
  on public.sandbox_billing_sessions (account_id, created_at desc);

alter table public.sandbox_billing_sessions enable row level security;

create or replace function public.prevent_active_sandbox_billing_session_delete()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.sandbox_billing_sessions
    where sandbox_record_id = old.id and state in ('open', 'closing')
  ) then
    raise exception 'sandbox % has an active billing session', old.id;
  end if;
  return old;
end;
$$;

drop trigger if exists sandboxes_active_billing_delete_guard on public.sandboxes;
create trigger sandboxes_active_billing_delete_guard
before delete on public.sandboxes
for each row execute function public.prevent_active_sandbox_billing_session_delete();

create or replace function public.open_sandbox_billing_session(
  p_sandbox_record uuid,
  p_vercel_sandbox_id text,
  p_vercel_session_id text,
  p_account uuid,
  p_actor_user uuid,
  p_product_team uuid,
  p_started_at timestamptz,
  p_rate_micro_usd_per_minute bigint
) returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_existing public.sandbox_billing_sessions%rowtype;
  v_sandbox public.sandboxes%rowtype;
  v_account public.billing_accounts%rowtype;
begin
  if nullif(trim(p_vercel_sandbox_id), '') is null then
    raise exception 'Vercel sandbox id is required';
  end if;
  if nullif(trim(p_vercel_session_id), '') is null then
    raise exception 'Vercel session id is required';
  end if;
  if p_started_at is null then
    raise exception 'sandbox billing session start is required';
  end if;
  if p_actor_user is null then
    raise exception 'sandbox billing actor is required';
  end if;
  if p_rate_micro_usd_per_minute is null
    or p_rate_micro_usd_per_minute <= 0
  then
    raise exception 'sandbox billing rate must be positive';
  end if;

  select * into v_sandbox from public.sandboxes
  where id = p_sandbox_record
  for key share;
  if not found then
    raise exception 'sandbox record % not found', p_sandbox_record;
  end if;
  if v_sandbox.billing_source is distinct from 'platform' then
    raise exception 'sandbox record % is not platform billed', p_sandbox_record;
  end if;
  if v_sandbox.sandbox_id <> trim(p_vercel_sandbox_id) then
    raise exception 'sandbox record % provider id mismatch', p_sandbox_record;
  end if;
  if coalesce(v_sandbox.actor_user_id, v_sandbox.user_id) <> p_actor_user then
    raise exception 'sandbox record % actor mismatch', p_sandbox_record;
  end if;
  if v_sandbox.product_team_id is distinct from p_product_team then
    raise exception 'sandbox record % product team mismatch', p_sandbox_record;
  end if;

  select * into v_account from public.billing_accounts
  where id = p_account
  for key share;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;
  if p_product_team is null and not (
    v_account.owner_type = 'user'
    and v_account.owner_user_id = p_actor_user
    and v_account.product_team_id is null
  ) then
    raise exception 'billing account % personal scope mismatch', p_account;
  end if;
  if p_product_team is not null and not (
    v_account.owner_type = 'team'
    and v_account.owner_user_id is null
    and v_account.product_team_id = p_product_team
  ) then
    raise exception 'billing account % team scope mismatch', p_account;
  end if;

  insert into public.sandbox_billing_sessions (
    sandbox_record_id,
    vercel_sandbox_id,
    vercel_session_id,
    account_id,
    actor_user_id,
    product_team_id,
    started_at,
    metered_through_at,
    rate_micro_usd_per_minute
  ) values (
    p_sandbox_record,
    trim(p_vercel_sandbox_id),
    trim(p_vercel_session_id),
    p_account,
    p_actor_user,
    p_product_team,
    p_started_at,
    p_started_at,
    p_rate_micro_usd_per_minute
  ) on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select * into v_existing
  from public.sandbox_billing_sessions
  where vercel_session_id = trim(p_vercel_session_id);

  if found then
    if v_existing.sandbox_record_id <> p_sandbox_record
      or v_existing.vercel_sandbox_id <> trim(p_vercel_sandbox_id)
      or v_existing.account_id <> p_account
      or v_existing.actor_user_id <> p_actor_user
      or v_existing.product_team_id is distinct from p_product_team
      or v_existing.started_at <> p_started_at
      or v_existing.rate_micro_usd_per_minute <> p_rate_micro_usd_per_minute
    then
      raise exception 'Vercel session % billing identity mismatch', p_vercel_session_id;
    end if;
    return v_existing.id;
  end if;

  raise exception 'sandbox record % already has an active billing session',
    p_sandbox_record;
end;
$$;

create or replace function public.request_sandbox_billing_session_close(
  p_session uuid,
  p_requested_at timestamptz default now()
) returns bigint language plpgsql as $$
declare
  v_generation bigint;
begin
  update public.sandbox_billing_sessions
  set state = 'closing',
      close_generation = close_generation + 1,
      close_requested_at = p_requested_at,
      updated_at = now()
  where id = p_session and state = 'open'
  returning close_generation into v_generation;

  if found then
    return v_generation;
  end if;

  select close_generation into v_generation
  from public.sandbox_billing_sessions
  where id = p_session and state = 'closing';
  return v_generation;
end;
$$;

create or replace function public.reopen_sandbox_billing_session(
  p_session uuid,
  p_close_generation bigint
) returns boolean language plpgsql as $$
begin
  update public.sandbox_billing_sessions
  set state = 'open', close_requested_at = null, updated_at = now()
  where id = p_session
    and state = 'closing'
    and close_generation = p_close_generation;
  return found;
end;
$$;

create or replace function public.accrue_sandbox_billing_session(
  p_session uuid,
  p_through timestamptz,
  p_final boolean default false,
  p_close_generation bigint default null
) returns table (
  accrued boolean,
  debited_cents bigint,
  metered_through_at timestamptz,
  session_state text
) language plpgsql as $$
declare
  v_session public.sandbox_billing_sessions%rowtype;
  v_target timestamptz;
  v_delta_ms bigint;
  v_delta_units bigint;
  v_remainder_units bigint;
  v_total_units bigint;
  v_debit_cents bigint;
  v_next_seq bigint;
  v_debit_posted boolean;
begin
  if p_through is null then
    raise exception 'sandbox billing accrual time is required';
  end if;

  select * into v_session
  from public.sandbox_billing_sessions
  where id = p_session
  for update;
  if not found then
    raise exception 'sandbox billing session % not found', p_session;
  end if;

  if v_session.state in ('closed', 'closed_unmetered') then
    return query select false, 0::bigint, v_session.metered_through_at,
      v_session.state;
    return;
  end if;

  if p_final and (
    v_session.state <> 'closing'
    or p_close_generation is null
    or v_session.close_generation <> p_close_generation
  ) then
    return query select false, 0::bigint, v_session.metered_through_at,
      v_session.state;
    return;
  end if;

  v_target := greatest(
    p_through,
    v_session.started_at,
    v_session.metered_through_at
  );
  if p_final then
    v_target := greatest(v_target, v_session.started_at + interval '1 minute');
  end if;

  v_delta_ms := floor(
    extract(epoch from (v_target - v_session.metered_through_at)) * 1000
  )::bigint;
  if v_delta_ms = 0 and not p_final then
    return query select false, 0::bigint, v_session.metered_through_at,
      v_session.state;
    return;
  end if;

  v_delta_units := v_delta_ms * v_session.rate_micro_usd_per_minute;
  v_next_seq := v_session.accrual_seq + 1;

  select sandbox_usage_remainder_units into v_remainder_units
  from public.billing_accounts
  where id = v_session.account_id
  for update;
  if not found then
    raise exception 'billing account % not found', v_session.account_id;
  end if;

  v_total_units := v_remainder_units + v_delta_units;
  v_debit_cents := v_total_units / 600000000;
  v_remainder_units := v_total_units % 600000000;

  update public.billing_accounts
  set sandbox_usage_remainder_units = v_remainder_units,
      updated_at = now()
  where id = v_session.account_id;

  if v_debit_cents > 0 then
    select posted into v_debit_posted
    from public.post_billing_usage_debit(
      v_session.account_id,
      v_debit_cents,
      'usage_sandbox',
      'sbx:' || v_session.vercel_session_id || ':a:' || v_next_seq,
      to_char(v_target at time zone 'UTC', 'YYYY-MM'),
      jsonb_build_object(
        'sandbox_record_id', v_session.sandbox_record_id,
        'vercel_sandbox_id', v_session.vercel_sandbox_id,
        'vercel_session_id', v_session.vercel_session_id,
        'actor_user_id', v_session.actor_user_id,
        'product_team_id', v_session.product_team_id,
        'rate_micro_usd_per_minute', v_session.rate_micro_usd_per_minute,
        'accrual_seq', v_next_seq,
        'accrued_ms', v_delta_ms
      )
    );
    if not coalesce(v_debit_posted, false) then
      raise exception 'sandbox billing debit source collision for session %',
        v_session.vercel_session_id;
    end if;
  end if;

  update public.sandbox_billing_sessions
  set metered_through_at = v_target,
      usage_units = usage_units + v_delta_units,
      billed_cents = billed_cents + v_debit_cents,
      accrual_seq = v_next_seq,
      state = case when p_final then 'closed' else state end,
      ended_at = case when p_final then v_target else ended_at end,
      updated_at = now()
  where id = p_session;

  return query select (v_delta_ms > 0 or p_final), v_debit_cents, v_target,
    case when p_final then 'closed'::text else v_session.state end;
end;
$$;

create or replace function public.finalize_sandbox_billing_session_unmetered(
  p_session uuid,
  p_ended_at timestamptz,
  p_close_generation bigint
) returns boolean language plpgsql as $$
begin
  update public.sandbox_billing_sessions
  set state = 'closed_unmetered',
      ended_at = greatest(p_ended_at, started_at, metered_through_at),
      updated_at = now()
  where id = p_session
    and state = 'closing'
    and close_generation = p_close_generation;
  return found;
end;
$$;
