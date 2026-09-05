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
      create table ai_call_events(ai_call_id text, user_id text, conversation_id text, repo_id text,
        event_type text, message text, payload jsonb);
    `);
    const now = Date.now();
    for (const [id, type, ageMs, metadata] of [
      ["quiet-chat", "chat", 330_000, {}],
      ["expired-chat", "chat", 31 * 60_000, {}],
      ["prepared-agent", "agent", 3 * 60_000, { prepared: true }],
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
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await pg.query(text, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const result = await reapStaleAiCalls(
      createPostgrestShim(queryable) as unknown as SupabaseClient
    );
    expect(result.error).toBeNull();
    expect(result.reaped).toBe(2);
    const states = await pg.query<{ id: string; status: string }>(
      "select id,status from ai_calls order by id"
    );
    expect(states.rows).toEqual([
      { id: "expired-chat", status: "failed" },
      { id: "live-agent", status: "streaming" },
      { id: "prepared-agent", status: "failed" },
      { id: "quiet-chat", status: "streaming" },
    ]);
    const events = await pg.query<{ ai_call_id: string }>(
      "select ai_call_id from ai_call_events order by ai_call_id"
    );
    expect(events.rows).toEqual([
      { ai_call_id: "expired-chat" },
      { ai_call_id: "prepared-agent" },
    ]);
  } finally {
    await pg.close();
  }
});
