-- SUPERSEDED: the live body of upgrade_deprecated_model_pins() is in
-- 20260725300000_supersession_reconciler_early_exit.sql. Do not patch the function here — replay order means an
-- edit to this copy has no effect on a database that has already run the
-- later migrations. Add a new CREATE OR REPLACE migration instead.

-- Deprecated-model auto-upgrade: the counterpart to new-model auto-enable.
--
-- The sync cron already retires an Anthropic model when a newer version of the
-- same family ships at the same price (20260701123000_anthropic_newest_version
-- _policy.sql hid Opus 4.5/4.6/4.7 behind 4.8, and Sonnet 4.5/3.7 behind 4.6).
-- What it never did is repoint the saved references, so an automation pinned to
-- `anthropic/claude-opus-4.7` is still pinned to a model that is now
-- is_available = false. This migration records the deprecated -> successor
-- mapping and adds the reconciler that upgrades those references.
--
-- Reuses profiles.auto_enable_new_models as the opt-out: a user who turned off
-- auto-adopting new models does not get their pins silently rewritten either.
-- Those users keep the existing manual path (the flows editor already surfaces
-- an "unavailable model" quick-replace).

CREATE TABLE IF NOT EXISTS public.model_supersessions (
  -- Not FK'd to ai_models: a model can be superseded on its very first sync
  -- (Opus 4.7 and Opus 5 arriving in the same catalog pull), in which case the
  -- deprecated id is filtered out before any ai_models row is written.
  deprecated_model_id TEXT PRIMARY KEY,
  successor_model_id TEXT NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'anthropic_newest_version',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT model_supersessions_distinct CHECK (deprecated_model_id <> successor_model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_supersessions_successor
  ON public.model_supersessions (successor_model_id);

ALTER TABLE public.model_supersessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read model_supersessions" ON public.model_supersessions;
CREATE POLICY "Anyone can read model_supersessions"
  ON public.model_supersessions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can manage model_supersessions" ON public.model_supersessions;
CREATE POLICY "Service role can manage model_supersessions"
  ON public.model_supersessions FOR ALL USING (auth.role() = 'service_role');

-- Upgrade every saved model reference that points at a deprecated model.
--
-- Scope, and why each is or isn't here:
--   * flows.draft_graph   -> agent nodes' data.modelOverride (the automation pin)
--   * agents.model        -> the base model an agent node falls back to
--   * profiles.default_model -> otherwise a retired default silently collapses
--                            to the hardcoded DEFAULT_NEW_AGENT_MODEL_ID
--   * flow_versions.graph -> deliberately NOT rewritten. Published versions are
--     immutable snapshots that runs execute and job_runs reference; rewriting
--     them would mutate history. Those are upgraded at invocation time by
--     resolveAutomationModel instead, so already-published automations pick up
--     the successor without a republish.
--   * user_model_preferences / repo_model_overrides -> left alone. Both are
--     filters over the catalog, not pins: an explicit row for a model that is
--     now is_available = false is inert (listEnabledVisibleModelIds requires
--     is_available regardless of the preference row).
--
-- Fail-safe by construction: a supersession only applies while its successor is
-- actually offered (available and not hidden), so a mapping whose successor the
-- gateway never served can never move a working pin onto a dead model.
CREATE OR REPLACE FUNCTION public.upgrade_deprecated_model_pins()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  upgraded_flows INTEGER := 0;
  upgraded_agents INTEGER := 0;
  upgraded_profiles INTEGER := 0;
BEGIN
  CREATE TEMPORARY TABLE user_upgrades ON COMMIT DROP AS
  SELECT
    p.id AS user_id,
    s.deprecated_model_id,
    s.successor_model_id
  FROM public.profiles p
  CROSS JOIN public.model_supersessions s
  JOIN public.ai_models successor
    ON successor.id = s.successor_model_id
   AND successor.is_available
   AND COALESCE(successor.is_hidden, false) = false
  WHERE p.auto_enable_new_models
    -- Never upgrade onto a model the user explicitly turned off.
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_model_preferences ump
      WHERE ump.user_id = p.id
        AND ump.model_id = s.successor_model_id
        AND ump.is_enabled = false
    );

  CREATE INDEX ON user_upgrades (user_id, deprecated_model_id);

  -- 1) Automation pins: agent nodes' data.modelOverride in the draft graph.
  WITH rewritten AS (
    SELECT
      f.id,
      jsonb_set(
        f.draft_graph,
        '{nodes}',
        (
          SELECT COALESCE(
            jsonb_agg(
              CASE
                WHEN node->>'type' = 'agent' AND u.successor_model_id IS NOT NULL
                  THEN jsonb_set(
                    node,
                    '{data,modelOverride}',
                    to_jsonb(u.successor_model_id)
                  )
                ELSE node
              END
              ORDER BY ordinality
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(f.draft_graph->'nodes')
            WITH ORDINALITY AS elem(node, ordinality)
          LEFT JOIN user_upgrades u
            ON u.user_id = f.user_id
           AND u.deprecated_model_id = elem.node->'data'->>'modelOverride'
        )
      ) AS draft_graph
    FROM public.flows f
    WHERE jsonb_typeof(f.draft_graph->'nodes') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(f.draft_graph->'nodes') AS n(node)
        JOIN user_upgrades u
          ON u.user_id = f.user_id
         AND u.deprecated_model_id = n.node->'data'->>'modelOverride'
        WHERE n.node->>'type' = 'agent'
      )
  )
  UPDATE public.flows f
  SET draft_graph = r.draft_graph,
      updated_at = now()
  FROM rewritten r
  WHERE f.id = r.id;
  GET DIAGNOSTICS upgraded_flows = ROW_COUNT;

  -- 2) Agent base models (what a node without an override runs on).
  UPDATE public.agents a
  SET model = u.successor_model_id
  FROM user_upgrades u
  WHERE u.user_id = a.user_id
    AND a.model = u.deprecated_model_id;
  GET DIAGNOSTICS upgraded_agents = ROW_COUNT;

  -- 3) Per-user default model.
  UPDATE public.profiles p
  SET default_model = u.successor_model_id
  FROM user_upgrades u
  WHERE u.user_id = p.id
    AND p.default_model = u.deprecated_model_id;
  GET DIAGNOSTICS upgraded_profiles = ROW_COUNT;

  DROP TABLE IF EXISTS user_upgrades;

  RETURN jsonb_build_object(
    'flows', upgraded_flows,
    'agents', upgraded_agents,
    'profiles', upgraded_profiles
  );
