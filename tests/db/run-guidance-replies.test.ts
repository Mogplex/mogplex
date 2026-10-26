import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import {
  deliverRunGuidance,
  loadPendingGuidanceReplies,
  loadRunGuidance,
  markGuidanceReplyPosted,
  recordRunGuidanceReply,
  submitSlackRunGuidance,
} from "@/lib/slack/run-guidance-store";

const run = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const call = "00000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000004";
const migrations = [
  "20260905124500_slack_run_guidance.sql",
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

async function guidance(event: string, body: string) {
  const receipt = await submitSlackRunGuidance(
    {
      userId: owner,
      teamId: "T1",
      channelId: "D1",
      threadTs: "1.2",
      slackUserId: "U1",
      runId: run,
      aiCallId: call,
      eventId: event,
      messageTs: event,
      body,
      attachments: null,
    },
    client
  );
  return receipt!.id;
}
const reply = (ids: string[], text: string, userId = owner) =>
  recordRunGuidanceReply(
    { runId: run, userId, aiCallId: call, ids, text },
    client
  );
const owned = { id: run, user_id: owner };

it("hands the agent's answer to delivery once, in the thread the guidance came from", async () => {
  const id = await guidance("Ev1", "sitrep");
  expect(await reply([id], "Not delivered yet")).toBe(0);
  await deliverRunGuidance(
    { runId: run, userId: owner, aiCallId: call, ids: [id], step: 2 },
    client
  );
  expect(await reply([id], "SITREP: PR #194 is open.", other)).toBe(0);
  expect(await reply([id], "SITREP: PR #194 is open.")).toBe(1);
  expect(await reply([id], "A later step must not overwrite it")).toBe(0);
  // A reconstructed worker reads this to know the answer is already recorded.
  expect(
    (await loadRunGuidance({ ...owned, ai_call_id: call }, client))[0]
      .reply_text
  ).toBe("SITREP: PR #194 is open.");
  expect(await loadPendingGuidanceReplies(owned, client)).toEqual([
    {
      id,
      channel_id: "D1",
      thread_ts: "1.2",
      reply_text: "SITREP: PR #194 is open.",
    },
  ]);
  expect(
    await loadPendingGuidanceReplies({ id: run, user_id: other }, client)
  ).toEqual([]);
  await markGuidanceReplyPosted(
    { id, userId: owner, messageTs: "1.9" },
    client
  );
  await markGuidanceReplyPosted(
    { id, userId: owner, messageTs: "2.0" },
    client
  );
  expect(await loadPendingGuidanceReplies(owned, client)).toEqual([]);
  expect(
    (await db.query("select reply_posted_ts from slack_run_guidance")).rows
  ).toEqual([{ reply_posted_ts: "1.9" }]);
});

it("adds the reply columns idempotently without changing existing receipts", async () => {
  const id = await guidance("Ev2", "keep desktop");
  for (const name of migrations.slice(1))
    await db.exec(await readMigration(name));
  expect(
    (
      await db.query(
        "select id,status,reply_text,reply_posted_ts from slack_run_guidance"
      )
    ).rows
  ).toEqual([
    { id, status: "received", reply_text: null, reply_posted_ts: null },
  ]);
});
