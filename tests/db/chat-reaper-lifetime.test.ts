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
        user_id text, conversation_id text, repo_id text, runtime_command_id text, metadata jsonb, error text,
        completed_at timestamptz);
      create table control_continuations(resume_ai_call_id text, user_id text, status text);
      create table external_agent_runs(ai_call_id text, status text);
      create table ai_call_events(ai_call_id text, user_id text, conversation_id text, repo_id text,
        event_type text, message text, payload jsonb, created_at timestamptz default now());
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
        "busy-continuation",
        "agent",
        2 * 60 * 60_000,
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
      "insert into control_continuations values ('legacy-continuation', 'owner', 'running')"
    );
    // Old, but it reported progress five minutes ago.
    await pg.query(
      "insert into ai_call_events(ai_call_id,user_id,event_type,created_at) values('busy-continuation','owner','log',$1)",
      [new Date(now - 5 * 60_000).toISOString()]
    );
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await pg.query(text, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const client = createPostgrestShim(queryable) as unknown as SupabaseClient;
    const stopped: string[] = [];
    const stopWorker = async (input: { call: { id: string } }) => {
      stopped.push(input.call.id);
      if (input.call.id === "expired-chat") throw new Error("Trigger down");
      return false;
    };
    const results = await Promise.all([
      reapStaleAiCalls(client, stopWorker),
      reapStaleAiCalls(client, stopWorker),
    ]);
    expect(results.map((result) => result.error)).toEqual([null, null]);
    // A stop that fails is reported; the next cycle's sweep retries it.
    expect(
      results.flatMap((result) =>
        result.results.filter((entry) => entry.action === "worker_stop_failed")
      )
    ).toEqual([
      {
        table: "ai_calls",
        id: "expired-chat",
        ageMs: null,
        action: "worker_stop_failed",
        detail: "Trigger down",
      },
    ]);
    expect(results.reduce((count, result) => count + result.reaped, 0)).toBe(5);
    const states = await pg.query<{ id: string; status: string }>(
      "select id,status from ai_calls order by id"
    );
    expect(states.rows).toEqual([
      { id: "busy-continuation", status: "streaming" },
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
    // Each reaped call has its worker stopped once; live ones are untouched.
    expect(stopped.toSorted()).toEqual([
      "dead-continuation",
      "dead-control",
      "dead-legacy-control",
      "expired-chat",
      "prepared-agent",
    ]);
    const reaped = await pg.query<{ error: string }>(
      "select error from ai_calls where id='dead-continuation'"
    );
    expect(reaped.rows[0].error).toBe(
      "Stopped after 31 minutes with no progress."
    );
    const events = await pg.query<{ ai_call_id: string }>(
      "select ai_call_id from ai_call_events where event_type='failed' order by ai_call_id"
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
