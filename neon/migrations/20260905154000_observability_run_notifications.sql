-- Keep run state and decision requests live without polling. Payloads contain
-- identity only; clients reload through their owner-checked HTTP endpoints.
do $$
begin
  if to_regclass('public.external_agent_runs') is not null then
    drop trigger if exists mogplex_notify_external_agent_runs on public.external_agent_runs;
    create trigger mogplex_notify_external_agent_runs
      after insert or update or delete on public.external_agent_runs
      for each row execute function public.mogplex_notify_table_event();
  end if;
  if to_regclass('public.flow_waits') is not null then
    drop trigger if exists mogplex_notify_flow_waits on public.flow_waits;
    create trigger mogplex_notify_flow_waits
      after insert or update or delete on public.flow_waits
      for each row execute function public.mogplex_notify_table_event();
  end if;
end $$;
