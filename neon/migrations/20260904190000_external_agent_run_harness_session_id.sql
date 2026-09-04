-- Persist the harness CLI session id (e.g. claude-code `--resume <id>`) so a
-- run paused at a checkpoint can be resumed in the same conversation. This is
-- distinct from `workspace_session_id`, which scopes memory, and from
-- `conversation_id`, which is the mogplex conversation.
alter table public.external_agent_runs
  add column if not exists harness_session_id text;
