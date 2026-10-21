import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

const owner = "00000000-0000-4000-8000-000000000001";
const teammate = "00000000-0000-4000-8000-000000000002";
const team = "00000000-0000-4000-8000-000000000003";
const otherTeam = "00000000-0000-4000-8000-000000000004";
const migration = new URL(
  "../../neon/migrations/20261021170000_team_domain_join.sql",
  import.meta.url
);

describe("verified domain team enrollment", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table public."user" (id uuid primary key, email text, "emailVerified" boolean);
      create table public.profiles (id uuid primary key, auth_user_id uuid references public."user"(id), email text);
      create table public.teams (id uuid primary key, name text);
      create table public.team_members (team_id uuid references public.teams(id) on delete cascade,
        user_id uuid references public.profiles(id) on delete cascade, role text,
        primary key (team_id, user_id));
      create table public.team_audit_events (team_id uuid, actor_user_id uuid, action text, target_type text, target_id text, payload jsonb);
      create table public.session (id text primary key, "userId" uuid references public."user"(id));
      insert into public."user" values ('${owner}', 'owner@example.com', true);
      insert into public.profiles values ('${owner}', '${owner}', 'owner@example.com');
      insert into public.teams values ('${team}', 'Example'), ('${otherTeam}', 'Other');
      insert into public.team_members values ('${team}', '${owner}', 'owner');
      grant usage on schema public to service_role;
      grant select, insert, update, delete on all tables in schema public to service_role;
    `);
    await db.exec(await readFile(migration, "utf8"));
  });
  afterEach(async () => {
    await db.close();
  });

  async function signup(email = "person@example.com", verified = true) {
    await db.query('insert into public."user" values ($1,$2,$3)', [
      teammate,
      email,
      verified,
    ]);
    await db.query("insert into public.profiles values ($1,$1,$2)", [
      teammate,
      "untrusted@another.test",
    ]);
  }
  async function enable() {
    await db.query(
      "update public.teams set signup_email_domain=$1 where id=$2",
      ["example.com", team]
    );
  }
  async function memberships() {
    return (
      await db.query<{ team_id: string; role: string }>(
        "select team_id,role from public.team_members where user_id=$1",
        [teammate]
      )
    ).rows;
  }
  async function signIn() {
    await db.query("insert into public.session values ($1,$2)", [
      crypto.randomUUID(),
      teammate,
    ]);
  }

  it("is off by default and preserves existing owner membership", async () => {
    await signup();
    await signIn();
    expect(await memberships()).toEqual([]);
    expect(
      (
        await db.query(
          "select role from public.team_members where user_id=$1",
          [owner]
        )
      ).rows
    ).toEqual([{ role: "owner" }]);
  });
  it("joins only the matching team as Developer and audits exactly once", async () => {
    await enable();
    await signup("Person@EXAMPLE.COM");
    await signIn();
    await signIn();
    expect(await memberships()).toEqual([{ team_id: team, role: "developer" }]);
    expect(
      (
        await db.query(
          "select action,actor_user_id,payload from public.team_audit_events"
        )
      ).rows
    ).toEqual([
      {
        action: "member.joined_by_domain",
        actor_user_id: teammate,
        payload: { role: "developer" },
      },
    ]);
  });
  it("waits for email verification, then joins without another login", async () => {
    await enable();
    await signup("person@example.com", false);
    await signIn();
    expect(await memberships()).toEqual([]);
    await db.query(
      'update public."user" set "emailVerified"=true where id=$1',
      [teammate]
    );
    expect(await memberships()).toEqual([{ team_id: team, role: "developer" }]);
  });
  for (const email of [
    "a@sub.example.com",
    "a@fakeexample.com",
    "a@example.com.evil.test",
    "a@another.test",
  ]) {
    it(`does not admit ${email}`, async () => {
      await enable();
      await signup(email);
      await signIn();
      expect(await memberships()).toEqual([]);
    });
  }
  it("uses the verified auth email rather than a matching profile email", async () => {
    await enable();
    await signup("person@another.test");
    await db.query("update public.profiles set email=$1 where id=$2", [
      "person@example.com",
      teammate,
    ]);
    await signIn();
    expect(await memberships()).toEqual([]);
  });
  it("admits an existing verified account on its next sign-in, preserving assigned roles", async () => {
    await signup();
    await enable();
    await signIn();
    await db.query("update public.team_members set role=$1 where user_id=$2", [
      "viewer",
      teammate,
    ]);
    await signIn();
    expect(await memberships()).toEqual([{ team_id: team, role: "viewer" }]);
  });
  it("disabling preserves members but stops new joins", async () => {
    await signup();
    await enable();
    await db.query(
      "update public.teams set signup_email_domain=null where id=$1",
      [team]
    );
    await signIn();
    expect(await memberships()).toEqual([]);
    await enable();
    await signIn();
    await db.query(
      "update public.teams set signup_email_domain=null where id=$1",
      [team]
    );
    await signIn();
    expect(await memberships()).toHaveLength(1);
  });
  it("does not silently re-add a removed member, but permits explicit re-add", async () => {
    await enable();
    await signup();
    await db.query("delete from public.team_members where user_id=$1", [
      teammate,
    ]);
    await signIn();
    expect(await memberships()).toEqual([]);
    await db.query("insert into public.team_members values ($1,$2,$3)", [
      team,
      teammate,
      "developer",
    ]);
    expect(await memberships()).toHaveLength(1);
  });
  it("supports parent deletion cascades and server-role enrollment", async () => {
    await enable();
    await db.exec("set role service_role");
    await signup();
    expect(await memberships()).toHaveLength(1);
    await db.exec("reset role");
    await db.query("delete from public.profiles where id=$1", [teammate]);
    expect(await memberships()).toEqual([]);
    await db.query("delete from public.teams where id=$1", [team]);
    expect(
      (await db.query("select * from public.team_domain_join_blocks")).rows
    ).toEqual([]);
  });
  it("does not grant enrollment or block-list access to client roles", async () => {
    const result = await db.query<{ allowed: boolean }>(`select
      has_function_privilege('authenticated', 'public.enroll_verified_email_teams(uuid)', 'execute')
      or has_table_privilege('authenticated', 'public.team_domain_join_blocks', 'insert') as allowed`);
    expect(result.rows).toEqual([{ allowed: false }]);
  });
});
