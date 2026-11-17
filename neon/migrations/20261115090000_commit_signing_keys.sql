-- Per-user SSH commit signing keys.
--
-- The private key is stored AES-256-GCM encrypted (see
-- lib/commit-signing/secret-box.ts) and is only decrypted inside the sandbox
-- bootstrap that has to sign a commit. The table is service-role only: the
-- ciphertext must never be readable through the PostgREST API, so no
-- `authenticated` policy is created.
create table if not exists public.commit_signing_keys (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  encrypted_private_key text not null,
  public_key text not null,
  fingerprint text not null,
  title text,
  github_key_id text,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.commit_signing_keys enable row level security;
create policy commit_signing_keys_service_role on public.commit_signing_keys
  to service_role using (true) with check (true);

revoke all on table public.commit_signing_keys from public;
-- Neon does not require Supabase's optional end-user roles to exist.
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname=role_name) then
      execute format('revoke all on table public.commit_signing_keys from %I', role_name);
    end if;
  end loop;
end;
$$;
grant select, insert, update, delete on table public.commit_signing_keys to service_role;
