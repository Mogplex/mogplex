-- Add the Business tier ($200/mo flat, $200 included usage — pricing ladder
-- PAYG/Pro/Team/Business, all self-serve). Catalog entries live in
-- lib/billing/catalog.ts (business_monthly / business_annual).

alter table public.billing_accounts
  drop constraint billing_accounts_tier_check;

alter table public.billing_accounts
  add constraint billing_accounts_tier_check
  check (tier in ('free', 'pro', 'team', 'business'));
