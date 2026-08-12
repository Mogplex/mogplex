-- Bind Control sessions to the exact repository selected by the operator.
-- Keep this loosely coupled during the Neon cutover: repos is still mirrored,
-- so repo_id intentionally has no foreign key.

alter table public.control_sessions
  add column if not exists repo_id uuid;

create index if not exists control_sessions_user_repo_idx
  on public.control_sessions (user_id, repo_id)
  where archived = false and repo_id is not null;
