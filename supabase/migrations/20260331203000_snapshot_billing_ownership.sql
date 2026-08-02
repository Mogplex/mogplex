alter table public.repos
  add column if not exists snapshot_billing_source text,
  add column if not exists snapshot_billing_team_id text,
  add column if not exists snapshot_billing_project_id text;

do $$
begin
  alter table public.repos
    add constraint repos_snapshot_billing_source_check
    check (
      snapshot_billing_source is null
      or snapshot_billing_source in ('platform', 'user_vercel_project')
    );
exception
  when duplicate_object then null;
end $$;
