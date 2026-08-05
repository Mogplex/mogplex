-- Intentionally Neon-only: the billing foundation tables and RPCs live in
-- neon/migrations during the data-backend transition.
-- Opening and accrual share the billing-account row lock used by every ledger
-- mutation. This makes positive-balance admission atomic and turns
-- request-close into a hard barrier against scheduled non-final accruals.

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
  v_balance bigint;
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
  for update;
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

  select coalesce(sum(delta_cents), 0)::bigint into v_balance
  from public.credit_ledger
  where account_id = p_account;
  if v_balance <= 0 then
    raise exception using
      errcode = 'MP001',
      message = 'positive billing balance required for sandbox session';
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
    if v_existing.state not in ('open', 'closing') then
      raise exception 'Vercel session % billing row is already closed', p_vercel_session_id;
    end if;
    return v_existing.id;
  end if;

  raise exception 'sandbox record % already has an active billing session',
    p_sandbox_record;
end;
$$;

-- Recovery must query the actual crash gap, not slice the general sandbox
-- table and filter in application code. Otherwise a large population of
-- healthy metered rows can permanently hide an older unmetered provider.
alter table public.sandboxes
  add column if not exists sandbox_billing_recovery_checked_at timestamptz;

create index if not exists sandboxes_billing_recovery_cursor_idx
  on public.sandboxes (
    sandbox_billing_recovery_checked_at asc nulls first,
    last_active_at desc,
    id
  )
  where billing_source = 'platform'
    and sandbox_id <> 'pending';

create or replace function public.list_unmetered_platform_sandboxes(
  p_limit integer default 250
) returns table (
  id uuid,
  sandbox_id text,
  billing_source text,
  actor_user_id uuid,
  user_id uuid,
  product_team_id uuid,
  status text
) language sql as $$
  with candidates as materialized (
    select s.id
    from public.sandboxes s
    where s.billing_source = 'platform'
      and s.status::text in (
        'creating', 'installing', 'running', 'pausing', 'paused', 'error'
      )
      and s.sandbox_id <> 'pending'
      and not exists (
        select 1
        from public.sandbox_billing_sessions b
        where b.sandbox_record_id = s.id
          and b.state in ('open', 'closing')
      )
    order by
      s.sandbox_billing_recovery_checked_at asc nulls first,
      s.last_active_at desc nulls last,
      s.id
    limit least(greatest(coalesce(p_limit, 250), 1), 1000)
  )
  update public.sandboxes s
  set sandbox_billing_recovery_checked_at = now()
  from candidates c
  where s.id = c.id
  returning
    s.id,
    s.sandbox_id,
    s.billing_source::text,
    s.actor_user_id,
    s.user_id,
    s.product_team_id,
    s.status::text
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

  if not p_final and v_session.state <> 'open' then
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
