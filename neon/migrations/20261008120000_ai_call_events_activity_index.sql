-- Ensure the ai_call_events activity-lookup index exists on live Neon.
-- This index is defined in the legacy supabase/migrations but may not exist on
-- Neon databases that were created after the transition. The zombie reaper's
-- loadLatestCallActivity queries SELECT created_at FROM ai_call_events
-- WHERE ai_call_id = $1 ORDER BY created_at DESC LIMIT 1, which this index
-- covers as an index-only scan.
CREATE INDEX IF NOT EXISTS idx_ai_call_events_ai_call_created
  ON public.ai_call_events (ai_call_id, created_at ASC);
