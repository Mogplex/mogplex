-- Team audit pagination needs a deterministic tiebreaker for rows that share
-- the same created_at timestamp.
create index if not exists team_audit_events_team_created_id_idx
  on public.team_audit_events (team_id, created_at desc, id desc);
