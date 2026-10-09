import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import {
  findOrphanedWorkerCalls,
  stopOrphanedWorkers,
} from "@/lib/zombies/zombie-reaper-orphans";

describe("stopOrphanedWorkers", () => {
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
      const client = createPostgrestShim(
        queryable
      ) as unknown as SupabaseClient;
      const retried: Array<{ id: string; error: string }> = [];

      const result = await stopOrphanedWorkers(client, now, async (input) => {
        if (input.call.id === "broken") throw new Error("Trigger unavailable");
        retried.push({ id: input.call.id, error: input.error });
        return true;
      });

      expect(retried.map((call) => call.id).toSorted()).toEqual([
        "orphan-run",
        "orphan-ticket",
      ]);
      expect(retried[0].error).toBe(
        "Stopped after 31 minutes with no progress."
      );
      expect(result.failures).toEqual([
        { id: "broken", error: "Trigger unavailable" },
      ]);
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
      const client = createPostgrestShim(
        queryable
      ) as unknown as SupabaseClient;

      const result = await stopOrphanedWorkers(client, Date.now(), async () => {
        throw new Error("must not be called");
      });

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].id).toBe("orphan-sweep");
    } finally {
      await pg.close();
    }
  });
});

describe("findOrphanedWorkerCalls dedupe", () => {
  it("deduplicates call ids appearing in both runs and continuations", async () => {
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

      // Same call id in both tables (unusual but possible)
      const sharedCallId = "shared-call";
      await pg.query(
        "insert into ai_calls values ($1,'owner',null,'Stopped.',$2,$3)",
        [sharedCallId, "failed", minutesAgo(10)]
      );
      await pg.query(
        "insert into external_agent_runs values ($1,'streaming')",
        [sharedCallId]
      );
      await pg.query(
        "insert into control_continuations values ($1,'running')",
        [sharedCallId]
      );

      const queryable: Queryable = {
        query: async (text, values) => {
          const result = await pg.query(text, values);
          return { rows: result.rows as Record<string, unknown>[] };
        },
      };
      const client = createPostgrestShim(
        queryable
      ) as unknown as SupabaseClient;

      const orphans = await findOrphanedWorkerCalls(client, now);

      // Should only return one entry despite the call appearing in both tables
      expect(orphans).toHaveLength(1);
      expect(orphans[0].id).toBe(sharedCallId);
    } finally {
      await pg.close();
    }
  });
});

describe("findOrphanedWorkerCalls batching", () => {
  it("handles more than 100 call ids by batching queries", async () => {
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

      // Create 150 runs to exceed the 100-id batch limit
      for (let i = 0; i < 150; i++) {
        const id = `call-${String(i).padStart(3, "0")}`;
        await pg.query(
          "insert into ai_calls values ($1,'owner',null,'Stopped.',$2,$3)",
          [id, "failed", minutesAgo(10)]
        );
        await pg.query(
          "insert into external_agent_runs values ($1,'streaming')",
          [id]
        );
      }

      // Track queries to ai_calls to verify batching
      const aiCallsQuerySizes: number[] = [];
      const queryable: Queryable = {
        query: async (text, values) => {
          // Count .in() sizes for ai_calls queries
          if (text.includes('"ai_calls"') && values && Array.isArray(values)) {
            // Find the largest array parameter (the batch of ids)
            const maxArraySize = values
              .filter((v): v is unknown[] => Array.isArray(v))
              .reduce((max, arr) => Math.max(max, arr.length), 0);
            if (maxArraySize > 0) {
              aiCallsQuerySizes.push(maxArraySize);
            }
          }
          const result = await pg.query(text, values);
          return { rows: result.rows as Record<string, unknown>[] };
        },
      };
      const client = createPostgrestShim(
        queryable
      ) as unknown as SupabaseClient;

      const orphans = await findOrphanedWorkerCalls(client, now);

      // Verify all 150 orphans found
      expect(orphans).toHaveLength(150);

      // Verify batching: 150 ids should be split into 2 batches (100 + 50)
      expect(aiCallsQuerySizes).toHaveLength(2);
      expect(aiCallsQuerySizes).toContain(100);
      expect(aiCallsQuerySizes).toContain(50);
    } finally {
      await pg.close();
    }
  });
});
