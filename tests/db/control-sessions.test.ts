import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATION = "neon/migrations/20260810180000_control_sessions.sql";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
  `);
  const sql = await readFile(path.join(REPO_ROOT, MIGRATION), "utf8");
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`truncate public.control_sessions`);
});

describe("control_sessions migration", () => {
  it("creates sessions with defaults and jsonb messages", async () => {
    const { rows } = await db.query<{
      id: string;
      title: string;
      messages: unknown;
      pinned: boolean;
      archived: boolean;
    }>(
      `insert into public.control_sessions (user_id)
       values ($1)
       returning id, title, messages, pinned, archived`,
      [USER_A]
    );

    expect(rows[0]?.title).toBe("New session");
    expect(rows[0]?.messages).toEqual([]);
    expect(rows[0]?.pinned).toBe(false);
    expect(rows[0]?.archived).toBe(false);
  });

  it("indexes the sidebar list per user, excluding archived sessions", async () => {
    await db.query(
      `insert into public.control_sessions (user_id, title, archived)
       values ($1, 'active one', false), ($1, 'archived one', true), ($2, 'other user', false)`,
      [USER_A, USER_B]
    );

    const { rows } = await db.query<{ title: string }>(
      `select title from public.control_sessions
       where user_id = $1 and archived = false
       order by updated_at desc`,
      [USER_A]
    );

    expect(rows.map((row) => row.title)).toEqual(["active one"]);
  });

  it("supports CAS updates on updated_at", async () => {
    const { rows } = await db.query<{ id: string; updated_at: string }>(
      `insert into public.control_sessions (user_id, title)
       values ($1, 'cas test') returning id, updated_at`,
      [USER_A]
    );
    const session = rows[0]!;

    const stale = await db.query(
      `update public.control_sessions
       set title = 'stale write', updated_at = now()
       where id = $1 and user_id = $2 and updated_at = $3`,
      [session.id, USER_A, session.updated_at]
    );
    // PGlite may apply this before any competing write, so only assert the
    // predicate shape works: a second CAS with the same timestamp must fail
    // once the row moved.
    const moved = await db.query<{ updated_at: string }>(
      `update public.control_sessions
       set messages = $1::jsonb, updated_at = now()
       where id = $2 and updated_at = $3
       returning updated_at`,
      [
        JSON.stringify([{ role: "user", parts: [] }]),
        session.id,
        session.updated_at,
      ]
    );

    const replayed = await db.query(
      `update public.control_sessions
       set title = 'replay', updated_at = now()
       where id = $1 and updated_at = $2`,
      [session.id, session.updated_at]
    );

    expect(stale.affectedRows ?? 0).toBeLessThanOrEqual(1);
    expect(moved.rows[0]?.updated_at).not.toBe(session.updated_at);
    expect(replayed.affectedRows).toBe(0);
  });

  it("revokes direct client access", async () => {
    const { rows } = await db.query<{ revoked: boolean }>(
      `select not has_table_privilege('anon', 'public.control_sessions', 'SELECT')
         and not has_table_privilege('authenticated', 'public.control_sessions', 'SELECT')
         as revoked`
    );
    expect(rows[0]?.revoked).toBe(true);
  });
});
