-- Correct the view's COMMENT, which described a retraction mechanism the code
-- no longer uses.
--
-- 20260725240000 said "Rows are left in place rather than deleted". That was
-- true when written, but the sync cron now deletes a mapping as soon as the
-- policy stops classifying the model as superseded (it retains the model, which
-- is the authoritative signal). The deprecated-side filter in this view is the
-- secondary net, not the primary mechanism — and on its own it is largely
-- inert, because a re-offered model keeps is_hidden = true (the sync
-- deliberately omits is_hidden from its upsert so the stale sweep's hide, and
-- any admin hide, is durable) and so never looks "on offer" here.
--
-- The COMMENT is what a future reader hits via \d+, so it needs to agree with
-- the route rather than contradict it.
COMMENT ON VIEW public.model_supersessions_effective IS
  'Supersessions currently in effect: the successor is on offer and the deprecated model is not. Read by the runtime model resolver and by upgrade_deprecated_model_pins(). Retraction is primarily handled by the sync cron, which DELETEs a mapping once the newest-version policy retains the deprecated model again (see reconcileSupersessions in app/api/cron/sync-models/route.ts). The deprecated-side filter here is a secondary net for a model that is both available and visible; it is inert for models hidden by the stale sweep, since that hide is deliberately durable.';
