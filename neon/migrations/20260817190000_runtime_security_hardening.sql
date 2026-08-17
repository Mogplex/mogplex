-- Keep serving traffic on the existing non-owner service_role. It remains
-- NOLOGIN until a rotatable password is provisioned after this migration,
-- keeping credentials out of source control. Connecting directly as this role
-- also works through Neon's transaction pooler; transaction pooling rejects a
-- startup `SET ROLE`, so an intermediate login role is not safe here.
do $runtime_role$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role'
  ) then
    raise exception using
      message = 'service_role is required for serving traffic';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members memberships
    join pg_catalog.pg_roles member_role
      on member_role.oid = memberships.member
    where member_role.rolname = 'service_role'
  ) then
    raise exception using
      message = 'service_role must not be a member of another role';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and (rolsuper or rolcreatedb or rolcreaterole or rolreplication)
  ) then
    raise exception using
      message = 'service_role must not have administrative or replication capabilities';
  end if;

  -- Fail loudly above instead of attempting NOSUPERUSER: Neon project owners
  -- cannot alter another role's superuser flag, and a privileged service role
  -- requires operator review rather than a partially applied migration.
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception using
      message = 'service_role must retain BYPASSRLS for the server-side data layer';
  end if;

  alter role service_role with
    nologin noinherit nocreatedb nocreaterole noreplication;

  grant usage on schema public to service_role;
  grant select, insert, update, delete
    on all tables in schema public to service_role;
  grant usage, select, update
    on all sequences in schema public to service_role;

  if exists (
    select 1 from pg_catalog.pg_namespace where nspname = 'extensions'
  ) then
    grant usage on schema extensions to service_role;
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'neondb_owner'
  ) then
    alter default privileges for role neondb_owner in schema public
      grant select, insert, update, delete on tables to service_role;
    alter default privileges for role neondb_owner in schema public
      grant usage, select, update on sequences to service_role;
  end if;

  alter role service_role set statement_timeout = '15min';
  alter role service_role set lock_timeout = '30s';
  alter role service_role set idle_in_transaction_session_timeout = '60s';
end
$runtime_role$;

-- Public schema object creation is never required by serving traffic.
revoke create on schema public from public;

-- Better Auth and the structural storage shim are server-owned. The frozen
-- Supabase-compat bootstrap guarantees anon/authenticated exist. Enabling RLS
-- without client policies makes future direct grants fail closed, while the
-- active service_role preserves the existing server behavior via BYPASSRLS.
alter table public.account enable row level security;
alter table public."oauthAccessToken" enable row level security;
alter table public."oauthApplication" enable row level security;
alter table public."oauthConsent" enable row level security;
alter table public.session enable row level security;
alter table public."ssoProvider" enable row level security;
alter table public.storage_objects enable row level security;
alter table public."user" enable row level security;
alter table public.verification enable row level security;

revoke all on table
  public.account,
  public."oauthAccessToken",
  public."oauthApplication",
  public."oauthConsent",
  public.session,
  public."ssoProvider",
  public.storage_objects,
  public."user",
  public.verification
from public, anon, authenticated;

-- Mogplex realtime is implemented with scoped pg_notify/LISTEN channels. No
-- logical replication consumer exists, so retaining this bootstrap artifact
-- unnecessarily widens the replication surface.
drop publication if exists supabase_realtime;
