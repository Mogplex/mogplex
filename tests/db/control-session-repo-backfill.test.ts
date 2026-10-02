import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migration = new URL(
  "../../neon/migrations/20261002213000_control_session_repo_backfill.sql",
  import.meta.url
);

it("backfills only unique accessible repository names and preserves session content", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;`);
    for (const name of [
      "20260810180000_control_sessions.sql",
      "20260810190000_control_sessions_project.sql",
      "20260812120000_control_sessions_repo.sql",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../../neon/migrations/${name}`, import.meta.url),
          "utf8"
        )
      );
    }
    await db.exec(`
      create table repos (id uuid primary key, user_id uuid, name text, full_name text, owner_type text, owner_user_id uuid, product_team_id uuid);
      create table team_members (team_id uuid, user_id uuid);
      insert into repos values
        ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'widgets', 'acme/widgets', 'user', '00000000-0000-4000-8000-000000000001', null),
        ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'widgets', 'other/widgets', 'user', '00000000-0000-4000-8000-000000000001', null),
        ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'api', 'acme/api', 'user', '00000000-0000-4000-8000-000000000001', null),
        ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000002', null, 'team/shared', 'team', null, '00000000-0000-4000-8000-000000000020'),
        ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000002', 'private', 'other/private', 'user', '00000000-0000-4000-8000-000000000002', null),
        ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001', 'secret', 'team/secret', 'team', null, '00000000-0000-4000-8000-000000000021'),
        ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000002', 'duplicate', 'team/duplicate', 'team', null, '00000000-0000-4000-8000-000000000020'),
        ('00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000001', 'duplicate', 'team/duplicate', 'user', '00000000-0000-4000-8000-000000000001', null);
      insert into team_members values ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001');
    `);
    for (const [title, project, repoId] of [
      ["full", " ACME/widgets ", null],
      ["short", " API ", null],
      ["ambiguous", "widgets", null],
      ["team", "shared", null],
      ["other-user", "private", null],
      ["not-member", "secret", null],
      ["same-full-name", "team/duplicate", null],
      ["unknown", "missing", null],
      ["blank", " ", null],
      ["no-project", null, null],
      ["already-linked", "widgets", "00000000-0000-4000-8000-000000000013"],
    ]) {
      await db.query(
        `insert into control_sessions(user_id,title,project,repo_id,messages,pinned,archived,updated_at) values ('00000000-0000-4000-8000-000000000001',$1,$2,$3,'[{"role":"user","parts":[]}]',true,true,'2026-01-01')`,
        [title, project, repoId]
      );
    }
    const before = (
      await db.query(
        "select id,project,messages,pinned,archived,updated_at from control_sessions order by id"
      )
    ).rows;
    const sql = await readFile(migration, "utf8");
    await db.exec(sql);
    const rows = (
      await db.query<{ title: string; repo_id: string | null }>(
        "select title,repo_id from control_sessions"
      )
    ).rows;
    const actual = Object.fromEntries(rows.map((r) => [r.title, r.repo_id]));
    expect(actual).toEqual({
      full: "00000000-0000-4000-8000-000000000011",
      short: "00000000-0000-4000-8000-000000000013",
      ambiguous: null,
      team: "00000000-0000-4000-8000-000000000014",
      "other-user": null,
      "not-member": null,
      "same-full-name": null,
      unknown: null,
      blank: null,
      "no-project": null,
      "already-linked": "00000000-0000-4000-8000-000000000013",
    });
    expect(
      (
        await db.query(
          "select id,project,messages,pinned,archived,updated_at from control_sessions order by id"
        )
      ).rows
    ).toEqual(before);
    await db.exec(sql);
    expect(
      (await db.query("select title,repo_id from control_sessions")).rows
    ).toEqual(rows);
  } finally {
    await db.close();
  }
});
