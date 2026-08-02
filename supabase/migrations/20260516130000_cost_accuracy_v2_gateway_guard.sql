-- Cost accuracy v2 follow-up: close the silent-overwrite paths on ai_calls.cost_usd.
--
-- The v2 trigger (20260516120000_cost_accuracy_v2.sql) fires on
--   BEFORE INSERT OR UPDATE OF
--     input_tokens, output_tokens, model,
--     cache_read_input_tokens, cache_creation_input_tokens, cost_source
-- which leaves two write paths that bypass the cost_source contract:
--
--   1. UPDATE ai_calls SET cost_usd = X WHERE ...
--      (no cost_source mention) on a cost_source = 'trigger' row.
--      The trigger does not fire, so the row ends up with a manually-set
--      cost_usd and a stale cost_source = 'trigger'. A subsequent token
--      UPDATE re-fires the compute trigger and silently overwrites X with
--      the recomputed value.
--
--   2. UPDATE ai_calls SET cost_usd = X WHERE ...
--      on a cost_source = 'gateway' row. Same bypass; the W7 gateway
--      reconciliation value gets clobbered without any audit signal.
--
-- This migration:
--   a. Extends the compute trigger column list to include cost_usd, so any
--      write to cost_usd re-runs the formula and provenance is kept in sync.
--   b. Adds 'manual' to the short-circuit in compute_ai_call_cost(), so the
--      'manual' cost_source enum value (declared in v2's CHECK constraint)
--      actually works under the new column list - previously a manual write
--      would have been recomputed away.
--   c. Adds a separate guard that rejects writes to already gateway-owned
--      rows that leave cost_source as 'gateway' while changing cost_usd
--      without also changing gateway_generation_id. W7 refreshes of claimed
--      rows carry a new Vercel generation id; accidental naked cost_usd
--      writes do not.
--   d. Rejects ambiguous direct cost_usd writes on trigger-owned rows when no
--      pricing input changed. Operator overrides must say cost_source='manual'
--      in the same statement instead of relying on a naked cost_usd write.
--      The same rule applies on INSERT: if the caller supplies cost_usd, it
--      must also claim caller ownership with cost_source='manual' or 'gateway'.

-- 1. Extend compute_ai_call_cost short-circuit to cover manual overrides --

CREATE OR REPLACE FUNCTION compute_ai_call_cost()
RETURNS TRIGGER AS $$
DECLARE
  p_input       NUMERIC;
  p_output      NUMERIC;
  p_cache_read  NUMERIC;
  p_cache_write NUMERIC;
  v_cost        NUMERIC;
BEGIN
  -- Caller-owned cost_usd: gateway reconciliation (W7) and manual operator
  -- overrides both opt out of the formula. On INSERT, this also bypasses the
  -- ambiguous cost_usd guard below: callers using 'gateway' or 'manual' are
  -- explicitly claiming ownership of their supplied cost_usd. The CHECK
  -- constraint on cost_source restricts this to ('trigger', 'gateway', 'manual').
  -- Token updates on gateway/manual rows intentionally preserve the caller-owned
  -- cost until cost_source is changed away from gateway/manual.
  IF NEW.cost_source IN ('gateway', 'manual') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.cost_usd IS NOT NULL THEN
    RAISE EXCEPTION
      'ai_calls.cost_usd is computed when cost_source is trigger or unset. '
      'INSERT must omit cost_usd or set cost_source=manual/gateway for caller-owned costs.'
      USING HINT = 'Use cost_source=''manual'' for operator-supplied costs, or cost_source=''gateway'' for W7 reconciliation values.';
  END IF;

  -- A direct cost_usd write on a trigger-owned or unclaimed row is ambiguous:
  -- the formula owns the value, so silently recomputing would discard the
  -- caller's number. If the caller means an operator override, they must claim
  -- that explicitly with cost_source='manual' in the same UPDATE.
  -- Manual and gateway rows have already returned above, so this guard is only
  -- reached while NEW.cost_source is trigger or unset.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.cost_source, 'trigger') = 'trigger'
     AND COALESCE(NEW.cost_source, 'trigger') = 'trigger'
     AND NEW.cost_usd IS DISTINCT FROM OLD.cost_usd
     AND NEW.model IS NOT DISTINCT FROM OLD.model
     AND NEW.input_tokens IS NOT DISTINCT FROM OLD.input_tokens
     AND NEW.output_tokens IS NOT DISTINCT FROM OLD.output_tokens
     AND NEW.cache_read_input_tokens IS NOT DISTINCT FROM OLD.cache_read_input_tokens
     AND NEW.cache_creation_input_tokens IS NOT DISTINCT FROM OLD.cache_creation_input_tokens THEN
    RAISE EXCEPTION
      'ai_calls.cost_usd is computed while cost_source=trigger. '
      'Direct cost_usd writes must either change pricing inputs or set cost_source=manual.'
      USING HINT = 'Use UPDATE ... SET cost_usd = X, cost_source = ''manual'' for operator overrides.';
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
    NEW.cost_source := 'trigger';
    RETURN NEW;
  END IF;

  IF p_input IS NULL AND p_output IS NULL THEN
    NEW.cost_usd := NULL;
    NEW.cost_source := 'trigger';
    RETURN NEW;
  END IF;

  p_cache_read  := COALESCE(p_cache_read,  p_input * 0.1);
  p_cache_write := COALESCE(p_cache_write, p_input * 1.25);

  v_cost :=
      CASE WHEN COALESCE(NEW.input_tokens, 0)                > 0 THEN NEW.input_tokens                * p_input       ELSE 0 END
    + CASE WHEN COALESCE(NEW.cache_read_input_tokens, 0)     > 0 THEN NEW.cache_read_input_tokens     * p_cache_read  ELSE 0 END
    + CASE WHEN COALESCE(NEW.cache_creation_input_tokens, 0) > 0 THEN NEW.cache_creation_input_tokens * p_cache_write ELSE 0 END
    + CASE WHEN COALESCE(NEW.output_tokens, 0)               > 0 THEN NEW.output_tokens               * p_output      ELSE 0 END;

  NEW.cost_usd := v_cost;
  NEW.cost_source := 'trigger';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Re-create the compute trigger with cost_usd in the column list --------

