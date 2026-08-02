-- Backfill: the flow node now owns the model outright.
--
-- Until this release an agent node with no `modelOverride` fell back to
-- `agents.model` at run time. That fallback is gone: a node without a model is
-- a config error, rejected at publish and failed loudly at run time. Nodes
-- written before the change therefore have to carry the model forward
-- explicitly, or an old graph would stop running for a reason its author never
-- chose.
--
-- Applies to both stores, for different reasons:
--   * flows.draft_graph   — editable; a missing model would block the next publish.
--   * flow_versions.graph — immutable published snapshots. Not rewritten to
--     change behaviour but to preserve it: a retry pins flow_version_id, so a
--     superseded version still has to resolve the model it always ran on.
--
-- Harness nodes (claude-code/codex) are skipped: their CLI selects its own
-- model and `modelOverride` is meaningless there.
--
-- Idempotent — it only fills nodes where the model is absent or blank.

-- 1) Draft graphs.
UPDATE public.flows f
SET draft_graph = jsonb_set(
      f.draft_graph,
      '{nodes}',
      (
        SELECT COALESCE(
          jsonb_agg(
            CASE
              WHEN elem.node->>'type' = 'agent'
               AND COALESCE(elem.node->'data'->>'harness', 'mogplex') = 'mogplex'
               AND COALESCE(TRIM(elem.node->'data'->>'modelOverride'), '') = ''
               AND a.model IS NOT NULL
                THEN jsonb_set(
                  elem.node,
                  '{data,modelOverride}',
                  to_jsonb(a.model)
                )
              ELSE elem.node
            END
            ORDER BY elem.ordinality
          ),
          '[]'::jsonb
        )
        FROM jsonb_array_elements(f.draft_graph->'nodes')
          WITH ORDINALITY AS elem(node, ordinality)
        LEFT JOIN public.agents a
          -- Compared as text, never cast to uuid: an unpublished draft may
          -- still hold a `preset:<name>` agentId (resolveFlowGraphPresetAgents
          -- only rewrites those at save/publish). Casting evaluates against
          -- every agent node in every graph, so one such draft would raise
          -- `invalid input syntax for type uuid` and abort the whole
          -- migration rather than skip that node.
          ON a.id::text = NULLIF(elem.node->'data'->>'agentId', '')
      )
    )
WHERE jsonb_typeof(f.draft_graph->'nodes') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(f.draft_graph->'nodes') AS n(node)
    JOIN public.agents a
      ON a.id::text = NULLIF(n.node->'data'->>'agentId', '')
    WHERE n.node->>'type' = 'agent'
      AND COALESCE(n.node->'data'->>'harness', 'mogplex') = 'mogplex'
      AND COALESCE(TRIM(n.node->'data'->>'modelOverride'), '') = ''
      AND a.model IS NOT NULL
  );

-- 2) Published version snapshots.
UPDATE public.flow_versions v
SET graph = jsonb_set(
      v.graph,
      '{nodes}',
      (
        SELECT COALESCE(
          jsonb_agg(
            CASE
              WHEN elem.node->>'type' = 'agent'
               AND COALESCE(elem.node->'data'->>'harness', 'mogplex') = 'mogplex'
               AND COALESCE(TRIM(elem.node->'data'->>'modelOverride'), '') = ''
               AND a.model IS NOT NULL
                THEN jsonb_set(
                  elem.node,
                  '{data,modelOverride}',
                  to_jsonb(a.model)
                )
              ELSE elem.node
            END
            ORDER BY elem.ordinality
          ),
          '[]'::jsonb
        )
        FROM jsonb_array_elements(v.graph->'nodes')
          WITH ORDINALITY AS elem(node, ordinality)
        LEFT JOIN public.agents a
          -- Compared as text, never cast to uuid: an unpublished draft may
          -- still hold a `preset:<name>` agentId (resolveFlowGraphPresetAgents
          -- only rewrites those at save/publish). Casting evaluates against
          -- every agent node in every graph, so one such draft would raise
          -- `invalid input syntax for type uuid` and abort the whole
          -- migration rather than skip that node.
          ON a.id::text = NULLIF(elem.node->'data'->>'agentId', '')
      )
    )
WHERE jsonb_typeof(v.graph->'nodes') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v.graph->'nodes') AS n(node)
    JOIN public.agents a
      ON a.id::text = NULLIF(n.node->'data'->>'agentId', '')
    WHERE n.node->>'type' = 'agent'
      AND COALESCE(n.node->'data'->>'harness', 'mogplex') = 'mogplex'
      AND COALESCE(TRIM(n.node->'data'->>'modelOverride'), '') = ''
      AND a.model IS NOT NULL
  );

-- `agents.model` is deliberately left in place. It is no longer read at run
-- time, but keeping the column makes this release reversible and preserves the
-- only record of what a pre-backfill node would have run on. Drop it in a
-- follow-up once this has baked; that follow-up must also remove the
-- `agents.model` arm from upgrade_deprecated_model_pins().
COMMENT ON COLUMN public.agents.model IS
  'DEPRECATED, not read at run time. The flow node (draft_graph / flow_versions.graph agent node modelOverride) is the sole source of truth for which model a step executes on. Retained for one release so the pre-backfill value stays recoverable; the follow-up that drops it must also drop the agents arm of upgrade_deprecated_model_pins().';
