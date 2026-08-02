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
      'end'
    )
  );