DROP TRIGGER IF EXISTS trg_ai_calls_cost ON ai_calls;

CREATE TRIGGER trg_ai_calls_cost
  BEFORE INSERT OR UPDATE OF
    input_tokens, output_tokens, model,
    cache_read_input_tokens, cache_creation_input_tokens,
    cost_source, cost_usd
  ON ai_calls
  FOR EACH ROW EXECUTE FUNCTION compute_ai_call_cost();

COMMENT ON TRIGGER trg_ai_calls_cost ON ai_calls IS
  'Must sort before trg_ai_calls_zz_gateway_guard under PostgreSQL alphabetical BEFORE-trigger ordering so cost_source is finalized before gateway clobber checks.';

-- 3. Gateway-clobber guard -------------------------------------------------
--
-- The trigger name deliberately sorts after trg_ai_calls_cost. PostgreSQL
-- runs same-event BEFORE triggers alphabetically, so the compute trigger has
-- already short-circuited or recomputed by the time this guard evaluates.
--
-- We block the specific pattern where an already gateway-owned row is still
-- owned by gateway reconciliation after compute, but cost_usd changed without
-- a new generation id:
--   - OLD.cost_source = 'gateway' (the row was claimed by reconciliation)
--   - NEW.cost_source = 'gateway' (the write leaves reconciliation ownership)
--   - cost_usd is actually changing
--   - gateway_generation_id is NOT changing (no proof of a legitimate refresh)
--
-- Demotions away from gateway are explicit operator escape hatches:
--   - SET cost_source = 'manual', cost_usd = X preserves the operator value.
--   - SET cost_source = 'trigger' intentionally releases gateway ownership
--     and lets the compute trigger recalculate cost_usd from token counts.
-- Initial W7 claims from non-gateway rows are also allowed. Those rows are the
-- reconciliation backlog identified by idx_ai_calls_needs_reconcile, so W7 is
-- the first writer claiming gateway ownership; later gateway-owned refreshes
-- are the ones that must move gateway_generation_id with cost_usd.
--
-- This trigger also fires on cost_source changes so gateway demotions are not
-- hidden from the guard. They are visible here and allowed only because the
-- post-compute NEW.cost_source is no longer 'gateway'.
--
-- Because gateway_generation_id is in this trigger's UPDATE OF list,
-- generation-id-only updates intentionally fire this guard but pass because
-- cost_usd is unchanged. That keeps the W7 refresh column visible to this
-- guard while allowing metadata-only id staging that cannot clobber cost_usd.

