-- Repair the Opus supersession chain that 20260725120000 could not seed.
--
-- That migration seeded 4.5/4.6/4.7 -> 4.8, gated on the successor still being
-- offered. By the time it ran, Claude Opus 5 had shipped at Opus 4.8's exact
-- pricing ($5/$25), so the sync cron had already retired 4.8 under the
-- newest-version policy — the guard correctly refused to point pins at it, and
-- the Opus rows were skipped entirely.
--
-- The go-forward path cannot recover these on its own:
-- resolveAnthropicNewestVersionPolicy only observes models the AI Gateway
-- currently serves, so a version the gateway has already dropped never
-- reappears as a discovered supersession. Anything still pinned to Opus
-- 4.5-4.8 would stay pinned to an unavailable model indefinitely.
--
-- Same one-time-cleanup shape as 20260701123000: an explicit list for state
-- that already exists, with go-forward enforcement living in the sync cron.
INSERT INTO public.model_supersessions (deprecated_model_id, successor_model_id)
SELECT deprecated_id, 'anthropic/claude-opus-5'
FROM (
  VALUES
    ('anthropic/claude-opus-4.5'),
    ('anthropic/claude-opus-4.6'),
    ('anthropic/claude-opus-4.7'),
    ('anthropic/claude-opus-4.8')
) AS seed(deprecated_id)
WHERE EXISTS (
  SELECT 1 FROM public.ai_models m
  WHERE m.id = 'anthropic/claude-opus-5'
    AND m.is_available
    AND COALESCE(m.is_hidden, false) = false
)
  -- Same-pricing is what makes the upgrade safe to apply silently. Verify it
  -- against the catalog rather than trusting the hardcoded list, so this is a
  -- no-op if pricing ever diverged.
  AND EXISTS (
    SELECT 1
    FROM public.ai_models deprecated
    JOIN public.ai_models successor
      ON successor.id = 'anthropic/claude-opus-5'
     AND successor.pricing_input = deprecated.pricing_input
     AND successor.pricing_output = deprecated.pricing_output
    WHERE deprecated.id = seed.deprecated_id
  )
ON CONFLICT (deprecated_model_id) DO UPDATE
  SET successor_model_id = EXCLUDED.successor_model_id,
      updated_at = now()
  -- Only advance a row whose recorded successor has itself been retired;
  -- never clobber a mapping that still points somewhere usable.
  WHERE EXISTS (
    SELECT 1 FROM public.ai_models stale
    WHERE stale.id = public.model_supersessions.successor_model_id
      AND (stale.is_available = false OR stale.is_hidden = true)
  );
