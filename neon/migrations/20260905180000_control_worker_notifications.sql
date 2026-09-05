-- Wake mission subscribers when a worker changes state, including after its
-- coordinator stream has ended. Uses the existing owner-scoped notification
-- payload; no command output or credentials are placed on the channel.
drop trigger if exists mogplex_notify_orchestration_worktrees on public.orchestration_worktrees;
create trigger mogplex_notify_orchestration_worktrees
  after insert or update or delete on public.orchestration_worktrees
  for each row execute function public.mogplex_notify_table_event();