END;
$$;

-- Service-role only: this rewrites rows across every user.
REVOKE ALL ON FUNCTION public.upgrade_deprecated_model_pins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upgrade_deprecated_model_pins() FROM anon;
REVOKE ALL ON FUNCTION public.upgrade_deprecated_model_pins() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_deprecated_model_pins() TO service_role;

-- Backfill the supersessions the 20260701 policy migration already enacted in
-- the catalog but never recorded, so the pins it orphaned are repaired on
-- deploy instead of waiting for the next model launch. Gated on the successor
-- actually being offered; ON CONFLICT keeps a re-run idempotent.
INSERT INTO public.model_supersessions (deprecated_model_id, successor_model_id)
SELECT deprecated_id, successor_id
FROM (
  VALUES
    ('anthropic/claude-opus-4.5', 'anthropic/claude-opus-4.8'),
    ('anthropic/claude-opus-4.6', 'anthropic/claude-opus-4.8'),
    ('anthropic/claude-opus-4.7', 'anthropic/claude-opus-4.8'),
    ('anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-4.6'),
    ('anthropic/claude-3.7-sonnet', 'anthropic/claude-sonnet-4.6')
) AS seed(deprecated_id, successor_id)
WHERE EXISTS (
  SELECT 1 FROM public.ai_models m
  WHERE m.id = seed.successor_id
    AND m.is_available
    AND COALESCE(m.is_hidden, false) = false
)
ON CONFLICT (deprecated_model_id) DO NOTHING;
