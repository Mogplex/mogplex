import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { createRunGuidancePostHandler } from "@/app/api/runs/[runId]/guidance/route";
import { loadWorkspaceRun } from "@/lib/run-workspace/context";
import {
  deliverRunGuidance,
  findSlackGuidanceRuns,
  loadRunGuidance,
  submitSlackRunGuidance,
  submitWorkspaceRunGuidance,
} from "@/lib/slack/run-guidance-store";

const run = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const call = "00000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000004";
const slackRun = "00000000-0000-4000-8000-000000000005";
const migrations = [
  "20260905124500_slack_run_guidance.sql",
  "20261026014000_workspace_run_guidance.sql",
  "20261026021000_run_guidance_replies.sql",
];
const readMigration = (name: string) =>
  readFile(new URL(`../../neon/migrations/${name}`, import.meta.url), "utf8");
let db: PGlite;
let client: SupabaseClient;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key);
    create table ai_calls(id uuid primary key);
    create table external_agent_runs(id uuid primary key, user_id uuid, ai_call_id uuid, status text, harness text, metadata jsonb, slack_progress jsonb, slack_progress_revision bigint not null default 0);`);
  for (const name of migrations) await db.exec(await readMigration(name));
  client = createPostgrestShim({
    query: async (sql, values) => {
      const result = await db.query(sql, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  }) as unknown as SupabaseClient;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("truncate external_agent_runs, profiles, ai_calls cascade");
  await db.query("insert into profiles values($1),($2)", [owner, other]);
  await db.query("insert into ai_calls values($1),($2)", [call, other]);
  // An API/MCP-started native run: no Slack thread to reply in.
  await db.query(
    "insert into external_agent_runs(id,user_id,ai_call_id,status,harness,metadata) values($1,$2,$3,'streaming','mogplex','{}'::jsonb)",
    [run, owner, call]
  );
});

const request = (body: unknown) =>
  new Request("http://localhost/api/runs/guidance", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const handler = (userId: string) =>
  createRunGuidancePostHandler({
    requireUserId: async () => userId,
    loadRun: (actor, runId) => loadWorkspaceRun(actor, runId, client),
    submit: (input) => submitSlackRunGuidance(input, client),
    submitWorkspace: (input) => submitWorkspaceRunGuidance(input, client),
  });
const post = (userId: string, runId: string, body: unknown) =>
  handler(userId)(request(body), { params: Promise.resolve({ runId }) });
const guidanceId = "00000000-0000-4000-8000-0000000000a1";

it("lets the owner steer a native run that did not start in Slack, once per message", async () => {
  const body = {
    id: guidanceId,
    text: "Stop web fetching; wait for the exec quota.",
  };
  const first = await post(owner, run, body);
  expect(first.status).toBe(200);
  const receipt = await first.json();
  expect(receipt).toMatchObject({ status: "received" });
  expect(await (await post(owner, run, body)).json()).toEqual(receipt);
  expect(await (await post(other, run, body)).status).toBe(404);
  const rows = await loadRunGuidance(
    { id: run, user_id: owner, ai_call_id: call },
    client
  );
  expect(rows.map(({ body: text, status }) => ({ text, status }))).toEqual([
    { text: "Stop web fetching; wait for the exec quota.", status: "received" },
  ]);
});

it("delivers workspace guidance on a model step and settles it when the run stops", async () => {
  const accepted = await submitWorkspaceRunGuidance(
    {
      userId: owner,
      runId: run,
      aiCallId: call,
      eventId: "workspace:a",
      body: "First",
    },
    client
  );
  const pending = await submitWorkspaceRunGuidance(
    {
      userId: owner,
      runId: run,
      aiCallId: call,
      eventId: "workspace:b",
      body: "Second",
    },
    client
  );
  expect(
    await deliverRunGuidance(
      {
        runId: run,
        userId: owner,
        aiCallId: call,
        ids: [accepted!.id],
        step: 2,
      },
      client
    )
  ).toBe(1);
  await db.query("update external_agent_runs set status='cancelled'");
  const statuses = Object.fromEntries(
    (
      await loadRunGuidance(
        { id: run, user_id: owner, ai_call_id: call },
        client
      )
    ).map((row) => [row.id, row.status])
  );
  expect(statuses).toEqual({
    [accepted!.id]: "delivered",
    [pending!.id]: "not_applied",
  });
  expect(
    await (await post(owner, run, { id: guidanceId, text: "Too late" })).json()
  ).toMatchObject({ status: "not_applied" });
});

it("refuses other owners, stale segments, CLI harnesses and blank text", async () => {
  const submit = (changes: Record<string, string>) =>
    submitWorkspaceRunGuidance(
      {
        userId: owner,
        runId: run,
        aiCallId: call,
        eventId: "workspace:x",
        body: "Go",
        ...changes,
      },
      client
    );
  expect(await submit({ userId: other })).toBeNull();
  expect(await submit({ aiCallId: other })).toBeNull();
  await expect(submit({ body: "  " })).rejects.toThrow();
  await db.query("update external_agent_runs set harness='claude-code'");
  expect(await submit({})).toBeNull();
  expect((await post(owner, run, { id: guidanceId, text: "Go" })).status).toBe(
    409
  );
  expect(
    (await db.query("select count(*)::int as count from slack_run_guidance"))
      .rows
  ).toEqual([{ count: 0 }]);
});

it("keeps Slack-thread runs on their thread receipt and out of other threads", async () => {
  await db.query(
    "insert into external_agent_runs(id,user_id,ai_call_id,status,harness,metadata) values($1,$2,$3,'streaming','mogplex',$4)",
    [
      slackRun,
      owner,
      call,
      JSON.stringify({
        slack_guidance_enabled: true,
        slack_user_id: "U1",
        slack_thread_ts: "1.2",
        slackRunControls: { teamId: "T1", channelId: "D1", messageTs: "1.2" },
      }),
    ]
  );
  expect(
    (await post(owner, slackRun, { id: guidanceId, text: "Slack" })).status
  ).toBe(200);
  expect(
    (await post(owner, run, { id: guidanceId, text: "Workspace" })).status
  ).toBe(200);
  expect(
    (
      await db.query(
        "select run_id,slack_team_id,thread_ts,event_id from slack_run_guidance order by body"
      )
    ).rows
  ).toEqual([
    {
      run_id: slackRun,
      slack_team_id: "T1",
      thread_ts: "1.2",
      event_id: `workspace:${guidanceId}`,
    },
    {
      run_id: run,
      slack_team_id: null,
      thread_ts: null,
      event_id: `workspace:${guidanceId}`,
    },
  ]);
  const thread = {
    userId: owner,
    teamId: "T1",
    channelId: "D1",
    threadTs: "1.2",
    slackUserId: "U1",
    eventId: `workspace:${guidanceId}`,
  };
  expect(
    (await findSlackGuidanceRuns(thread, client)).map((row) => row.id)
  ).toEqual([slackRun]);
});

it("is idempotent and keeps the inbox RPC away from clients", async () => {
  for (const name of migrations) await db.exec(await readMigration(name));
  expect(
    (
      await db.query(
        "select has_function_privilege('authenticated','submit_run_guidance(uuid,uuid,uuid,text,text)','execute') as allowed"
      )
    ).rows
  ).toEqual([{ allowed: false }]);
});
