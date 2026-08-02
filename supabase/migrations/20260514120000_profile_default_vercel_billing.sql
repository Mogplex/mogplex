alter table profiles
  add column if not exists default_vercel_project_id text,
  add column if not exists default_vercel_team_id text;
