import { PGlite } from "@electric-sql/pglite";
import { NextResponse } from "next/server";
import { beforeAll, afterAll, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { loadRunWorkspace } from "@/lib/run-workspace/context";
import { createRunWorkspaceGetHandler } from "@/app/api/runs/[runId]/workspace/route";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
let client: SupabaseClient;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create table external_agent_runs(id uuid,user_id uuid,repo_id text,ai_call_id text,sandbox_record_id text,working_branch text,root_directory text,status text,prompt text,harness text,metadata jsonb);
    create table repos(id text,user_id uuid,full_name text,created_at text,default_branch text,root_directory text,sandbox_env_vars jsonb);
    create table sandboxes(id text,user_id uuid,repo_id text,working_branch text);
    insert into repos values ('repo','${owner}','acme/mobile','','main',null,'{"SECRET":"do-not-send"}');
    insert into sandboxes values ('sandbox','${owner}','repo','fix/mobile');
    insert into external_agent_runs values ('${runId}','${owner}','repo','call','sandbox','fix/mobile','apps/web','streaming','Fix the header','mogplex','{}');`);
  client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  }) as unknown as SupabaseClient;
});
afterAll(async () => {
  await db.close();
});

it("loads the owned run and exact sandbox without exposing repository secrets", async () => {
  const context = await loadRunWorkspace(owner, runId, client);
  expect(context).toMatchObject({
    runId,
    sandboxRecordId: "sandbox",
    workingBranch: "fix/mobile",
    repo: { root_directory: "apps/web" },
  });
  expect(JSON.stringify(context)).not.toContain("do-not-send");
  expect(await loadRunWorkspace(other, runId, client)).toBeNull();
});

it("never binds a sandbox belonging to another owner, repo or branch", async () => {
  for (const [field, value] of [
    ["user_id", other],
    ["repo_id", "wrong"],
    ["working_branch", "main"],
  ]) {
    await db.query(`update sandboxes set ${field}=$1`, [value]);
    expect(
      (await loadRunWorkspace(owner, runId, client))?.sandboxRecordId
    ).toBeNull();
    await db.query(
      "update sandboxes set user_id=$1,repo_id='repo',working_branch='fix/mobile'",
      [owner]
    );
  }
});

it("the HTTP boundary returns 401, 400, 404 and the real owned context", async () => {
  const loadContext: typeof loadRunWorkspace = (user, run) =>
    loadRunWorkspace(user, run, client);
  const request = new Request("http://localhost/api/runs/workspace");
  for (const [userId, id, status] of [
    [null, runId, 401],
    [owner, "bad-id", 400],
    [other, runId, 404],
    [owner, runId, 200],
  ] as const) {
    const handler = createRunWorkspaceGetHandler({
      requireUserId: async () =>
        userId ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      loadContext,
    });
    const response = await handler(request, {
      params: Promise.resolve({ runId: id }),
    });
    expect(response.status).toBe(status);
    if (status === 200)
      expect(await response.json()).toMatchObject({
        runId,
        sandboxRecordId: "sandbox",
      });
  }
});
