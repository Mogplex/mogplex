import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  import.meta.dirname,
  "../../neon/migrations/20260805191000_disable_unavailable_vercel_user_compute.sql"
);

let db: PGlite | null = null;

afterEach(async () => {
  await db?.close();
  db = null;
});

describe("disabled personal Vercel settings migration", () => {
  it("clears every legacy activation field without changing platform rows", async () => {
    db = await PGlite.create();
    await db.exec(/* sql */ `
      create table workspaces (
        id text primary key,
        sandbox_billing_mode text not null,
        sandbox_vercel_team_id text,
        sandbox_vercel_project_id text,
        vercel_link_status text not null,
        vercel_link_checked_at timestamptz,
        vercel_link_error_code text,
        vercel_link_message text
      );
      create table repos (
        id text primary key,
        sandbox_billing_mode_override text,
        sandbox_billing_target text not null,
        vercel_team_id text,
        vercel_project_id text,
        vercel_link_status text not null,
        vercel_link_checked_at timestamptz,
        vercel_link_error_code text,
        vercel_link_message text
      );
      create table profiles (
        id text primary key,
        default_vercel_project_id text,
        default_vercel_team_id text
      );

      insert into workspaces values
        ('legacy', 'user_vercel_project', 'team-1', 'project-1', 'valid', now(), null, 'ready'),
        ('platform', 'platform', null, null, 'unknown', null, null, null);
      insert into repos values
        ('legacy', 'user_vercel_project', 'team', 'team-1', 'project-1', 'valid', now(), null, 'ready'),
        ('platform', 'platform', 'personal', null, null, 'unknown', null, null, null);
      insert into profiles values
        ('legacy', 'project-1', 'team-1'),
        ('platform', null, null);
    `);

    await db.exec(await readFile(migrationPath, "utf8"));

    const workspaces = await db.query<{
      id: string;
      sandbox_billing_mode: string;
      sandbox_vercel_project_id: string | null;
      vercel_link_status: string;
    }>(
      "select id, sandbox_billing_mode, sandbox_vercel_project_id, vercel_link_status from workspaces order by id"
    );
    expect(workspaces.rows).toEqual([
      {
        id: "legacy",
        sandbox_billing_mode: "platform",
        sandbox_vercel_project_id: null,
        vercel_link_status: "unknown",
      },
      {
        id: "platform",
        sandbox_billing_mode: "platform",
        sandbox_vercel_project_id: null,
        vercel_link_status: "unknown",
      },
    ]);

    const repos = await db.query<{
      id: string;
      sandbox_billing_mode_override: string | null;
      sandbox_billing_target: string;
      vercel_project_id: string | null;
    }>(
      "select id, sandbox_billing_mode_override, sandbox_billing_target, vercel_project_id from repos order by id"
    );
    expect(repos.rows).toEqual([
      {
        id: "legacy",
        sandbox_billing_mode_override: null,
        sandbox_billing_target: "personal",
        vercel_project_id: null,
      },
      {
        id: "platform",
        sandbox_billing_mode_override: "platform",
        sandbox_billing_target: "personal",
        vercel_project_id: null,
      },
    ]);

    const profiles = await db.query<{
      id: string;
      default_vercel_project_id: string | null;
    }>("select id, default_vercel_project_id from profiles order by id");
    expect(profiles.rows).toEqual([
      { id: "legacy", default_vercel_project_id: null },
      { id: "platform", default_vercel_project_id: null },
    ]);
  });
});
