-- Lock down sum_ai_call_costs to service_role only.
--
-- The initial migration (20260623120000_sum_ai_call_costs.sql) granted EXECUTE
-- to service_role but relied on PostgreSQL's default, which leaves a function
-- executable by PUBLIC. Combined with SECURITY DEFINER and a body that sums
-- public.ai_calls with no tenant predicate, that left /rpc/sum_ai_call_costs
-- callable by anon/authenticated PostgREST clients — exposing tenant-wide spend
-- for arbitrary date ranges and bypassing ai_calls RLS.
--
-- Mirror the other service-role-only RPCs: revoke from PUBLIC/anon/authenticated,
-- then (re)grant to service_role. Idempotent and safe to re-run.

REVOKE ALL ON FUNCTION public.sum_ai_call_costs(TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sum_ai_call_costs(TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;
