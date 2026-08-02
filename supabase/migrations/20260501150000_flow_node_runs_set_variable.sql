-- Slice 5: State Operators. Widen flow_node_runs.node_type to include
-- set_variable so the executor can persist node runs for state-mutation nodes
-- without violating the check constraint.
alter table public.flow_node_runs
  drop constraint if exists flow_node_runs_node_type_check;

alter table public.flow_node_runs
  add constraint flow_node_runs_node_type_check
  check (
    node_type in (
      'start',
      'agent',
      'condition',
      'parallel',
      'join',
      'delay',
      'await_event',
      'set_variable',
      'end'
    )
  );
