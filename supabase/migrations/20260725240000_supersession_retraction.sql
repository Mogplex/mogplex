-- LIVE DEFINITION of model_supersessions_effective as of this branch. If you change it,
-- add a new migration and move this marker rather than editing an
-- applied file.

-- Retract a supersession when the deprecated model comes back.
--
-- model_supersessions_effective only checked that the *successor* is offered,
-- never that the *deprecated* model still isn't. Nothing ever deletes a row
-- either — planSupersessionWrites only adds and advances edges.
--
-- Concrete failure path: sync N records opus-4.8 -> opus-5 (same $5/$25). Before
-- sync N+1 Anthropic changes Opus 5's pricing, so 4.8 is no longer superseded;
-- resolveAnthropicNewestVersionPolicy retains it and the upsert writes it back
-- as is_available = true. The 4.8 -> 5 row survives untouched, so from then on
-- both the reconciler and the runtime resolver keep moving pins off a perfectly
-- live Opus 4.8 — including pins a user deliberately set after the divergence.
-- The existing guard ("a bad mapping can't move a pin onto a dead model") held;
-- the inverse ("a stale mapping moves a pin off a live model") did not.
--
-- Fix: a row is only in effect while the deprecated model is genuinely not on
-- offer. Because both consumers read this view, that closes the gap for the
-- reconciler and the runtime resolver in one place.
--
-- NOT EXISTS rather than a join, because a deprecated model may legitimately
-- have no ai_models row at all — a model superseded on its very first sync is
-- filtered out before the upsert, so there is nothing to join to, and "absent"
-- must count as "not offered".
--
-- Rows are left in place rather than deleted: the mapping is still the correct
-- answer if that model is retired again later, and keeping it means the sync
-- does not have to distinguish "temporarily back" from "never superseded".
CREATE OR REPLACE VIEW public.model_supersessions_effective
WITH (security_invoker = true) AS
SELECT
  s.deprecated_model_id,
  s.successor_model_id
FROM public.model_supersessions s
JOIN public.ai_models successor
  ON successor.id = s.successor_model_id
 AND successor.is_available
 AND COALESCE(successor.is_hidden, false) = false
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ai_models deprecated
  WHERE deprecated.id = s.deprecated_model_id
    AND deprecated.is_available
    AND COALESCE(deprecated.is_hidden, false) = false
);

COMMENT ON VIEW public.model_supersessions_effective IS
  'Supersessions currently in effect: the successor is on offer and the deprecated model is not. Read by both the runtime model resolver and upgrade_deprecated_model_pins(). A deprecated model that returns to the catalog (e.g. pricing diverged so it is no longer superseded) drops out here, which stops both consumers rewriting pins off a live model without needing the row deleted.';
