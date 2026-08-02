-- SUPERSEDED: the live body of upgrade_deprecated_model_pins() is in
-- 20260725300000_supersession_reconciler_early_exit.sql. Do not patch the function here — replay order means an
-- edit to this copy has no effect on a database that has already run the
-- later migrations. Add a new CREATE OR REPLACE migration instead.

-- Fix a lost-update window in the flows.draft_graph rewrite.
--
-- The previous definition computed the whole rewritten graph in a `rewritten`
-- CTE and then did `UPDATE flows f SET draft_graph = r.draft_graph FROM
-- rewritten r WHERE f.id = r.id`. Under READ COMMITTED the written value comes
-- from the CTE's snapshot. If the flows editor autosaved draft_graph for the
-- same row after that snapshot and committed while the cron's UPDATE was
-- blocked on the row lock, EvalPlanQual would re-check only `f.id = r.id`
-- (still true) and then store the snapshot-derived graph — discarding the
-- user's edit, and not just the modelOverride field but the entire graph.
--
-- The window is narrow and drafts are per-user, but the blast radius is a whole
-- automation graph and the cron runs unattended, so it is worth closing.
--
-- Fix: compute the rewrite inside the SET expression so it is evaluated against
-- the freshly-locked row. On a concurrent update Postgres re-reads the new row
-- version, re-checks the WHERE quals, and recomputes the new tuple from that
-- version — so the rewrite lands on the autosaved graph instead of replacing
-- it. The CTE is gone entirely: it was only ever a row selector, and the
-- EXISTS in the WHERE clause does that job.
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
      ),
      updated_at = now()
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
