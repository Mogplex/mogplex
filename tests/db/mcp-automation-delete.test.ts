import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMogplexApiAutomationDeleteHandler } from "@/app/api/v1/mogplex/automations/[automationId]/route";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { MogplexApiClient } from "@/lib/mogplex-api/client";
import { callMogplexTool } from "@/lib/mogplex-api/mcp-handlers";
import { supabaseAdmin } from "@/lib/supabase/admin";

const owner = "00000000-0000-4000-8000-000000000021";
const stranger = "00000000-0000-4000-8000-000000000022";
const finished = "00000000-0000-4000-8000-000000000031";
const busy = "00000000-0000-4000-8000-000000000032";
const foreign = "00000000-0000-4000-8000-000000000033";
const finishedVersion = "00000000-0000-4000-8000-000000000041";
const finishedRun = "00000000-0000-4000-8000-000000000051";
const runningRun = "00000000-0000-4000-8000-000000000052";
const pendingRun = "00000000-0000-4000-8000-000000000053";

let db: PGlite;
const previous = new Map<string, PropertyDescriptor | undefined>();
const previousTriggerKey = process.env.TRIGGER_SECRET_KEY;
const scheduleRequests: string[] = [];

/** The MCP tool, the API client, the DELETE route and the service, for real. */
function deleteAs(userId: string, automationId: string) {
  const handler = createMogplexApiAutomationDeleteHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId, keyId: "test", scopes: ["read", "write"] },
    }),
  });
  const client = new MogplexApiClient({
    baseUrl: "https://mogplex.test",
    authorization: "mog_test",
    fetch: async (url, init) =>
      handler(
        new NextRequest(String(url), {
          ...init,
          signal: init?.signal ?? undefined,
        }),
        {
          params: Promise.resolve({
            automationId: new URL(String(url)).pathname.split("/").at(-1)!,
          }),
        }
      ),
  });
  return callMogplexTool(
    "mogplex_delete_automation",
    { automationId },
    {
      client,
    }
  );
}

async function count(table: string, column: string, id: string) {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from ${table} where ${column} = $1`,
    [id]
  );
  return rows[0]?.count ?? 0;
}

describe("mogplex_delete_automation against the migrated schema", () => {
  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
      parsers: SHIM_TYPE_PARSERS,
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);

    await db.query("insert into profiles(id) values ($1),($2)", [
      owner,
      stranger,
    ]);
    await db.query(
      `insert into flows(id,user_id,installation_id,name,status,trigger_schedule_id) values
         ($1,$4,123,'Finished probe','active','sched_probe'),
         ($2,$4,123,'Busy probe','inactive',null),
         ($3,$5,456,'Someone else''s','inactive',null)`,
      [finished, busy, foreign, owner, stranger]
    );
    await db.query(
      "insert into flow_versions(id,flow_id,version_number,graph) values ($1,$2,1,'{}')",
      [finishedVersion, finished]
    );
    await db.query("update flows set published_version_id=$1 where id=$2", [
      finishedVersion,
      finished,
    ]);
    await db.query(
      `insert into job_runs(id,flow_id,flow_version_id,status) values
         ($1,$4,$6,'success'),($2,$5,null,'running'),($3,$5,null,'pending')`,
      [finishedRun, runningRun, pendingRun, finished, busy, finishedVersion]
    );
    await db.query(
      `insert into flow_node_runs(user_id,job_run_id,flow_id,node_id,node_type,status)
         values ($1,$2,$3,'start','start','success')`,
      [owner, finishedRun, finished]
    );

    const shim = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    });
    for (const key of ["from", "rpc"] as const) {
      previous.set(key, Object.getOwnPropertyDescriptor(supabaseAdmin, key));
      Object.defineProperty(supabaseAdmin, key, {
        configurable: true,
        value: shim[key].bind(shim),
      });
    }

    process.env.TRIGGER_SECRET_KEY = "tr_dev_test";
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (!url.hostname.endsWith("trigger.dev")) {
          throw new Error(`Unexpected external request: ${url}`);
        }
        scheduleRequests.push(`${init?.method ?? "GET"} ${url.pathname}`);
        return Response.json({ id: "sched_probe" });
      }
    );
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (previousTriggerKey === undefined) delete process.env.TRIGGER_SECRET_KEY;
    else process.env.TRIGGER_SECRET_KEY = previousTriggerKey;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(supabaseAdmin, key, descriptor);
      else Reflect.deleteProperty(supabaseAdmin, key);
    }
    await db.close();
  });

  it("should refuse an automation with in-flight runs and leave it intact", async () => {
    const result = await deleteAs(owner, busy);

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
    expect(result.content[0]?.text).toContain("2 runs are still in flight");
    expect(result.content[0]?.text).toContain(runningRun);
    expect(result.content[0]?.text).toContain(pendingRun);
    expect(await count("flows", "id", busy)).toBe(1);
  });

  it("should not delete or reveal another user's automation", async () => {
    const result = await deleteAs(owner, foreign);

    expect(result.structuredContent?.error).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(await count("flows", "id", foreign)).toBe(1);
  });

  it("should delete the schedule, versions and node runs, and keep the job run", async () => {
    const result = await deleteAs(owner, finished);

    expect(result.isError, JSON.stringify(result)).toBe(false);
    expect(result.structuredContent).toEqual({
      deleted: true,
      automationId: finished,
      name: "Finished probe",
    });
    expect(scheduleRequests).toEqual(["DELETE /api/v1/schedules/sched_probe"]);
    expect(await count("flows", "id", finished)).toBe(0);
    expect(await count("flow_versions", "flow_id", finished)).toBe(0);
    expect(await count("flow_node_runs", "job_run_id", finishedRun)).toBe(0);
    const { rows } = await db.query<{ flow_id: string | null }>(
      "select flow_id from job_runs where id = $1",
      [finishedRun]
    );
    expect(rows).toEqual([{ flow_id: null }]);
  });

  it("should report a second delete of the same automation as not found", async () => {
    const result = await deleteAs(owner, finished);

    expect(result.structuredContent?.error).toMatchObject({ status: 404 });
  });

  it("should delete once the in-flight runs have settled", async () => {
    await db.query(
      "update job_runs set status='cancelled' where flow_id = $1",
      [busy]
    );

    const result = await deleteAs(owner, busy);

    expect(result.isError, JSON.stringify(result)).toBe(false);
    expect(await count("flows", "id", busy)).toBe(0);
  });
});
