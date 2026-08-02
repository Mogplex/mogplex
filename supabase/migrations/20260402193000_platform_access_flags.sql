alter table public.profiles
  add column if not exists allow_platform_ai boolean not null default false,
  add column if not exists allow_platform_sandbox boolean not null default false;
