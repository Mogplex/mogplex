import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { streamText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { createPostgrestShim } from "../../lib/db/postgrest-shim";
import {
  createSlackWebhookPostHandler,
  buildSlackEventTaskPayload,
} from "../../app/api/webhooks/slack/route";
import { runSlackEventTask } from "../../trigger/slack-event";
import { resolveKnownSlackAttribution } from "../../trigger/slack-event-lib/attribution";
import {
  findSlackGuidanceRuns,
  submitSlackRunGuidance,
  loadRunGuidance,
  deliverRunGuidance,
} from "../../lib/slack/run-guidance-store";
import { createRunGuidanceSession } from "../../lib/slack/run-guidance-session";
import { deliverSlackRunUpdate } from "../../lib/slack/run-delivery";
import { stripSlackRunControlsForTerminalRun } from "../../lib/slack/run-controls-notify";
import { emptyRunResultEvidence } from "../../lib/slack/run-result-evidence";
import { buildRunRow } from "../unit/helpers/mogplex-api-runs-fixtures";
import type { UpdateSlackMessageInput } from "../../lib/slack/client";
import type { SlackInstallationRow } from "../../lib/slack/installations";

// Service E2E: actual signed HTTP webhook, event routing, Postgres inbox,
// SDK step boundaries and Slack message writer. Only provider/queue transports
// and pre-existing account/installation records are fixtures. Native Slack
// rendering is separately verified in a real workspace, not imitated in HTML.
test("a Slack thread reply reaches the next agent step once and survives terminal delivery", async ({
  request,
}) => {
  const owner = "00000000-0000-4000-8000-000000000001";
  const runId = "00000000-0000-4000-8000-000000000002";
  const callId = "00000000-0000-4000-8000-000000000003";
  const run = buildRunRow({
    id: runId,
    user_id: owner,
    ai_call_id: callId,
    harness: "mogplex",
    status: "streaming",
    prompt: "Fix the mobile controls",
    metadata: {
      slack_guidance_enabled: true,
      slack_user_id: "U1",
      slack_thread_ts: "1.2",
      slackRunControls: { teamId: "T1", channelId: "D1", messageTs: "1.2" },
    },
  });
  const db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key); create table ai_calls(id uuid primary key);
    create table external_agent_runs(id uuid primary key, user_id uuid, ai_call_id uuid, status text, harness text, metadata jsonb, slack_progress jsonb, slack_progress_revision bigint not null default 0);`);
  await db.exec(
    await readFile(
      join(
        process.cwd(),
        "supabase/migrations/20260905124500_slack_run_guidance.sql"
      ),
      "utf8"
    )
  );
  await db.query("insert into profiles values($1)", [owner]);
  await db.query("insert into ai_calls values($1)", [callId]);
  await db.query(
    "insert into external_agent_runs(id,user_id,ai_call_id,status,harness,metadata) values($1,$2,$3,'streaming','mogplex',$4)",
    [runId, owner, callId, JSON.stringify(run.metadata)]
  );
  const client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  }) as unknown as SupabaseClient;
  const messages: UpdateSlackMessageInput[] = [];
  const acknowledgements: string[] = [];
  let unexpectedAgentStarts = 0;
  const updates: Array<{ runId: string; userId: string }> = [];
  const installation: SlackInstallationRow = {
    id: "installation-1",
    team_id: "T1",
    team_name: "Fixture",
    installed_by_user_id: owner,
    bot_user_id: "UBOT",
    vault_bot_token_id: "fixture",
    scopes: ["chat:write"],
    authed_user_slack_id: "U1",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  const secret = crypto.randomBytes(32).toString("hex");
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => secret,
    dispatch: async (event) => {
      if (event.kind !== "event") throw new Error("Expected a Slack event");
      const payload = buildSlackEventTaskPayload(event.body);
      if (!payload) throw new Error("Missing webhook identity");
      await runSlackEventTask(payload, {
        getInstallation: async (teamId) =>
          teamId === installation.team_id ? installation : null,
        getBotToken: async () => "fixture-token",
        resolveSlackAttribution: async (installed, slackUserId) =>
          resolveKnownSlackAttribution({
            installation: installed,
            slackUserId,
            existing: null,
          }) ?? { mode: "unmapped", mogplexUserId: null, slackEmail: null },
        findGuidanceRuns: (input) => findSlackGuidanceRuns(input, client),
        submitGuidance: (input) => submitSlackRunGuidance(input, client),
        queueRunDelivery: async (input) => {
          updates.push(input);
        },
        postMessage: async (_token, input) => {
          acknowledgements.push(input.text);
          return { channel: "D1", ts: "1.4" };
        },
        startRepoAgentRun: async () => {
          unexpectedAgentStarts++;
          throw new Error("A guidance reply must not launch a run");
        },
        runAgent: async () => {
          unexpectedAgentStarts++;
          throw new Error("A guidance reply must not launch a chat agent");
        },
      });
    },
  });
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const result = await handler(
        new Request("http://localhost/api/webhooks/slack", {
          method: "POST",
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString(),
        })
      );
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(await result.text());
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  const endpoint = `http://127.0.0.1:${address.port}/api/webhooks/slack`;
  const raw = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event_id: "Ev-guide",
    event: {
      type: "message",
      channel_type: "im",
      channel: "D1",
      user: "U1",
      ts: "1.3",
      thread_ts: "1.2",
      text: "Keep the desktop header unchanged.",
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature":
      "v0=" +
      crypto
        .createHmac("sha256", secret)
        .update(`v0:${timestamp}:${raw}`)
        .digest("hex"),
  };
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  try {
    expect(
      (
        await request.post(endpoint, {
          data: raw,
          headers: { ...headers, "x-slack-signature": "v0=invalid" },
        })
      ).status()
    ).toBe(401);
    expect(await loadRunGuidance(run, client)).toEqual([]);
    const session = createRunGuidanceSession(run, {
      load: (row) => loadRunGuidance(row, client),
      deliver: (input) => deliverRunGuidance(input, client),
      queue: async (input) => {
        updates.push(input);
      },
    });
    let step = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(sink) {
            if (step++ === 0)
              sink.enqueue({
                type: "tool-call",
                toolCallId: "command-1",
                toolName: "inspect",
                input: "{}",
              });
            else {
              sink.enqueue({ type: "text-start", id: "result" });
              sink.enqueue({
                type: "text-delta",
                id: "result",
                delta: "Desktop controls preserved.",
              });
              sink.enqueue({ type: "text-end", id: "result" });
            }
            sink.enqueue({
              type: "finish",
              finishReason: {
                unified: step === 1 ? "tool-calls" : "stop",
                raw: "stop",
              },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            sink.close();
          },
        }),
      }),
    });
    const result = streamText({
      model,
      prompt: run.prompt,
      stopWhen: stepCountIs(3),
      prepareStep: async ({ messages, stepNumber }) => ({
        messages: await session.prepare(messages, stepNumber),
      }),
      onStepFinish: () => session.stepFinished(),
      tools: {
        inspect: tool({
          inputSchema: z.object({}),
          execute: async () => {
            expect(
              (await request.post(endpoint, { data: raw, headers })).status()
            ).toBe(200);
            expect((await loadRunGuidance(run, client))[0].status).toBe(
              "received"
            );
            return "Inspected the header";
          },
        }),
      },
    });
    await result.consumeStream();
    expect(await result.text).toBe("Desktop controls preserved.");
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain(
      "Keep the desktop header unchanged."
    );
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(
      "Keep the desktop header unchanged."
    );
    expect((await loadRunGuidance(run, client))[0]).toMatchObject({
      status: "delivered",
      delivered_step: 1,
    });
    await db.query(
      "update external_agent_runs set status='success' where id=$1",
      [runId]
    );
    const finished = { ...run, status: "success" as const };
    await deliverSlackRunUpdate(
      { runId, userId: owner },
      {
        loadRun: async () => finished,
        sendTerminal: (row, status) =>
          stripSlackRunControlsForTerminalRun(row, status, {
            getSlackBotToken: async () => "fixture-token",
            updateSlackMessage: async (_token, message) => {
              messages.push(message);
            },
            loadRunOutput: async () => result.text,
            loadGuidance: async () => loadRunGuidance(run, client),
            loadEvidence: async () => emptyRunResultEvidence(),
          }),
        markDelivered: async () => {},
      }
    );
    expect(messages[0].text).toContain("Supplied to agent step 2");
    expect(JSON.stringify(messages[0].blocks)).not.toContain(
      "mogplex-cancel-run"
    );
    expect(
      (await request.post(endpoint, { data: raw, headers })).status()
    ).toBe(200);
    expect(await loadRunGuidance(run, client)).toHaveLength(1);
    expect(acknowledgements.at(-1)).toContain("already supplied");
    expect(updates).toHaveLength(3);
    expect(unexpectedAgentStarts).toBe(0);
  } finally {
    if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await db.close();
  }
});
