-- Phase 2 of the flows.installation_id refactor: backfill the new
-- start.filter on every existing flow_versions row so dual-read parity in the
-- webhook + wait routers can compare the new filter against the existing
-- installation_id query and observe zero divergence for >=48h before Phase 3
-- flips routing to the filter as primary.
--
-- For every flow_versions row whose graph contains a start node without a
-- filter, set the filter to the equivalent of the current behavior:
--   { scope: "all", installationIds: [<flows.installation_id>] }
-- evaluateTriggerFilter() with this filter accepts exactly the deliveries the
-- existing `flows.eq("installation_id", X)` query accepts, so dual-read should
-- show 100% parity once this migration runs.
--
-- Idempotent: the WHERE clause guards on filter IS NULL so re-runs are no-ops.
-- We backfill *all* flow_versions, not only the published one, because the
-- next publish would otherwise overwrite the filter back to null.

do $$
declare
  affected bigint;
begin
  with candidate_versions as (
    select
      fv.id,
      fv.graph,
      f.installation_id
    from public.flow_versions fv
    join public.flows f on f.id = fv.flow_id
    where f.installation_id is not null
      -- Guard against malformed rows where graph.nodes isn't a JSONB array;
      -- jsonb_array_elements would otherwise raise.
      and jsonb_typeof(fv.graph -> 'nodes') = 'array'
      and exists (
        select 1
        from jsonb_array_elements(fv.graph -> 'nodes') as n(node)
        where n.node ->> 'type' = 'start'
          -- jsonb_set on a path whose intermediate key is missing is a silent
          -- no-op even with create_if_missing=true. Require data to be an
          -- object so malformed start nodes are surfaced by the verification
          -- query below instead of being skipped on every re-run.
          and jsonb_typeof(n.node -> 'data') = 'object'
          and (n.node -> 'data' -> 'filter') is null
      )
  ),
  rewritten_versions as (
    select
      cv.id,
      jsonb_set(
        cv.graph,
        '{nodes}',
        (
          select jsonb_agg(
            case
              when n.node ->> 'type' = 'start'
                and jsonb_typeof(n.node -> 'data') = 'object'
                and (n.node -> 'data' -> 'filter') is null
                then jsonb_set(
                  n.node,
                  '{data,filter}',
                  jsonb_build_object(
                    'scope', 'all',
                    'installationIds', jsonb_build_array(cv.installation_id)
                  ),
                  true
                )
              else n.node
            end
            order by n.idx
          )
          from jsonb_array_elements(cv.graph -> 'nodes')
            with ordinality as n(node, idx)
        ),
        false
      ) as graph
    from candidate_versions cv
  ),
  updated as (
    update public.flow_versions fv
    set graph = rv.graph
    from rewritten_versions rv
    where fv.id = rv.id
    returning fv.id
  )
  select count(*) into affected from updated;

  -- Surface the affected row count in migration logs so the Phase 3
  -- go/no-go decision is auditable. Re-runs are idempotent and will
  -- report 0 once the backfill has converged.
  raise notice 'backfill_start_filter: updated % flow_versions row(s)', affected;
end;
$$;

-- Verification: this should return 0 rows after the migration runs.
-- Left here as a comment for the PR description / runbook; not executed.
--
-- select fv.id, fv.flow_id
-- from public.flow_versions fv,
--      lateral jsonb_array_elements(fv.graph -> 'nodes') as n
-- where n ->> 'type' = 'start'
--   and (n -> 'data' -> 'filter') is null;
