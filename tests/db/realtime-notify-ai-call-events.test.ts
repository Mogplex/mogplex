import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const USER_ID = "00000000-0000-4000-8000-00000000000a";
const CALL_ID = "00000000-0000-4000-8000-00000000000b";
const EVENT_ID = "00000000-0000-4000-8000-00000000000c";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.ai_call_events (
      id uuid primary key,
      user_id uuid not null,
      ai_call_id uuid not null
    );
  `);
  for (const migration of [
    "neon/migrations/20260803010000_realtime_notify_triggers.sql",
    "neon/migrations/20260825153000_scope_ai_call_event_notifications.sql",
  ]) {
    await db.exec(await readFile(path.join(REPO_ROOT, migration), "utf8"));
  }
});

afterAll(async () => {
  await db.close();
});

describe("AI call event notifications", () => {
  it("include the call id so subscribers can reject unrelated runs", async () => {
    const payloads: string[] = [];
    const unlisten = await db.listen("mogplex_table_events", (payload) =>
      payloads.push(payload)
    );

    await db.query(
      `insert into public.ai_call_events (id, user_id, ai_call_id)
       values ($1, $2, $3)`,
      [EVENT_ID, USER_ID, CALL_ID]
    );

    expect(payloads.map((payload) => JSON.parse(payload))).toEqual([
      expect.objectContaining({
        table: "ai_call_events",
        op: "INSERT",
        id: EVENT_ID,
        user_id: USER_ID,
        ai_call_id: CALL_ID,
      }),
    ]);
    await unlisten();
  });
});
