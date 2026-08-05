-- Atomically debit metered usage while preserving the included-before-
-- purchased burn order. Usage is known only after a run completes, so the
-- final in-flight debit may take purchased credit below zero; subsequent run
-- admission blocks on the non-positive total balance.

create or replace function public.post_billing_usage_debit(
  p_account uuid,
  p_amount bigint,
  p_kind text,
  p_source_ref text,
  p_period text,
  p_metadata jsonb default '{}'
) returns table (
  posted boolean,
  debited_cents bigint,
  included_debited_cents bigint,
  purchased_debited_cents bigint
) language plpgsql as $$
declare
  v_included_balance bigint;
  v_included_debit bigint;
  v_purchased_debit bigint;
begin
  if p_amount <= 0 then
    raise exception 'billing usage amount must be positive, got %', p_amount;
  end if;
  if p_kind not in ('usage_tokens', 'usage_sandbox') then
    raise exception 'invalid billing usage kind %', p_kind;
  end if;

  perform 1 from public.billing_accounts where id = p_account for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;

  if exists (
    select 1 from public.credit_ledger
    where source_ref in (p_source_ref || ':inc', p_source_ref || ':pur')
  ) then
    return query select false, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  select greatest(
    coalesce(sum(delta_cents) filter (where bucket = 'included'), 0),
    0
  )::bigint
    into v_included_balance
  from public.credit_ledger
  where account_id = p_account;

  v_included_debit := least(v_included_balance, p_amount);
  v_purchased_debit := p_amount - v_included_debit;

  if v_included_debit > 0 then
    insert into public.credit_ledger
      (account_id, delta_cents, bucket, kind, source_ref, period, metadata)
    values
      (p_account, -v_included_debit, 'included', p_kind,
       p_source_ref || ':inc', p_period, p_metadata);
  end if;

  if v_purchased_debit > 0 then
    insert into public.credit_ledger
      (account_id, delta_cents, bucket, kind, source_ref, period, metadata)
    values
      (p_account, -v_purchased_debit, 'purchased', p_kind,
       p_source_ref || ':pur', p_period, p_metadata);
  end if;

  return query select true, p_amount, v_included_debit, v_purchased_debit;
end;
$$;
