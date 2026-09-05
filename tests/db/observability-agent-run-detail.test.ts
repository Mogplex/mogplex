import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { loadAgentRunDetail } from "@/lib/observability/agent-run-detail";
import { loadAgentRunRowsFromDb } from "@/lib/observability/agent-run-jobs";

it("loads only the owned run, repo, call and events without leaking integration metadata", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table external_agent_runs(id text,user_id text,repo_id text,ai_call_id text,harness text,status text,prompt text,metadata jsonb,created_at text,updated_at text);
      create table repos(id text,user_id text,full_name text,github_installation_id int,secret text);
      create table ai_calls(id text,user_id text,status text,model text);
      create table ai_call_events(id text,ai_call_id text,user_id text,message text,created_at text);
      insert into external_agent_runs values ('run','owner','repo','call','mogplex','awaiting_input','Fix header','{"secret":"hidden"}','2026-09-05','2026-09-05');
      insert into repos values ('repo','owner','acme/widgets',null,'repo-secret');
      insert into ai_calls values ('call','owner','streaming','model');
      insert into ai_call_events values ('event','call','owner','Review request','2026-09-05'),('foreign','call','other','foreign-content','2026-09-05');`);
    const client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
      }),
    }) as unknown as SupabaseClient;
    expect(await loadAgentRunDetail("other", "run", client)).toBeNull();
    const result = await loadAgentRunDetail("owner", "run", client);
    expect(result).toMatchObject({
      id: "run",
      metadata: { run_status: "awaiting_input" },
      repo: { full_name: "acme/widgets" },
      ai_calls: [{ events: [{ id: "event" }] }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /hidden|repo-secret|foreign-content/
    );
    await db.exec(
      "update repos set user_id='other'; update ai_calls set user_id='other';"
    );
    const isolated = await loadAgentRunDetail("owner", "run", client);
    expect(isolated?.repo.full_name).toBeNull();
    expect(isolated?.ai_calls).toEqual([]);
  } finally {
    await db.close();
  }
});

it("keeps input-waiting agent runs visible in active work without crossing owners", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table external_agent_runs(id text,user_id text,status text,created_at text);
      insert into external_agent_runs values ('waiting','owner','awaiting_input','2026-09-05'),('active','owner','streaming','2026-09-05'),('done','owner','success','2026-09-05'),('foreign','other','awaiting_input','2026-09-05');`);
    const client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
      }),
    }) as unknown as SupabaseClient;
    const rows = await loadAgentRunRowsFromDb(
      { userId: "owner", status: "streaming", from: undefined, to: undefined },
      client
    );
    expect(rows.map((row) => row.id)).toEqual(["waiting", "active"]);
    const waiting = await loadAgentRunRowsFromDb(
      {
        userId: "owner",
        status: "awaiting_input",
        from: undefined,
        to: undefined,
      },
      client
    );
    expect(waiting.map((row) => row.id)).toEqual(["waiting"]);
  } finally {
    await db.close();
  }
});
