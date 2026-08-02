alter table public.sandboxes
  add column if not exists snapshot_billing_project_id text,
  add column if not exists snapshot_billing_team_id text;
