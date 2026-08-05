-- Preserve Vercel AI Gateway's 8-decimal USD cost exactly while the customer
-- ledger remains denominated in whole cents. Each call is recorded once; any
-- fractional cent carries forward on the billing account until it becomes a
-- whole-cent debit.

alter table public.billing_accounts
  add column if not exists token_usage_remainder_cost_units bigint
  not null default 0;

create table if not exists public.token_usage_accruals (
  source_ref text primary key,
  account_id uuid not null references public.billing_accounts (id),
  cost_units bigint not null check (cost_units > 0),
  debited_cents bigint not null check (debited_cents >= 0),
  period text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists token_usage_accruals_account_created_idx
  on public.token_usage_accruals (account_id, created_at desc);

alter table public.token_usage_accruals enable row level security;

create or replace function public.accrue_token_usage(
  p_account uuid,
  p_cost_units bigint,
  p_source_ref text,
  p_period text,
  p_metadata jsonb default '{}'
) returns table (
  posted boolean,
  debited_cents bigint,
  remainder_cost_units bigint
) language plpgsql as $$
declare
  v_existing public.token_usage_accruals%rowtype;
  v_remainder bigint;
  v_total_units bigint;
  v_debit_cents bigint;
  v_debit_posted boolean;
begin
  if p_cost_units is null or p_cost_units <= 0 then
    raise exception 'token usage cost must be positive, got %', p_cost_units;
  end if;
  if nullif(trim(p_source_ref), '') is null then
    raise exception 'token usage source reference is required';
  end if;
  if nullif(trim(p_period), '') is null then
    raise exception 'token usage period is required';
  end if;

  select token_usage_remainder_cost_units into v_remainder
  from public.billing_accounts
  where id = p_account
  for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;

  select * into v_existing
  from public.token_usage_accruals
  where source_ref = trim(p_source_ref);
  if found then
    -- Gateway costs are final once reported. A retry may repeat that value but
    -- must never rewrite a previously accrued call with a different identity.
    if v_existing.account_id <> p_account
      or v_existing.cost_units <> p_cost_units
      or v_existing.period <> trim(p_period)
    then
      raise exception 'token usage source % identity mismatch', p_source_ref;
    end if;
    return query select false, v_existing.debited_cents, v_remainder;
    return;
  end if;

  v_total_units := v_remainder + p_cost_units;
  -- Gateway costs use 8 decimal places in USD. One cent is 1,000,000 of
  -- those units.
  v_debit_cents := v_total_units / 1000000;
  v_remainder := mod(v_total_units, 1000000);

  if v_debit_cents > 0 then
    select d.posted into v_debit_posted
    from public.post_billing_usage_debit(
      p_account,
      v_debit_cents,
      'usage_tokens',
      trim(p_source_ref),
      trim(p_period),
      coalesce(p_metadata, '{}')
    ) d;
    if not v_debit_posted then
      raise exception 'token usage source % already has a ledger debit', p_source_ref;
    end if;
  end if;

  update public.billing_accounts
  set token_usage_remainder_cost_units = v_remainder,
      updated_at = now()
  where id = p_account;

  insert into public.token_usage_accruals (
    source_ref,
    account_id,
    cost_units,
    debited_cents,
    period,
    metadata
  ) values (
    trim(p_source_ref),
    p_account,
    p_cost_units,
    v_debit_cents,
    trim(p_period),
    coalesce(p_metadata, '{}')
  );

  return query select true, v_debit_cents, v_remainder;
end;
$$;

revoke all on function public.accrue_token_usage(uuid, bigint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.accrue_token_usage(uuid, bigint, text, text, jsonb)
  to service_role;
