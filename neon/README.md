# Neon migrations

Schema source of truth for the Neon Postgres database that replaces Supabase at cutover (Neon + better-auth).

## Layout

- `migrations/` — ordered `YYYYMMDDHHMMSS_name.sql` files, applied sequentially. Applied versions are tracked in `neon_migrations.schema_migrations` on the target database.

## Relationship to `supabase/migrations/`

The Neon database was bootstrapped as a verified 1:1 structural mirror of the production Supabase database (all 194 Supabase migrations plus a Supabase-compat shim providing `auth`/`vault`/`storage` schemas and roles). That history lives in `supabase_migrations.schema_migrations` on Neon and stays frozen.

New Neon-only changes (better-auth tables, post-cutover schema work) go in this directory. Never add them to `supabase/migrations/` — the Supabase pipeline must not apply them, and vice versa.

Neon migrations may reference tables from the frozen mirror, including `public.sandboxes`. Database tests that apply only the Neon billing slice use the shared `SANDBOX_BILLING_SANDBOX_STUB_SQL` contract in `tests/db/harness.ts`; keep that stub limited to the columns the migrations actually require.

## Compat-shim deviations from real Supabase

- `vault.*` is a plaintext passthrough shim (structure-compatible, no encryption). Secret storage moves to app-layer encryption at cutover; do not store production secrets through the shim.
- `auth.users` is a minimal mirror (`id`, `email`, timestamps) that better-auth will sync/replace.
- `storage.*` is structural only — there is no object-storage service behind it.
- The bootstrap `supabase_realtime` publication was removed after cutover. Mogplex realtime uses scoped `pg_notify`/`LISTEN` channels instead of logical replication.

## Production runtime role

Serving deployments should connect directly as `service_role` through `MOGPLEX_RUNTIME_DATABASE_URL` and `MOGPLEX_RUNTIME_DATABASE_URL_UNPOOLED`. Migration `20260817190000_runtime_security_hardening.sql` leaves the role without `LOGIN`, removes administrative, replication, and schema-creation capabilities, grants only serving DML, and preserves the `BYPASSRLS` behavior required by the server-side PostgREST compatibility layer. Direct login is required because Neon's transaction pooler rejects `role` in startup options, so an intermediate login role cannot safely switch roles on pooled connections. After the migration lands, provision a rotatable password and enable `LOGIN` for `service_role` through an owner connection; the password must never appear in a migration or checked-in configuration. Migration tooling continues to use the owner-scoped `DATABASE_URL`.
