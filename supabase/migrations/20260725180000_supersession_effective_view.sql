-- The view definition here is also superseded: the live
-- model_supersessions_effective is in 20260725240000_supersession_retraction.sql
-- (20260725280000 replaces only its COMMENT).
--
-- SUPERSEDED: the live body of upgrade_deprecated_model_pins() is in
-- 20260725300000_supersession_reconciler_early_exit.sql. Do not patch the function here — replay order means an
-- edit to this copy has no effect on a database that has already run the
-- later migrations. Add a new CREATE OR REPLACE migration instead.

-- Second round of review fixes for the deprecated-model upgrade.
--
-- 1) `model_supersessions_effective` — supersessions whose successor the
--    catalog is actually offering. The SQL reconciler already applied this
--    filter inline; the runtime resolver did not, so a successor that had
--    itself since been retired could still be swapped in. Expressing it once
--    as a view keeps both halves on the same definition and lets the runtime
--    resolver stay a single cached query.
--
-- 2) Qualify the temp-table drops in upgrade_deprecated_model_pins() as
--    `pg_temp.user_upgrades`. Unqualified, `DROP TABLE IF EXISTS user_upgrades`
--    resolves through the search path — normally the implicit temp schema, but
--    on entry (when no temp table exists yet) it would happily drop a
--    permanent `public.user_upgrades` if one ever existed. Naming pg_temp
--    explicitly makes the statement mean only what was intended.

CREATE OR REPLACE VIEW public.model_supersessions_effective
WITH (security_invoker = true) AS
SELECT
  s.deprecated_model_id,
  s.successor_model_id
FROM public.model_supersessions s
JOIN public.ai_models m
  ON m.id = s.successor_model_id
 AND m.is_available
 AND COALESCE(m.is_hidden, false) = false;

COMMENT ON VIEW public.model_supersessions_effective IS
  'Supersessions whose successor is currently offered. Read by the runtime model resolver; never upgrade a pin onto a model absent from this view.';

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
