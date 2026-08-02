-- Sum ai_calls.cost_usd over a half-open [start, end) window for the AI-spend
-- divergence backstop (trigger/ai-spend-divergence-check.ts).
--
-- Why an RPC instead of a PostgREST aggregate select: this project has
-- PostgREST aggregate functions disabled (the default), so
-- `select("total:cost_usd.sum()")` returns 400 PGRST123 "Use of aggregate
-- functions is not allowed" — which silently failed the daily scheduled run
-- ever since it shipped (W7, #524). Summing rows client-side is not an option
-- either: ai_calls volume exceeds PostgREST's 1000-row cap, so a JS sum would
-- undercount. A SECURITY DEFINER function does the sum in Postgres, exactly
-- once, with no row cap.

CREATE OR REPLACE FUNCTION public.sum_ai_call_costs(
  p_start TIMESTAMPTZ,
  p_end   TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)::NUMERIC
  FROM public.ai_calls
  WHERE cost_usd IS NOT NULL
    AND completed_at >= p_start
    AND completed_at <  p_end;
$$;

GRANT EXECUTE ON FUNCTION public.sum_ai_call_costs(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
