import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import {
  finishCallAfterRuntime,
  syncRunAfterRuntime,
} from "@/lib/mogplex-api/run-runtime-store";
import { loadMogplexApiRun } from "@/lib/mogplex-api/runs";
import {
  buildAiCall,
  buildRunRow,
} from "../unit/helpers/mogplex-api-runs-fixtures";
import type { AiCall } from "@/lib/types";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";

const user = "00000000-0000-4000-8000-000000000001";
const otherUser = "00000000-0000-4000-8000-000000000002";
const repo = "00000000-0000-4000-8000-000000000003";
const callId = "00000000-0000-4000-8000-000000000004";
const runId = "00000000-0000-4000-8000-000000000005";
let pg: PGlite;
let client: SupabaseClient;
const expectedRun = () =>
  buildRunRow({
    id: runId,
    user_id: user,
    repo_id: repo,
    ai_call_id: callId,
    status: "streaming",
    runtime_provider: "trigger",
    runtime_run_id: "run_worker",
  });
const expectedCall = () =>
  buildAiCall({
    id: callId,
    user_id: user,
    repo_id: repo,
    status: "streaming",
    started_at: new Date().toISOString(),
  });

beforeAll(async () => {
  pg = await PGlite.create({
    parsers: Object.fromEntries(
      Object.entries(SHIM_TYPE_PARSERS).map(([oid, parser]) => [
        Number(oid),
        parser,
      ])
    ),
  });
  await pg.exec(`
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function public.current_profile_id() returns uuid language sql as $$select auth.uid()$$;
    create table profiles(id uuid primary key);
    create table repos(id uuid primary key);
    create table sandboxes(id uuid primary key);
    create table limit_events(route_key text);
  `);
  for (const filename of [
    "20260316195044_add_ai_calls.sql",
    "20260322113000_ai_call_events_control_plane.sql",
    "20260322144500_ai_call_cancellation_control.sql",
    "20260428100000_external_agent_runs.sql",
    "20260904184000_external_agent_run_awaiting_input.sql",
  ]) {
    await pg.exec(
      await readFile(
        new URL(`../../supabase/migrations/${filename}`, import.meta.url),
        "utf8"
      )
    );
  }
  await pg.query("insert into auth.users values ($1),($2)", [user, otherUser]);
  await pg.query("insert into profiles values ($1),($2)", [user, otherUser]);
  await pg.query("insert into repos values ($1)", [repo]);
  const queryable: Queryable = {
    query: async (text, values) => {
      const result = await pg.query(text, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
  client = createPostgrestShim(queryable) as unknown as SupabaseClient;
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.exec("truncate external_agent_runs, ai_calls cascade");
  await pg.query(
    "insert into ai_calls(id,user_id,repo_id,type,model,status,input_tokens,runtime_command_id) values ($1,$2,$3,'agent','test-model','streaming',123,'cmd_retained')",
    [callId, user, repo]
  );
  await pg.query(
    "insert into external_agent_runs(id,user_id,repo_id,ai_call_id,idempotency_key,request_hash,harness,status,prompt,base_branch,working_branch,runtime_provider,runtime_run_id) values ($1,$2,$3,$4,'test','hash','codex','streaming','test','main','fix/test','trigger','run_worker')",
    [runId, user, repo, callId]
  );
});

it("finalizes without erasing usage or retained command identity", async () => {
  const result = await finishCallAfterRuntime(
    expectedCall(),
    "failed",
    "worker timed out",
    client
  );
  expect(result).toMatchObject({
    status: "failed",
    input_tokens: 123,
    runtime_command_id: "cmd_retained",
    error: "worker timed out",
  });
  expect(result?.completed_at).toBeTruthy();
});
it("rejects cross-user call and run updates", async () => {
  expect(
    await finishCallAfterRuntime(
      { ...expectedCall(), user_id: otherUser },
      "failed",
      "timeout",
      client
    )
  ).toBeNull();
  expect(
    await syncRunAfterRuntime(
      { ...expectedRun(), user_id: otherUser },
      "failed",
      "timeout",
      client
    )
  ).toBeNull();
});
it("can reconcile an old orphan without overflowing duration_ms", async () => {
  const result = await finishCallAfterRuntime(
    { ...expectedCall(), started_at: "2020-01-01T00:00:00Z" },
    "failed",
    "worker stopped",
    client
  );
  expect(result?.status).toBe("failed");
  expect(result?.duration_ms).toBe(2_147_483_647);
});
it("cannot overwrite a cancellation requested after the call was read", async () => {
  await pg.exec("update ai_calls set control_state='cancel_requested'");
  expect(
    await finishCallAfterRuntime(expectedCall(), "failed", "timeout", client)
  ).toBeNull();
});
it.each(["success", "failed", "cancelled"] as const)(
  "cannot rewrite a terminal %s call",
  async (status) => {
    await pg.query("update ai_calls set status=$1", [status]);
    expect(
      await finishCallAfterRuntime(expectedCall(), "failed", "timeout", client)
    ).toBeNull();
  }
);
it.each(["success", "failed", "cancelled", "awaiting_input"] as const)(
  "cannot rewrite a terminal or paused %s run",
  async (status) => {
    await pg.query("update external_agent_runs set status=$1", [status]);
    expect(
      await syncRunAfterRuntime(expectedRun(), "failed", "timeout", client)
    ).toBeNull();
  }
);
it("cannot apply an older runtime or segment result", async () => {
  expect(
    await syncRunAfterRuntime(
      { ...expectedRun(), runtime_run_id: "run_old" },
      "failed",
      "timeout",
      client
    )
  ).toBeNull();
  expect(
    await syncRunAfterRuntime(
      { ...expectedRun(), ai_call_id: repo },
      "failed",
      "timeout",
      client
    )
  ).toBeNull();
  expect(
    await syncRunAfterRuntime(
      { ...expectedRun(), runtime_run_id: null },
      "failed",
      "timeout",
      client
    )
  ).toBeNull();
});
it("can reconcile an unassigned legacy runtime only while it is still unassigned", async () => {
  await pg.exec("update external_agent_runs set runtime_run_id=null");
  expect(
    await syncRunAfterRuntime(
      { ...expectedRun(), runtime_run_id: null },
      "failed",
      "timeout",
      client
    )
  ).toMatchObject({ status: "failed" });
});

it("a public detail read repairs a hard-timed-out run through actual SQL, without restarting work", async () => {
  const loadRun = async () =>
    (
      await pg.query<ExternalAgentRunRow>(
        "select * from external_agent_runs where id=$1 and user_id=$2",
        [runId, user]
      )
    ).rows[0] ?? null;
  const loadCall = async () =>
    (
      await pg.query<AiCall>(
        "select * from ai_calls where id=$1 and user_id=$2",
        [callId, user]
      )
    ).rows[0] ?? null;
  const notifications: string[] = [];
  const detail = await loadMogplexApiRun({
    userId: user,
    runId,
    deps: { loadRunById: loadRun },
    runtimeDeps: {
      readRuntime: async () => ({
        id: "run_worker",
        taskIdentifier: "execute-external-agent-run",
        status: "TIMED_OUT",
      }),
      loadRun,
      loadCall,
      finishCall: (call, status, error) =>
        finishCallAfterRuntime(call, status, error, client),
      syncRun: (run, status, error) =>
        syncRunAfterRuntime(run, status, error, client),
      appendEvent: async () => null,
      notifyTerminal: async (_run, status) => {
        notifications.push(status);
      },
    },
  });
  expect(detail).toMatchObject({
    status: "failed",
    error: "Agent worker timed out before completion.",
  });
  expect(await loadCall()).toMatchObject({
    status: "failed",
    input_tokens: 123,
    runtime_command_id: "cmd_retained",
  });
  expect(notifications).toEqual(["failed"]);
});
