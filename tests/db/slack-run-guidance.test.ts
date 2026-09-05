import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  submitSlackRunGuidance,
  deliverRunGuidance,
  loadRunGuidance,
  findSlackGuidanceRuns,
} from "@/lib/slack/run-guidance-store";

const run = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const call = "00000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000004";
let db: PGlite;
let client: SupabaseClient;
const migration = (backend = "supabase") =>
  readFile(
    new URL(
      `../../${backend}/migrations/20260905124500_slack_run_guidance.sql`,
      import.meta.url
    ),
    "utf8"
  );

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key);
    create table ai_calls(id uuid primary key);
    create table external_agent_runs(id uuid primary key, user_id uuid, ai_call_id uuid, status text, harness text, metadata jsonb, slack_progress jsonb, slack_progress_revision bigint not null default 0);`);
  await db.exec(await migration());
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
  await db.query(
    "insert into external_agent_runs(id,user_id,ai_call_id,status,harness,metadata) values($1,$2,$3,'streaming','mogplex',$4)",
    [
      run,
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
});
async function submit(changes: Record<string, unknown> = {}) {
  const args = {
    run,
    owner,
    call,
    team: "T1",
    channel: "D1",
    thread: "1.2",
    sender: "U1",
    event: "Ev1",
    message: "1.3",
    body: "Keep the desktop header unchanged.",
    attachments: null,
    ...changes,
  };
  const { rows } = await db.query<{
    result: { id: string; status: string } | null;
  }>(
    "select submit_slack_run_guidance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) as result",
    Object.values(args)
  );
  return rows[0].result;
}

it("accepts exact-thread owner guidance once across webhook retries", async () => {
  const first = await submit();
  expect(first?.status).toBe("received");
  expect(await submit()).toEqual(first);
  expect(
    (await db.query("select body,status from slack_run_guidance")).rows
  ).toEqual([
    { body: "Keep the desktop header unchanged.", status: "received" },
  ]);
});

it("round-trips the production store through real SQL including JSON attachments and UUID arrays", async () => {
  const thread = {
    userId: owner,
    teamId: "T1",
    channelId: "D1",
    threadTs: "1.2",
    slackUserId: "U1",
  };
  const targets = await findSlackGuidanceRuns(thread, client);
  expect(targets.map((row) => row.id)).toEqual([run]);
  expect(
    await findSlackGuidanceRuns({ ...thread, userId: other }, client)
  ).toEqual([]);
  const accepted = await submitSlackRunGuidance(
    {
      ...thread,
      runId: run,
      aiCallId: call,
      eventId: "Ev-api",
      messageTs: "1.4",
      body: "Use this screenshot.",
      attachments: {
        teamId: "T1",
        files: [
          {
            id: "F1",
            mimetype: "image/png",
            urlPrivateDownload:
              "https://files.slack.com/files-pri/T1-F1/image.png",
          },
        ],
      },
    },
    client
  );
  expect(accepted?.status).toBe("received");
  expect(
    await deliverRunGuidance(
      {
        runId: run,
        userId: owner,
        aiCallId: call,
        ids: [accepted!.id],
        step: 3,
      },
      client
    )
  ).toBe(1);
  const receipts = await loadRunGuidance(
    { id: run, user_id: owner, ai_call_id: call },
    client
  );
  expect(receipts[0]).toMatchObject({
    status: "delivered",
    body: "Use this screenshot.",
    delivered_step: 3,
    attachments: { teamId: "T1" },
  });
});

it("rejects mismatched owners, segments, Slack actors and threads", async () => {
  for (const changes of [
    { owner: other },
    { call: other },
    { team: "T2" },
    { channel: "D2" },
    { thread: "2.3" },
    { sender: "U2" },
  ])
    expect(await submit(changes)).toBeNull();
  expect(
    (await db.query("select count(*)::int as count from slack_run_guidance"))
      .rows
  ).toEqual([{ count: 0 }]);
});

it("pins a retried guidance event to its original run after completion", async () => {
  await submit();
  await db.query("update external_agent_runs set status='failed'");
  const thread = {
    userId: owner,
    teamId: "T1",
    channelId: "D1",
    threadTs: "1.2",
    slackUserId: "U1",
    eventId: "Ev1",
  };
  expect(
    (await findSlackGuidanceRuns(thread, client)).map((row) => row.id)
  ).toEqual([run]);
  expect(
    await findSlackGuidanceRuns({ ...thread, eventId: "Ev-new" }, client)
  ).toEqual([]);
  for (const changes of [
    { userId: other },
    { teamId: "T2" },
    { channelId: "D2" },
    { threadTs: "9.9" },
    { slackUserId: "U2" },
  ]) {
    expect(
      await findSlackGuidanceRuns({ ...thread, ...changes }, client)
    ).toEqual([]);
  }
});

it("does not advertise delivery until a model step actually received the guidance", async () => {
  const accepted = await submit();
  const mark = (actor: string, segment: string) =>
    db.query(
      "select deliver_slack_run_guidance($1,$2,$3,$4::uuid[],$5) as count",
      [run, actor, segment, [accepted!.id], 4]
    );
  await mark(other, call);
  await mark(owner, other);
  expect(
    (await db.query("select status from slack_run_guidance")).rows
  ).toEqual([{ status: "received" }]);
  await mark(owner, call);
  expect(
    (await db.query("select status,delivered_step from slack_run_guidance"))
      .rows
  ).toEqual([{ status: "delivered", delivered_step: 4 }]);
});

it.each(["success", "failed", "cancelled", "awaiting_input"])(
  "settles undelivered guidance honestly when the run becomes %s",
  async (status) => {
    const accepted = await submit();
    await db.query("update external_agent_runs set status=$1", [status]);
    await db.query("select deliver_slack_run_guidance($1,$2,$3,$4::uuid[],2)", [
      run,
      owner,
      call,
      [accepted!.id],
    ]);
    expect(
      (await db.query("select status from slack_run_guidance")).rows
    ).toEqual([{ status: "not_applied" }]);
    expect((await submit({ event: "Ev2" }))?.status).toBe("not_applied");
  }
);

it("retains delivered guidance and settles unconsumed guidance on segment replacement", async () => {
  const accepted = await submit();
  await db.query("select deliver_slack_run_guidance($1,$2,$3,$4::uuid[],1)", [
    run,
    owner,
    call,
    [accepted!.id],
  ]);
  await submit({ event: "Ev2", message: "1.4" });
  await db.query("update external_agent_runs set slack_progress='{}'::jsonb");
  await db.query("update external_agent_runs set ai_call_id=$1", [other]);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from slack_run_guidance order by created_at,id"
      )
    ).rows
      .map((row) => row.status)
      .sort()
  ).toEqual(["delivered", "not_applied"]);
  expect(
    (await db.query("select slack_progress from external_agent_runs")).rows
  ).toEqual([{ slack_progress: null }]);
  expect(
    await loadRunGuidance(
      { id: run, user_id: owner, ai_call_id: other },
      client
    )
  ).toEqual([]);
  expect(
    await loadRunGuidance(
      { id: run, user_id: owner, ai_call_id: other },
      client,
      true
    )
  ).toHaveLength(2);
});

it("keeps both migration variants idempotent and denies client reads and RPC execution", async () => {
  for (const backend of ["supabase", "neon"])
    await db.exec(await migration(backend));
  expect(
    (
      await db.query(
        "select relrowsecurity from pg_class where relname='slack_run_guidance'"
      )
    ).rows
  ).toEqual([{ relrowsecurity: true }]);
  expect(
    (
      await db.query(
        "select has_table_privilege('authenticated','slack_run_guidance','select') as allowed"
      )
    ).rows
  ).toEqual([{ allowed: false }]);
  expect(
    (
      await db.query(
        "select has_function_privilege('authenticated','submit_slack_run_guidance(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)','execute') as allowed"
      )
    ).rows
  ).toEqual([{ allowed: false }]);
});

it("settles receipts when an existing authorized client updates its run without granting it inbox access", async () => {
  await submit();
  await db.exec("grant select, update on external_agent_runs to authenticated");
  try {
    await db.exec("set role authenticated");
    await db.query(
      "update external_agent_runs set status='cancelled' where id=$1 and user_id=$2",
      [run, owner]
    );
  } finally {
    await db.exec("reset role");
  }
  expect(
    (await db.query("select status from slack_run_guidance")).rows
  ).toEqual([{ status: "not_applied" }]);
  expect(
    (
      await db.query(
        "select has_table_privilege('authenticated','slack_run_guidance','select') as allowed"
      )
    ).rows
  ).toEqual([{ allowed: false }]);
});
