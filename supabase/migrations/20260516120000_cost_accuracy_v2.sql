-- Cost accuracy v2: tiered Anthropic-style pricing + reconciliation hand-off.
--
-- Background: the v1 trigger (20260421180000_cost_usd.sql, then patched by
-- 20260422235407_fix_unknown_ai_call_costs.sql) computes ai_calls.cost_usd as a
-- flat input/output multiplication. That ignores cached input tokens (Anthropic
-- bills cache reads at ~0.1× input and cache writes at ~1.25×) and has no way
-- to step aside when a future reconciliation job writes Vercel's billed cost.
--
-- This migration:
--   1. Adds token-class columns to ai_calls (cache_read, cache_creation,
--      reasoning) plus gateway_generation_id + cost_source bookkeeping.
--   2. Adds cache pricing columns to ai_models so the catalog can carry real
--      cache rates when upstream exposes them.
--   3. Replaces compute_ai_call_cost() with a tiered version that
--        - short-circuits when cost_source = 'gateway' (reconciliation wins)
--        - uses explicit cache pricing when present, otherwise falls back to
--          0.1× input for cache reads and 1.25× input for cache writes
--        - does NOT add reasoning_tokens to cost (Anthropic rolls them into
--          output_tokens; OpenAI/Gemini bill at output rate — adding here would
--          double-count). Reasoning is capture-only.
--   4. Idempotently backfills every existing ai_calls row through the new
--      formula and stamps cost_source = 'trigger' where cost is non-null.
--
-- The AFTER trigger that rolls ai_calls cost up to job_runs.cost_usd is
-- unchanged (still rollup_job_run_cost / trg_ai_calls_cost_rollup).

-- 1. New columns ---------------------------------------------------------

ALTER TABLE ai_calls
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens     INT,
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens INT,
  ADD COLUMN IF NOT EXISTS reasoning_tokens            INT,
  ADD COLUMN IF NOT EXISTS gateway_generation_id       TEXT,
  ADD COLUMN IF NOT EXISTS cost_source                 TEXT
    CHECK (cost_source IN ('trigger', 'gateway', 'manual'));

COMMENT ON COLUMN ai_calls.reasoning_tokens IS
  'Capture-only; never included in cost_usd. NULL = model did not report this token class (not a billing gap).';

COMMENT ON COLUMN ai_calls.cost_source IS
  'Who last wrote cost_usd: trigger (computed by compute_ai_call_cost), gateway (W7 reconciliation from Vercel billing), or manual (operator override). W7 contract: always SET cost_source = ''gateway'' in the same UPDATE statement as cost_usd — updating cost_usd alone bypasses the BEFORE trigger and leaves this column stale.';

CREATE INDEX IF NOT EXISTS idx_ai_calls_generation_id
  ON ai_calls (gateway_generation_id)
  WHERE gateway_generation_id IS NOT NULL;

-- Partial index supports the reconciliation task (workstream 7): scan recent
-- rows that still need a gateway cost lookup. IS DISTINCT FROM treats NULL as
-- "not gateway" so rows that have a generation_id but no cost_source yet are
-- included. DROP first so re-running the migration picks up predicate changes
-- (CREATE INDEX IF NOT EXISTS only checks the name, not the predicate).
DROP INDEX IF EXISTS idx_ai_calls_needs_reconcile;
CREATE INDEX idx_ai_calls_needs_reconcile
  ON ai_calls (completed_at)
  WHERE gateway_generation_id IS NOT NULL AND cost_source IS DISTINCT FROM 'gateway';

ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS pricing_cache_read  NUMERIC,
  ADD COLUMN IF NOT EXISTS pricing_cache_write NUMERIC;

-- 2. Tiered cost trigger -------------------------------------------------

CREATE OR REPLACE FUNCTION compute_ai_call_cost()
RETURNS TRIGGER AS $$
DECLARE
  p_input       NUMERIC;
  p_output      NUMERIC;
  p_cache_read  NUMERIC;
  p_cache_write NUMERIC;
  v_cost        NUMERIC;
