-- Project grouping for control sessions: the sidebar clusters sessions
-- under the project they belong to (Conductor-style multi-project view).
-- Nullable: sessions without a project land in the client-side "General"
-- group, so existing rows need no backfill.

alter table public.control_sessions
  add column if not exists project text;

-- Group headers sort by latest activity per project.
create index if not exists control_sessions_user_project_idx
  on public.control_sessions (user_id, project)
  where archived = false;
