-- W11: Capture all gateway generation IDs across tool-loop steps.
--
-- Problem: ai_calls.gateway_generation_id is a singleton column, but multi-step
-- generateText calls (PR review agents, automation workflows with tools) produce
-- N gateway generation IDs, one per step. We only persist the LAST one. The W7
-- reconciliation task queries the Vercel AI Gateway for the cost of that one ID,
-- which is just the cost of one of N steps, and overwrites the accurate aggregate
-- Trigger-side estimate with a wildly under-reported number.
--
-- Evidence: Production row b650eeed-525c-443a-87cc-5af614339126 (PR review of
-- webrenew/vmotif#331): 38,747 input + 4,124 output tokens, 7 tool calls, but
-- reconciled cost_usd = $0.011346 (single step) vs expected ~$0.178 (aggregate).
--
-- This migration:
--   1. Adds gateway_generation_ids TEXT[] column to capture all step IDs
--   2. Creates a partial index for the reconciliation task to find rows needing
--      multi-ID reconciliation
--   3. Keeps gateway_generation_id populated with the first ID for backward compat
--      (dashboard reads, existing reconciliation logic during rollout)

-- 1. Add the new array column -------------------------------------------------

ALTER TABLE ai_calls
  ADD COLUMN IF NOT EXISTS gateway_generation_ids TEXT[];

COMMENT ON COLUMN ai_calls.gateway_generation_ids IS
  'All Vercel AI Gateway generation IDs captured across tool-loop steps. Used by '
  'W7/W11 reconciliation to sum cost across all steps. The singleton '
  'gateway_generation_id column holds the first ID for backward compatibility.';

-- 2. Note on indexing ---------------------------------------------------------
--
-- The existing idx_ai_calls_needs_reconcile (from #519) filters on
-- gateway_generation_id IS NOT NULL. Since both the singleton and array columns
-- are always written together (capturedUsageAiCallColumns writes both), that
-- index is sufficient for the reconciliation task to find rows needing work.
-- No separate array-based index is needed.

-- 3. Backfill existing rows with singleton into array -------------------------
--
-- For existing rows that have a gateway_generation_id but no array, populate the
-- array with that single ID. This makes the reconciliation task's array-based
-- query find them.

UPDATE ai_calls
   SET gateway_generation_ids = ARRAY[gateway_generation_id]
 WHERE gateway_generation_id IS NOT NULL
   AND (gateway_generation_ids IS NULL OR gateway_generation_ids = '{}');