BEGIN
  -- Gateway reconciliation wins: if a future job has stamped cost_source =
  -- 'gateway', leave cost_usd alone.
  IF NEW.cost_source = 'gateway' THEN
    RETURN NEW;
  END IF;

  SELECT pricing_input, pricing_output, pricing_cache_read, pricing_cache_write
    INTO p_input, p_output, p_cache_read, p_cache_write
    FROM ai_models
   WHERE id = NEW.model
   LIMIT 1;

  IF NEW.input_tokens IS NULL
     AND NEW.output_tokens IS NULL
     AND NEW.cache_read_input_tokens IS NULL
     AND NEW.cache_creation_input_tokens IS NULL THEN
    NEW.cost_usd := NULL;
    RETURN NEW;
  END IF;

  IF p_input IS NULL AND p_output IS NULL THEN
    NEW.cost_usd := NULL;
    RETURN NEW;
  END IF;

  -- Tiered pricing. When the model has no explicit cache pricing, fall back to
  -- Anthropic-style ratios over pricing_input: 0.1× for cache reads, 1.25× for
  -- cache writes. NULL propagates: if p_input is NULL and the catalog has no
  -- explicit cache rate, the effective rate stays NULL and any non-zero token
  -- count in that class forces the total cost to NULL (rather than silently
  -- pricing the class at $0, which would lock in an undercount with
  -- cost_source='trigger').
  --
  -- reasoning_tokens are intentionally excluded — already inside output_tokens
  -- (Anthropic) or billed at output rate (OpenAI/Gemini).
  p_cache_read  := COALESCE(p_cache_read,  p_input * 0.1);
  p_cache_write := COALESCE(p_cache_write, p_input * 1.25);

  -- Per-class contributions: zero if the class has no tokens, otherwise
  -- tokens * rate (NULL if rate is missing).
  v_cost :=
      CASE WHEN COALESCE(NEW.input_tokens, 0)                > 0 THEN NEW.input_tokens                * p_input       ELSE 0 END
    + CASE WHEN COALESCE(NEW.cache_read_input_tokens, 0)     > 0 THEN NEW.cache_read_input_tokens     * p_cache_read  ELSE 0 END
    + CASE WHEN COALESCE(NEW.cache_creation_input_tokens, 0) > 0 THEN NEW.cache_creation_input_tokens * p_cache_write ELSE 0 END
    + CASE WHEN COALESCE(NEW.output_tokens, 0)               > 0 THEN NEW.output_tokens               * p_output      ELSE 0 END;

  NEW.cost_usd := v_cost;
  IF v_cost IS NOT NULL THEN
    NEW.cost_source := 'trigger';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_calls_cost ON ai_calls;

-- W7 contract: this trigger fires on the listed columns only. A reconciliation
-- job that updates cost_usd alone will NOT fire it, leaving cost_source stale.
-- W7 MUST set cost_source = 'gateway' in the same UPDATE statement as cost_usd
-- so the short-circuit at the top of compute_ai_call_cost() preserves the
-- gateway value.
CREATE TRIGGER trg_ai_calls_cost
  BEFORE INSERT OR UPDATE OF
    input_tokens, output_tokens, model,
    cache_read_input_tokens, cache_creation_input_tokens, cost_source
  ON ai_calls
  FOR EACH ROW EXECUTE FUNCTION compute_ai_call_cost();

-- 3. Backfill ------------------------------------------------------------
--
-- Re-run the new formula over every existing row. Idempotent: a second run
-- produces the same result. cost_source is seeded to 'trigger' wherever the
-- recomputed cost is non-null.

UPDATE ai_calls c
   SET cost_usd = CASE
         WHEN c.input_tokens IS NULL
              AND c.output_tokens IS NULL
              AND c.cache_read_input_tokens IS NULL
              AND c.cache_creation_input_tokens IS NULL THEN NULL
         WHEN m.pricing_input IS NULL AND m.pricing_output IS NULL THEN NULL
         ELSE
             CASE WHEN COALESCE(c.input_tokens, 0)                > 0
                  THEN c.input_tokens                * m.pricing_input  ELSE 0 END
           + CASE WHEN COALESCE(c.cache_read_input_tokens, 0)     > 0
                  THEN c.cache_read_input_tokens     * COALESCE(m.pricing_cache_read,  m.pricing_input * 0.1)
                  ELSE 0 END
           + CASE WHEN COALESCE(c.cache_creation_input_tokens, 0) > 0
                  THEN c.cache_creation_input_tokens * COALESCE(m.pricing_cache_write, m.pricing_input * 1.25)
                  ELSE 0 END
           + CASE WHEN COALESCE(c.output_tokens, 0)               > 0
                  THEN c.output_tokens               * m.pricing_output ELSE 0 END
       END
  FROM ai_models m
 WHERE m.id = c.model;

-- Rows whose model is missing from ai_models stay NULL.
UPDATE ai_calls c
   SET cost_usd = NULL
 WHERE NOT EXISTS (SELECT 1 FROM ai_models m WHERE m.id = c.model);

-- Seed cost_source='trigger' on every row where the (re)computed cost exists
-- and reconciliation has not already claimed it.
UPDATE ai_calls
   SET cost_source = 'trigger'
 WHERE cost_usd IS NOT NULL
   AND (cost_source IS NULL OR cost_source <> 'gateway');

-- Roll up to job_runs so parent totals reflect the new per-call values.
UPDATE job_runs jr
   SET cost_usd = (
         SELECT SUM(c.cost_usd)
           FROM ai_calls c
          WHERE c.job_run_id = jr.id
       );
