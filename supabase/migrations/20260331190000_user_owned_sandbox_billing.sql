alter table public.workspaces
  add column if not exists sandbox_billing_mode text not null default 'platform',
  add column if not exists sandbox_vercel_team_id text,
  add column if not exists sandbox_vercel_project_id text;

do $$
begin
  alter table public.workspaces
    add constraint workspaces_sandbox_billing_mode_check
    check (sandbox_billing_mode in ('platform', 'user_vercel_project'));
exception
  when duplicate_object then null;
end $$;

alter table public.repos
  add column if not exists sandbox_billing_mode_override text;

do $$
begin
  alter table public.repos
    add constraint repos_sandbox_billing_mode_override_check
    check (
      sandbox_billing_mode_override is null
      or sandbox_billing_mode_override in ('platform', 'user_vercel_project')
    );
exception
  when duplicate_object then null;
end $$;

alter table public.sandboxes
  add column if not exists billing_source text,
  add column if not exists billing_team_id text,
  add column if not exists billing_project_id text;

do $$
begin
  alter table public.sandboxes
    add constraint sandboxes_billing_source_check
    check (
      billing_source is null
      or billing_source in ('platform', 'user_vercel_project')
    );
exception
  when duplicate_object then null;
end $$;

update public.sandboxes
set
  billing_project_id = coalesce(billing_project_id, vercel_project_id),
  billing_team_id = coalesce(billing_team_id, vercel_team_id)
where billing_project_id is null
   or billing_team_id is null;
