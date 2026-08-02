-- Allow deterministic transform nodes to persist their execution results.
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
      'parallel',
      'join',
      'delay',
      'await_event',
      'set_variable',
      'transform',
      'end'
    )
  );
