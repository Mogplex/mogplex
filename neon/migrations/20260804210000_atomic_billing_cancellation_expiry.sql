-- Expire included credit under the same billing-account lock used by every
-- other ledger mutation. This prevents cancellation from reading a balance
-- that changes before its expiry entry is posted.
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

  if v_included <= 0 then
    return 0;
  end if;

  insert into public.credit_ledger
    (account_id, delta_cents, bucket, kind, source_ref)
  values
    (p_account, -v_included, 'included', 'grant_expiry', p_source_ref)
  on conflict (source_ref) do nothing;

  if not found then
    return 0;
  end if;
  return v_included;
end;
$$;
