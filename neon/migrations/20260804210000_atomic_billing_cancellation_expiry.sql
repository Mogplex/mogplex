-- Expire included credit under the same billing-account lock used by every
-- other ledger mutation. This prevents cancellation from reading a balance
-- that changes before its expiry entry is posted.
alter table public.billing_accounts
  add column if not exists subscription_checkout_generation bigint not null default 0;

create or replace function public.expire_billing_included_credit(
  p_account uuid,
  p_source_ref text
) returns bigint language plpgsql as $$
declare
  v_included bigint;
begin
  perform 1 from public.billing_accounts where id = p_account for update;
  if not found then
    raise exception 'billing account % not found', p_account;
  end if;

  select coalesce(sum(delta_cents), 0)::bigint
    into v_included
  from public.credit_ledger
  where account_id = p_account and bucket = 'included';

  insert into public.credit_ledger
    (account_id, delta_cents, bucket, kind, source_ref)
  values
    (p_account, -greatest(v_included, 0), 'included', 'grant_expiry', p_source_ref)
  on conflict (source_ref) do nothing;

  if not found then
    return 0;
  end if;

  update public.billing_accounts
  set subscription_checkout_generation = subscription_checkout_generation + 1,
      updated_at = now()
  where id = p_account;

  return greatest(v_included, 0);
end;
$$;
