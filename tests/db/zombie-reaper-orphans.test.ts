import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { stopOrphanedWorkers } from "@/lib/zombies/zombie-reaper-orphans";

it("retries the worker stop only for recently ended calls whose run is still active", async () => {
  const pg = await PGlite.create();
  try {
    await pg.exec(`
      create table external_agent_runs(ai_call_id text, status text);
      create table control_continuations(resume_ai_call_id text, status text);
      create table ai_calls(id text primary key, user_id text, runtime_command_id text, error text,
        status text, completed_at timestamptz);
    `);
    const now = Date.now();
    const minutesAgo = (minutes: number) =>
      new Date(now - minutes * 60_000).toISOString();
    for (const [id, status, completedAt] of [
      ["orphan-run", "failed", minutesAgo(10)],
      ["just-ended", "failed", minutesAgo(2)],
      ["long-ago", "failed", minutesAgo(48 * 60)],
      ["still-running", "streaming", null],
      ["finished-run", "failed", minutesAgo(10)],
      ["orphan-ticket", "failed", minutesAgo(10)],
      ["broken", "failed", minutesAgo(10)],
    ] as const) {
      await pg.query(
        "insert into ai_calls values ($1,'owner',null,'Stopped after 31 minutes with no progress.',$2,$3)",
        [id, status, completedAt]
      );
    }
    await pg.exec(`
      insert into external_agent_runs values
        ('orphan-run','streaming'), ('just-ended','streaming'), ('long-ago','pending'),
        ('still-running','streaming'), ('finished-run','failed'), ('broken','streaming');
      insert into control_continuations values ('orphan-ticket','running');
    `);
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await pg.query(text, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const client = createPostgrestShim(queryable) as unknown as SupabaseClient;
    const retried: Array<{ id: string; error: string }> = [];

    const failures = await stopOrphanedWorkers(client, now, async (input) => {
      if (input.call.id === "broken") throw new Error("Trigger unavailable");
      retried.push({ id: input.call.id, error: input.error });
      return true;
    });

    expect(retried.map((call) => call.id).toSorted()).toEqual([
      "orphan-run",
      "orphan-ticket",
    ]);
    expect(retried[0].error).toBe("Stopped after 31 minutes with no progress.");
    expect(failures).toEqual([{ id: "broken", error: "Trigger unavailable" }]);
  } finally {
    await pg.close();
  }
});

it("reports a sweep that can't read run state as one failure", async () => {
  const pg = await PGlite.create();
  try {
    const queryable: Queryable = {
      query: async (text, values) => {
        const result = await pg.query(text, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const client = createPostgrestShim(queryable) as unknown as SupabaseClient;

    const failures = await stopOrphanedWorkers(client, Date.now(), async () => {
      throw new Error("must not be called");
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].id).toBe("orphan-sweep");
  } finally {
    await pg.close();
  }
});
