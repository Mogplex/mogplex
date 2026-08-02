alter table public.repos
  add column if not exists vercel_link_status text not null default 'unknown',
  add column if not exists vercel_link_checked_at timestamptz null,
  add column if not exists vercel_link_error_code text null,
  add column if not exists vercel_link_message text null;

alter table public.workspaces
  add column if not exists vercel_link_status text not null default 'unknown',
  add column if not exists vercel_link_checked_at timestamptz null,
  add column if not exists vercel_link_error_code text null,
  add column if not exists vercel_link_message text null;

update public.repos
set
  vercel_link_status = coalesce(vercel_link_status, 'unknown')
where vercel_link_status is null;

update public.workspaces
set
  vercel_link_status = coalesce(vercel_link_status, 'unknown')
where vercel_link_status is null;

alter table public.repos
  add constraint repos_vercel_link_status_check
  check (vercel_link_status in ('unknown', 'valid', 'missing_project', 'auth_invalid', 'inaccessible'));

alter table public.workspaces
  add constraint workspaces_vercel_link_status_check
  check (vercel_link_status in ('unknown', 'valid', 'missing_project', 'auth_invalid', 'inaccessible'));
