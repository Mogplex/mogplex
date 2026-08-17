import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../neon/migrations/20260817190000_runtime_security_hardening.sql",
  import.meta.url
);

const protectedTables = [
  "account",
  "oauthAccessToken",
  "oauthApplication",
  "oauthConsent",
  "session",
  "ssoProvider",
  "storage_objects",
  "user",
  "verification",
];

describe("Neon runtime security hardening", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create role neon_superuser nologin;
      create role neondb_owner nologin;
      alter schema public owner to neondb_owner;

      create table public.account (id text primary key);
      create table public."oauthAccessToken" (id text primary key);
      create table public."oauthApplication" (id text primary key);
      create table public."oauthConsent" (id text primary key);
      create table public.session (id text primary key);
      create table public."ssoProvider" (id text primary key);
      create table public.storage_objects (id uuid primary key);
      create table public."user" (id text primary key);
      create table public.verification (id text primary key);
      grant create on schema public to public;
      grant all on all tables in schema public to anon, authenticated;
      create publication supabase_realtime;
    `);

    await db.exec(await readFile(migrationUrl, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("strips Neon administrative capabilities but preserves server DML", async () => {
    const result = await db.query<{
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
      rolcanlogin: boolean;
      can_create_public: boolean;
      can_select_account: boolean;
      can_insert_account: boolean;
      can_set_owner: boolean;
    }>(`
      select
        role.rolcreatedb,
        role.rolcreaterole,
        role.rolreplication,
        role.rolbypassrls,
        role.rolinherit,
        role.rolcanlogin,
        has_schema_privilege('service_role', 'public', 'create')
          as can_create_public,
        has_table_privilege('service_role', 'public.account', 'select')
          as can_select_account,
        has_table_privilege('service_role', 'public.account', 'insert')
          as can_insert_account,
        pg_has_role('service_role', 'neondb_owner', 'set')
          as can_set_owner
      from pg_catalog.pg_roles role
      where role.rolname = 'service_role'
    `);

    expect(result.rows).toEqual([
      {
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: true,
        rolinherit: false,
        rolcanlogin: false,
        can_create_public: false,
        can_select_account: true,
        can_insert_account: true,
        can_set_owner: false,
      },
    ]);
  });

  it("enables RLS on every server-owned auth and storage table", async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `
      select relname, relrowsecurity
      from pg_catalog.pg_class
      where relnamespace = 'public'::regnamespace
        and relname = any($1::text[])
      order by relname
    `,
      [protectedTables]
    );

    expect(result.rows).toHaveLength(protectedTables.length);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("revokes client access and preserves future service-role DML", async () => {
    const clientPrivileges = await db.query<{
      anon_create: boolean;
      anon_select: boolean;
      authenticated_create: boolean;
      authenticated_select: boolean;
    }>(`
      select
        has_schema_privilege('anon', 'public', 'create') as anon_create,
        has_table_privilege('anon', 'public.account', 'select') as anon_select,
        has_schema_privilege('authenticated', 'public', 'create')
          as authenticated_create,
        has_table_privilege('authenticated', 'public.account', 'select')
          as authenticated_select
    `);

    expect(clientPrivileges.rows).toEqual([
      {
        anon_create: false,
        anon_select: false,
        authenticated_create: false,
        authenticated_select: false,
      },
    ]);

    await db.exec(`
      set role neondb_owner;
      create table public.future_runtime_table (id integer primary key);
      reset role;
    `);

    const futurePrivileges = await db.query<{
      can_delete: boolean;
      can_insert: boolean;
      can_select: boolean;
      can_update: boolean;
    }>(`
      select
        has_table_privilege(
          'service_role', 'public.future_runtime_table', 'delete'
        ) as can_delete,
        has_table_privilege(
          'service_role', 'public.future_runtime_table', 'insert'
        ) as can_insert,
        has_table_privilege(
          'service_role', 'public.future_runtime_table', 'select'
        ) as can_select,
        has_table_privilege(
          'service_role', 'public.future_runtime_table', 'update'
        ) as can_update
    `);

    expect(futurePrivileges.rows).toEqual([
      {
        can_delete: true,
        can_insert: true,
        can_select: true,
        can_update: true,
      },
    ]);
  });

  it("removes the unused logical replication publication", async () => {
    const result = await db.query<{ count: number }>(`
      select count(*)::int as count
      from pg_catalog.pg_publication
      where pubname = 'supabase_realtime'
    `);

    expect(result.rows).toEqual([{ count: 0 }]);
  });
});
