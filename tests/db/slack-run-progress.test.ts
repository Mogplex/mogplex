import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  publishRunProgress,
  readRunProgressSnapshot,
  markRunProgressDelivered,
} from "@/lib/slack/run-progress-store";
import {
  createRunProgressState,
  applyRunProgress,
} from "@/lib/slack/run-progress-state";
import { buildRunRow } from "../unit/helpers/mogplex-api-runs-fixtures";

const runId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const aiCallId = "00000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000004";
let pg: PGlite;
let client: SupabaseClient;
const migration = (backend = "supabase") =>
  readFile(
    new URL(
      `../../${backend}/migrations/20260905123000_slack_run_progress.sql`,
      import.meta.url
    ),
    "utf8"
  );

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table external_agent_runs(id uuid primary key, user_id uuid not null, ai_call_id uuid not null, status text not null);
  `);
  await pg.exec(await migration());
  const queryable: Queryable = {
    query: async (sql, values) => {
      const result = await pg.query(sql, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
  client = createPostgrestShim(queryable) as unknown as SupabaseClient;
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.exec("truncate external_agent_runs");
  await pg.query(
    "insert into external_agent_runs(id,user_id,ai_call_id,status) values($1,$2,$3,'streaming')",
    [runId, userId, aiCallId]
  );
});

it("persists the actual progress snapshot through the PostgREST JSONB boundary", async () => {
  const state = createRunProgressState(1000);
  applyRunProgress(
    state,
    {
      kind: "tool_started",
      toolName: "bash",
      toolCallId: "call-a",
      input: { command: "pnpm test" },
    },
    2000
  );
  expect(
    await publishRunProgress({ runId, userId, aiCallId, state }, client)
  ).toBe(1);
  applyRunProgress(
    state,
    {
      kind: "tool_finished",
      toolName: "bash",
      toolCallId: "call-a",
      state: "success",
      output: { exitCode: 1 },
    },
    3000
  );
  expect(
    await publishRunProgress({ runId, userId, aiCallId, state }, client)
  ).toBe(2);
  const { rows } = await pg.query<{ slack_progress: unknown }>(
    "select slack_progress from external_agent_runs"
  );
  expect(
    readRunProgressSnapshot(rows[0].slack_progress)?.tasks.get("call-a")
  ).toMatchObject({
    title: "Running tests",
    status: "error",
    result: "Command exited with code 1",
  });
});

it.each(["success", "failed", "cancelled", "awaiting_input"])(
  "late progress cannot revive or overwrite %s",
  async (status) => {
    await pg.query("update external_agent_runs set status=$1", [status]);
    expect(
      await publishRunProgress(
        { runId, userId, aiCallId, state: createRunProgressState(1000) },
        client
      )
    ).toBeNull();
    expect(
      (await pg.query("select status,slack_progress from external_agent_runs"))
        .rows
    ).toEqual([{ status, slack_progress: null }]);
  }
);

it("rejects another owner, another run and a superseded segment", async () => {
  for (const input of [
    { runId: other, userId, aiCallId },
    { runId, userId: other, aiCallId },
    { runId, userId, aiCallId: other },
  ])
    expect(
      await publishRunProgress(
        { ...input, state: createRunProgressState(1000) },
        client
      )
    ).toBeNull();
  expect(
    (await pg.query("select slack_progress_revision from external_agent_runs"))
      .rows
  ).toEqual([{ slack_progress_revision: 0 }]);
});

it("records delivery only for the same owner, segment and lifecycle state", async () => {
  const row = buildRunRow({
    id: runId,
    user_id: userId,
    ai_call_id: aiCallId,
    status: "streaming",
  });
  for (const changed of [
    { user_id: other },
    { ai_call_id: other },
    { id: other },
    { status: "pending" as const },
  ]) {
    await markRunProgressDelivered({ ...row, ...changed }, "stale-key", client);
    expect(
      (
        await pg.query(
          "select slack_progress_delivered_key from external_agent_runs"
        )
      ).rows
    ).toEqual([{ slack_progress_delivered_key: null }]);
  }
  await markRunProgressDelivered(row, "current-key", client);
  expect(
    (
      await pg.query(
        "select slack_progress_delivered_key, slack_progress_delivered_at is not null as dated from external_agent_runs"
      )
    ).rows
  ).toEqual([{ slack_progress_delivered_key: "current-key", dated: true }]);
  await pg.query("update external_agent_runs set status='cancelled'");
  await markRunProgressDelivered(row, "late-key", client);
  expect(
    (
      await pg.query(
        "select slack_progress_delivered_key from external_agent_runs"
      )
    ).rows
  ).toEqual([{ slack_progress_delivered_key: "current-key" }]);
});

it("does not persist incomplete prose or raw shell input", async () => {
  const state = createRunProgressState(1000);
  applyRunProgress(
    state,
    { kind: "assistant_text", text: "unfinished private string" },
    2000
  );
  applyRunProgress(
    state,
    {
      kind: "tool_started",
      toolName: "bash",
      input: { command: "curl -H secret" },
    },
    3000
  );
  applyRunProgress(
    state,
    { kind: "assistant_text", text: "unpublished fragment" },
    4000
  );
  await publishRunProgress({ runId, userId, aiCallId, state }, client);
  const result = JSON.stringify(
    (await pg.query("select slack_progress from external_agent_runs")).rows
  );
  expect(result).not.toContain("unpublished fragment");
  expect(result).not.toContain("curl -H secret");
});

it("restricts the service RPC and keeps migrations additive/idempotent on both backends", async () => {
  for (const backend of ["supabase", "neon"]) {
    await pg.exec(await migration(backend));
    await pg.exec(await migration(backend));
  }
  const { rows } = await pg.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated','public.publish_slack_run_progress(uuid,uuid,uuid,jsonb)','execute') as allowed"
  );
  expect(rows[0].allowed).toBe(false);
  expect(
    (
      await pg.query<{ allowed: boolean }>(
        "select has_function_privilege('service_role','public.publish_slack_run_progress(uuid,uuid,uuid,jsonb)','execute') as allowed"
      )
    ).rows[0].allowed
  ).toBe(true);
  await expect(
    pg.query("select publish_slack_run_progress($1,$2,$3,'[]'::jsonb)", [
      runId,
      userId,
      aiCallId,
    ])
  ).rejects.toThrow("Progress must be an object");
});
