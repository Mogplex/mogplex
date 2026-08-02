-- Materialize cost_usd on ai_calls and job_runs at write time.
--
-- Context: the observability page needs per-call and per-run cost so that a
-- unified activity table can answer "who / where / when / result / cost"
-- without joining the ai_models pricing catalog on every page fetch. Joining
-- at read time works but forces every query, export, and future rollup to
-- carry the same join. Write-time materialization snapshots the price that
-- was in effect when the call completed — correct historical accounting even
-- if rates change later.
--
-- Two columns added:
--   ai_calls.cost_usd  — set by a BEFORE INSERT/UPDATE trigger that looks up
--                        ai_models.pricing_input / pricing_output (per-token USD)
--                        and multiplies by the row's token counts.
--   job_runs.cost_usd  — maintained by an AFTER trigger on ai_calls that sums
--                        child call costs onto the parent job_run row. Job runs
--                        don't carry a model name directly; rolling up from
--                        child calls is more accurate and handles runs with
--                        multiple calls using different models.
--
-- Existing rows are backfilled inline at the bottom of this migration.
-- Models with no pricing entry (pricing_input IS NULL AND pricing_output IS
-- NULL) leave cost_usd NULL — the UI renders these as "—".

-- 1. Add columns ---------------------------------------------------------

ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(14, 8);
ALTER TABLE job_runs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(14, 8);

-- 2. Trigger: compute ai_call cost at write time -------------------------
--
-- Fires BEFORE INSERT or UPDATE of the three fields that affect cost.
-- Using BEFORE so we can mutate NEW directly — no second UPDATE needed.

CREATE OR REPLACE FUNCTION compute_ai_call_cost()
RETURNS TRIGGER AS $$
DECLARE
  p_input  NUMERIC;
  p_output NUMERIC;
BEGIN
  SELECT pricing_input, pricing_output
    INTO p_input, p_output
    FROM ai_models
   WHERE id = NEW.model
   LIMIT 1;

  -- Leave cost_usd NULL when the model has no pricing entry rather than
  -- silently writing zero, so callers can distinguish "free" from "unknown".
  IF p_input IS NOT NULL OR p_output IS NOT NULL THEN
    NEW.cost_usd :=
      COALESCE(NEW.input_tokens,  0) * COALESCE(p_input,  0) +
      COALESCE(NEW.output_tokens, 0) * COALESCE(p_output, 0);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_calls_cost ON ai_calls;

CREATE TRIGGER trg_ai_calls_cost
  BEFORE INSERT OR UPDATE OF input_tokens, output_tokens, model
  ON ai_calls
  FOR EACH ROW EXECUTE FUNCTION compute_ai_call_cost();

-- 3. Trigger: roll cost up to job_runs after each ai_call write ----------
--
-- Fires AFTER INSERT/UPDATE so that NEW.cost_usd already reflects the value
-- written by trg_ai_calls_cost above (BEFORE fires first). Does a full SUM
-- each time, which is correct for multi-call runs and keeps logic simple.

CREATE OR REPLACE FUNCTION rollup_job_run_cost()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.job_run_id IS NOT NULL THEN
    UPDATE job_runs
       SET cost_usd = (
             SELECT SUM(cost_usd)
               FROM ai_calls
              WHERE job_run_id = NEW.job_run_id
           )
     WHERE id = NEW.job_run_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_calls_cost_rollup ON ai_calls;

CREATE TRIGGER trg_ai_calls_cost_rollup
  AFTER INSERT OR UPDATE OF cost_usd
  ON ai_calls
  FOR EACH ROW EXECUTE FUNCTION rollup_job_run_cost();

-- 4. Backfill existing rows ----------------------------------------------
--
-- The triggers above only fire on future writes. Backfill historical rows by
-- running the same arithmetic inline. Rows with no matching ai_models entry
-- are skipped (cost_usd stays NULL).

UPDATE ai_calls c
   SET cost_usd = (
         COALESCE(c.input_tokens,  0) * COALESCE(m.pricing_input,  0) +
         COALESCE(c.output_tokens, 0) * COALESCE(m.pricing_output, 0)
       )
  FROM ai_models m
 WHERE m.id = c.model
   AND (m.pricing_input IS NOT NULL OR m.pricing_output IS NOT NULL);

UPDATE job_runs jr
   SET cost_usd = (
         SELECT SUM(c.cost_usd)
           FROM ai_calls c
          WHERE c.job_run_id = jr.id
       )
 WHERE EXISTS (
   SELECT 1 FROM ai_calls WHERE job_run_id = jr.id AND cost_usd IS NOT NULL
 );