CREATE OR REPLACE FUNCTION guard_ai_calls_gateway_cost_usd()
RETURNS TRIGGER AS $$
BEGIN
  -- Depends on firing after trg_ai_calls_cost by alphabetical BEFORE-trigger
  -- ordering. If either trigger is renamed, verify this ordering still holds.
  IF OLD.cost_source = 'gateway'
     AND NEW.cost_source = 'gateway'
     AND NEW.cost_usd IS DISTINCT FROM OLD.cost_usd
     AND NEW.gateway_generation_id IS NOT DISTINCT FROM OLD.gateway_generation_id THEN
    RAISE EXCEPTION
      'ai_calls.cost_usd is owned by gateway reconciliation (cost_source=gateway). '
      'To change it, either (a) the same UPDATE sets gateway_generation_id to the new '
      'Vercel generation id (W7 refresh), or (b) the same UPDATE sets cost_source to '
      '''trigger'' or ''manual'' to release gateway ownership. '
      'Got: old cost_usd=%, new cost_usd=%, gateway_generation_id=% (unchanged), cost_source=gateway.',
      OLD.cost_usd, NEW.cost_usd, OLD.gateway_generation_id
      USING HINT = 'W7 contract: cost_usd, cost_source=''gateway'', and gateway_generation_id move together. Manual overrides must also set cost_source=''manual''.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_calls_gateway_guard ON ai_calls;
DROP TRIGGER IF EXISTS trg_ai_calls_zz_gateway_guard ON ai_calls;

-- UPDATE-only: INSERT is excluded because there is no OLD gateway-owned row.
CREATE TRIGGER trg_ai_calls_zz_gateway_guard
  BEFORE UPDATE OF cost_source, cost_usd, gateway_generation_id ON ai_calls
  FOR EACH ROW EXECUTE FUNCTION guard_ai_calls_gateway_cost_usd();

COMMENT ON TRIGGER trg_ai_calls_zz_gateway_guard ON ai_calls IS
  'Runs after trg_ai_calls_cost by alphabetical BEFORE-trigger ordering. Blocks cost_usd changes on already gateway-owned rows that leave cost_source=gateway without a new gateway_generation_id; also fires on gateway_generation_id so W7 refresh statements are visible to the guard.';

-- UPDATE-only by design: trg_ai_calls_zz_gateway_guard is UPDATE-only, so its
-- ordering dependency with trg_ai_calls_cost only exists for BEFORE UPDATE.
-- INSERT still uses trg_ai_calls_cost, but there is no peer gateway guard to
-- order against for INSERT.
DO $$
DECLARE
  before_update_triggers TEXT[];
  cost_trigger_position INTEGER;
  guard_trigger_position INTEGER;
BEGIN
  SELECT ARRAY_AGG(tgname ORDER BY tgname)
    INTO before_update_triggers
    FROM pg_trigger
   WHERE tgrelid = 'ai_calls'::regclass
     AND NOT tgisinternal
     AND (tgtype::INTEGER & 2) = 2
     AND (tgtype::INTEGER & 16) = 16;

  cost_trigger_position := ARRAY_POSITION(before_update_triggers, 'trg_ai_calls_cost');
  guard_trigger_position := ARRAY_POSITION(before_update_triggers, 'trg_ai_calls_zz_gateway_guard');

  IF cost_trigger_position IS NULL
     OR guard_trigger_position IS NULL
     OR cost_trigger_position >= guard_trigger_position THEN
    RAISE EXCEPTION
      'Trigger ordering invariant violated: trg_ai_calls_cost must sort before trg_ai_calls_zz_gateway_guard for ai_calls BEFORE UPDATE triggers. Current order: %',
      before_update_triggers;
  END IF;
END $$;

-- 4. Refresh the cost_source comment to reflect the new contract ----------

COMMENT ON COLUMN ai_calls.cost_source IS
  'Who last wrote cost_usd: trigger (computed by compute_ai_call_cost), gateway '
  '(W7 reconciliation from Vercel billing), or manual (operator override). '
  'The compute trigger fires on writes to input_tokens, output_tokens, model, '
  'cache_read_input_tokens, cache_creation_input_tokens, cost_source, or cost_usd, '
  'short-circuits when cost_source IN (''gateway'', ''manual''), and stamps '
  'cost_source=''trigger'' even when the computed cost is NULL because no tokens '
  'or no pricing are available. '
  'Manual overrides persist across later token updates until cost_source is '
  'changed away from ''manual''. Direct cost_usd writes on cost_source=''trigger'' '
  'rows are rejected unless a pricing input changes; set cost_source=''manual'' '
  'in the same UPDATE for operator overrides. '
  'A separate guard (trg_ai_calls_zz_gateway_guard) blocks writes to already '
  'gateway-owned rows that leave cost_source=''gateway'' while changing cost_usd '
  'unless gateway_generation_id is also changing (W7 refresh); the guard also '
  'fires on gateway_generation_id so W7 refresh statements are visible to it. Initial W7 claims '
  'from cost_source IS DISTINCT FROM ''gateway'' remain allowed. Changing '
  'cost_source to ''manual'' releases gateway ownership and preserves the caller '
  'cost_usd; changing it to ''trigger'' releases gateway ownership and recomputes '
  'cost_usd from tokens.';

-- Reviewer-facing verification matrix:
--   1. UPDATE gateway row SET cost_usd = X -> raises.
--   2. UPDATE gateway row SET cost_usd = X, cost_source = 'gateway',
--      gateway_generation_id = <new id> -> succeeds as a W7 refresh.
--      UPDATE gateway row SET cost_usd = X, gateway_generation_id = <new id>
--      also succeeds; re-stating cost_source = 'gateway' is not required.
--   3. UPDATE non-gateway row SET cost_usd = X, cost_source = 'gateway' ->
--      succeeds as the initial W7 claim path.
--   4. UPDATE gateway row SET cost_usd = X, cost_source = 'manual' -> succeeds
--      and preserves X.
--   5. UPDATE manual row SET cost_usd = X -> succeeds and preserves X.
--   6. UPDATE gateway row SET cost_source = 'trigger' -> succeeds by design:
--      the compute trigger recalculates cost_usd and the guard sees the
--      post-compute row is no longer gateway-owned.
--   7. UPDATE trigger row SET cost_usd = X with unchanged pricing inputs ->
--      raises; add cost_source = 'manual' for an operator override.
--      The same applies when OLD cost_source IS NULL (unclaimed rows are
--      treated as formula-owned).
--   8. INSERT with cost_usd and no caller-owned cost_source -> raises; omit
--      cost_usd or set cost_source to 'manual'/'gateway'.
--   9. UPDATE gateway row SET gateway_generation_id = <new id> only -> succeeds
--      after firing the guard because cost_usd is unchanged.
--  10. INSERT formula-owned row with no tokens or no pricing -> stamps
--      cost_source = 'trigger' with cost_usd = NULL.
