-- LIVE DEFINITION of upgrade_deprecated_model_pins() as of this branch. If you change it,
-- add a new migration and move this marker rather than editing an
-- applied file.

-- Skip the flows scan when there is nothing to reconcile.
--
-- The reconcile runs unconditionally (a user re-enabling auto-adopt, or a flow
-- created while a model was already deprecated, still needs its pins moved), so
-- the no-op path is the common one — and it was still building the temp table,
-- indexing it, and running the flows rewrite whose driving query expands
-- jsonb_array_elements over every draft graph in the table.
--
-- Now returns as soon as the candidate set is empty, making the steady-state
-- cost O(profiles x effective supersessions) instead of touching every flow.
-- 20260725200000's COMMENT documented that cost; this avoids it.

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
  DROP TABLE IF EXISTS pg_temp.user_upgrades;

  CREATE TEMPORARY TABLE user_upgrades ON COMMIT DROP AS
  SELECT
    p.id AS user_id,
    s.deprecated_model_id,
    s.successor_model_id
  FROM public.profiles p
  -- Availability is enforced by the view.
  CROSS JOIN public.model_supersessions_effective s
  WHERE p.auto_enable_new_models
    -- Never upgrade onto a model the user explicitly turned off.
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_model_preferences ump
      WHERE ump.user_id = p.id
        AND ump.model_id = s.successor_model_id
        AND ump.is_enabled = false
    )
    -- Never upgrade onto a model one of the user's teams forbids while that
    -- team still permits what is pinned today.
    AND NOT EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = p.id
        AND t.model_allowlist IS NOT NULL
        AND t.model_allowlist @> ARRAY[s.deprecated_model_id]
        AND NOT (t.model_allowlist @> ARRAY[s.successor_model_id])
    );

  -- Steady state on essentially every cron run: mappings exist but nobody holds
  -- a pin that needs moving. Return before touching flows — otherwise the
  -- driving query expands jsonb_array_elements(draft_graph->'nodes') across
  -- every flow row with an array `nodes`, and a correlated semi-join is not
  -- something to rely on the planner short-circuiting.
  IF NOT EXISTS (SELECT 1 FROM user_upgrades) THEN
    DROP TABLE IF EXISTS pg_temp.user_upgrades;
    RETURN jsonb_build_object('flows', 0, 'agents', 0, 'profiles', 0);
  END IF;

  CREATE INDEX ON user_upgrades (user_id, deprecated_model_id);

  -- 1) Automation pins: agent nodes' data.modelOverride in the draft graph.
  --    The rewrite is computed in the SET expression, against the locked row,
  --    so a concurrent autosave cannot be clobbered (see header).
  UPDATE public.flows f
  SET draft_graph = jsonb_set(
        f.draft_graph,
        '{nodes}',
        (
          SELECT COALESCE(
            jsonb_agg(
              CASE
                WHEN elem.node->>'type' = 'agent'
                 AND u.successor_model_id IS NOT NULL
                  THEN jsonb_set(
                    elem.node,
                    '{data,modelOverride}',
                    to_jsonb(u.successor_model_id)
                  )
                ELSE elem.node
              END
              ORDER BY elem.ordinality
            ),
            '[]'::jsonb
          )
          FROM jsonb_array_elements(f.draft_graph->'nodes')
            WITH ORDINALITY AS elem(node, ordinality)
          LEFT JOIN user_upgrades u
            ON u.user_id = f.user_id
           AND u.deprecated_model_id = elem.node->'data'->>'modelOverride'
        )
      )
  WHERE jsonb_typeof(f.draft_graph->'nodes') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(f.draft_graph->'nodes') AS n(node)
      JOIN user_upgrades u
        ON u.user_id = f.user_id
       AND u.deprecated_model_id = n.node->'data'->>'modelOverride'
      WHERE n.node->>'type' = 'agent'
    );
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

  DROP TABLE IF EXISTS pg_temp.user_upgrades;

  RETURN jsonb_build_object(
    'flows', upgraded_flows,
    'agents', upgraded_agents,
    'profiles', upgraded_profiles
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upgrade_deprecated_model_pins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upgrade_deprecated_model_pins() FROM anon;
REVOKE ALL ON FUNCTION public.upgrade_deprecated_model_pins() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_deprecated_model_pins() TO service_role;
