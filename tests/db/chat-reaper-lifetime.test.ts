import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { reapStaleAiCalls } from "@/lib/zombies/zombie-reaper-ai-calls";

it("preserves a live extended chat while reaping expired chats and prepared harness calls", async () => {
  const pg = await PGlite.create();
  try {
    await pg.exec(`
      create table ai_calls(id text primary key, type text, status text, started_at timestamptz,
        user_id text, conversation_id text, repo_id text, metadata jsonb, error text, completed_at timestamptz);
      create table control_continuations(resume_ai_call_id text, user_id text);
      create table ai_call_events(ai_call_id text, user_id text, conversation_id text, repo_id text,
        event_type text, message text, payload jsonb);
    `);
    const now = Date.now();
    for (const [id, type, ageMs, metadata] of [
      ["dead-control", "agent", 15 * 60_000, { surface: "control" }],
      ["dead-legacy-control", "chat", 15 * 60_000, { surface: "control" }],
      ["live-control", "agent", 13 * 60_000, { surface: "control" }],
      [
        "live-continuation",
        "agent",
        15 * 60_000,
        { surface: "control", control_runtime: "background" },
      ],
      [
        "dead-continuation",
        "agent",
        32 * 60_000,
        { surface: "control", control_runtime: "background" },
      ],
      ["quiet-chat", "chat", 330_000, {}],
      ["expired-chat", "chat", 31 * 60_000, {}],
      ["prepared-agent", "agent", 3 * 60_000, { prepared: true }],
      ["legacy-continuation", "agent", 15 * 60_000, { surface: "control" }],
      ["live-agent", "agent", 31 * 60_000, {}],
    ] as const) {
      await pg.query(
        "insert into ai_calls(id,type,status,started_at,user_id,metadata) values($1,$2,'streaming',$3,'owner',$4)",
        [
          id,
          type,
          new Date(now - ageMs).toISOString(),
          JSON.stringify(metadata),
        ]
      );
    }
    await pg.exec(
      "insert into control_continuations values ('legacy-continuation', 'owner')"
    );
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await pg.query(text, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const client = createPostgrestShim(queryable) as unknown as SupabaseClient;
    const results = await Promise.all([
      reapStaleAiCalls(client),
      reapStaleAiCalls(client),
    ]);
    expect(results.map((result) => result.error)).toEqual([null, null]);
    expect(results.reduce((count, result) => count + result.reaped, 0)).toBe(5);
    const states = await pg.query<{ id: string; status: string }>(
      "select id,status from ai_calls order by id"
    );
    expect(states.rows).toEqual([
      { id: "dead-continuation", status: "failed" },
      { id: "dead-control", status: "failed" },
      { id: "dead-legacy-control", status: "failed" },
      { id: "expired-chat", status: "failed" },
      { id: "legacy-continuation", status: "streaming" },
      { id: "live-agent", status: "streaming" },
      { id: "live-continuation", status: "streaming" },
      { id: "live-control", status: "streaming" },
      { id: "prepared-agent", status: "failed" },
      { id: "quiet-chat", status: "streaming" },
    ]);
    const events = await pg.query<{ ai_call_id: string }>(
      "select ai_call_id from ai_call_events order by ai_call_id"
    );
    expect(events.rows).toEqual([
      { ai_call_id: "dead-continuation" },
      { ai_call_id: "dead-control" },
      { ai_call_id: "dead-legacy-control" },
      { ai_call_id: "expired-chat" },
      { ai_call_id: "prepared-agent" },
    ]);
  } finally {
    await pg.close();
  }
});
