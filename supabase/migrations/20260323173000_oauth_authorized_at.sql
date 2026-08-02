alter table public.connections
  add column if not exists oauth_authorized_at timestamptz;
