-- Preserve unknown AI call cost as NULL instead of collapsing it to zero.
--
-- Timed-out automation runs can still incur spend even when the final model
-- call aborts. We now log partial step usage on failures when available, but
-- rows with no token counts at all must remain unknown so the UI can
-- distinguish "no measured usage" from a genuine zero-cost call.

CREATE OR REPLACE FUNCTION compute_ai_call_cost()
RETURNS TRIGGER AS $$
DECLARE
  p_input NUMERIC;
  p_output NUMERIC;
BEGIN
  SELECT pricing_input, pricing_output
    INTO p_input, p_output
    FROM ai_models
   WHERE id = NEW.model
   LIMIT 1;

  IF NEW.input_tokens IS NULL AND NEW.output_tokens IS NULL THEN
    NEW.cost_usd := NULL;
    RETURN NEW;
  END IF;

  IF p_input IS NULL AND p_output IS NULL THEN
    NEW.cost_usd := NULL;
    RETURN NEW;
  END IF;

  NEW.cost_usd :=
    COALESCE(NEW.input_tokens, 0) * COALESCE(p_input, 0) +
    COALESCE(NEW.output_tokens, 0) * COALESCE(p_output, 0);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE ai_calls
   SET cost_usd = NULL
 WHERE input_tokens IS NULL
   AND output_tokens IS NULL;

UPDATE ai_calls c
   SET cost_usd = CASE
         WHEN m.pricing_input IS NULL AND m.pricing_output IS NULL THEN NULL
         ELSE COALESCE(c.input_tokens, 0) * COALESCE(m.pricing_input, 0) +
              COALESCE(c.output_tokens, 0) * COALESCE(m.pricing_output, 0)
       END
  FROM ai_models m
 WHERE m.id = c.model
   AND NOT (c.input_tokens IS NULL AND c.output_tokens IS NULL);

UPDATE ai_calls c
   SET cost_usd = NULL
 WHERE NOT (c.input_tokens IS NULL AND c.output_tokens IS NULL)
   AND NOT EXISTS (
     SELECT 1
       FROM ai_models m
      WHERE m.id = c.model
   );

UPDATE job_runs jr
   SET cost_usd = (
         SELECT SUM(c.cost_usd)
           FROM ai_calls c
          WHERE c.job_run_id = jr.id
       );
