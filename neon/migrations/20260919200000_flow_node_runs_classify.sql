-- Allow classify nodes to persist their execution results. A classify node
-- asks one closed question about run state and routes on the typed answer.
-- Widening only: every value the deployed app and workers already write stays
-- valid, so this is safe to apply before the app that adds the node type.
-- The table is small (tens of thousands of rows), so revalidating the check
-- inside the migration's transaction holds its lock only briefly.
alter table public.flow_node_runs
  drop constraint if exists flow_node_runs_node_type_check;

alter table public.flow_node_runs
  add constraint flow_node_runs_node_type_check
  check (
    node_type in (
      'start',
      'agent',
      'action',
      'condition',
      'classify',
      'parallel',
      'join',
      'delay',
      'await_event',
      'set_variable',
      'transform',
      'end'
    )
  );
