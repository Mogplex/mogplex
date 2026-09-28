import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { claimTerminalRunSandboxPause } from "@/lib/mogplex-api/run-sandbox-cleanup";
import { buildRunRow } from "../unit/helpers/mogplex-api-runs-fixtures";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const run = buildRunRow({
  id: id(1),
  user_id: id(2),
  repo_id: id(3),
  ai_call_id: id(4),
  sandbox_record_id: id(5),
  sandbox_id: "persistent-vm",
  runtime_run_id: "worker",
  status: "failed",
  create_branch: true,
});
let db: PGlite;
let client: SupabaseClient;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table sandboxes(id uuid primary key, user_id uuid, repo_id uuid,
      sandbox_id text, working_branch text, status text, health_status text,
      stop_reason text, persistent boolean, exec_lock_token uuid, last_active_at timestamptz);
    create table external_agent_runs(id uuid primary key, user_id uuid,
      repo_id uuid, sandbox_record_id uuid, sandbox_id text, working_branch text,
      ai_call_id uuid, runtime_run_id text, status text, create_branch boolean,
      worktree_id uuid);
    create table ai_calls(id uuid primary key, user_id uuid, status text,
      completed_at timestamptz, metadata jsonb default '{}');
    create table sandbox_client_sessions(sandbox_record_id uuid, released_at timestamptz);
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../neon/migrations/20260928175000_external_run_sandbox_cleanup.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  }) as unknown as SupabaseClient;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    "truncate sandboxes, external_agent_runs, ai_calls, sandbox_client_sessions"
  );
  await db.query(
    `insert into sandboxes values ($1,$2,$3,$4,$5,'running','running',null,true,null,'2026-09-28T12:00:00Z')`,
    [id(5), id(2), id(3), run.sandbox_id, run.working_branch]
  );
  await db.query(
    `insert into external_agent_runs values ($1,$2,$3,$4,$5,$6,$7,'worker','failed',true,null)`,
    [id(1), id(2), id(3), id(5), run.sandbox_id, run.working_branch, id(4)]
  );
  await db.query(
    `insert into ai_calls(id,user_id,status,completed_at) values ($1,$2,'failed','2026-09-28T12:01:00Z')`,
    [id(4), id(2)]
  );
});

it.each(["success", "failed", "cancelled"])(
  "claims the %s run's VM while its preview is still attached",
  async (status) => {
    await db.query("update external_agent_runs set status=$1", [status]);
    await db.query("update ai_calls set status=$1", [status]);
    await db.query("insert into sandbox_client_sessions values ($1,null)", [
      id(5),
    ]);
    expect(await claimTerminalRunSandboxPause(run, client)).toMatchObject({
      id: id(5),
      status: "running",
      sandbox_id: "persistent-vm",
    });
    expect(
      (await db.query("select status,stop_reason from sandboxes")).rows
    ).toEqual([{ status: "pausing", stop_reason: "auto_pause" }]);
    expect(await claimTerminalRunSandboxPause(run, client)).toBeNull();
  }
);

it.each([
  "update external_agent_runs set runtime_run_id='new-worker'",
  `update external_agent_runs set ai_call_id='${id(6)}'`,
  "update external_agent_runs set status='awaiting_input'",
  "update external_agent_runs set create_branch=false",
  `update external_agent_runs set worktree_id='${id(6)}'`,
  "update sandboxes set sandbox_id='replacement'",
  "update sandboxes set persistent=false",
  "update sandboxes set repo_id=null",
  `update sandboxes set user_id='${id(6)}'`,
  `update sandboxes set exec_lock_token='${id(6)}'`,
  "update sandboxes set last_active_at='2026-09-28T12:02:00Z'",
  "update ai_calls set status='streaming'",
])("leaves newer or shared work intact: %s", async (sql) => {
  await db.exec(sql);
  expect(await claimTerminalRunSandboxPause(run, client)).toBeNull();
  expect((await db.query("select status from sandboxes")).rows[0]).toEqual({
    status: "running",
  });
});

it("refuses another owner and any active sibling call", async () => {
  expect(
    await claimTerminalRunSandboxPause({ ...run, user_id: id(8) }, client)
  ).toBeNull();
  await db.query(
    "insert into ai_calls(id,user_id,status,metadata) values ($1,$2,'streaming',$3)",
    [id(6), id(2), { sandbox_record_id: id(5) }]
  );
  expect(await claimTerminalRunSandboxPause(run, client)).toBeNull();
});

it.each(["pending", "streaming", "awaiting_input"])(
  "keeps a sibling %s run alive",
  async (status) => {
    await db.query(
      "insert into external_agent_runs(id,sandbox_record_id,status) values ($1,$2,$3)",
      [id(6), id(5), status]
    );
    expect(await claimTerminalRunSandboxPause(run, client)).toBeNull();
  }
);

it("allows only the server role to claim cleanup", async () => {
  const result = await db.query(`select
    has_function_privilege('service_role','claim_terminal_run_sandbox_pause(uuid,uuid,uuid,text)','execute') as server,
    has_function_privilege('authenticated','claim_terminal_run_sandbox_pause(uuid,uuid,uuid,text)','execute') as browser`);
  expect(result.rows).toEqual([{ server: true, browser: false }]);
});
