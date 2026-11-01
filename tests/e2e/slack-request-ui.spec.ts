import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import {
  createSlackWebhookPostHandler,
  buildSlackEventTaskPayload,
} from "../../app/api/webhooks/slack/route";
import { runSlackEventTask } from "../../trigger/slack-event";
import { createPostgrestShim } from "../../lib/db/postgrest-shim";
import { requestSlackConnectionRecovery } from "../../lib/slack/connection-recovery/request";
import {
  saveConnectionRecoveryRequest,
  loadConnectionRecoveryRequest,
  cancelConnectionRecoveryRequest,
} from "../../lib/slack/connection-recovery/store";
import { handleConnectionRecoveryAction } from "../../lib/slack/connection-recovery/interactions";
import { installation } from "../../lib/slack/connection-recovery/test-fixtures";
import { CONNECTION_CANCEL_ACTION } from "../../lib/slack/connection-recovery/presentation";
import type { SlackBlockActionsPayload } from "../../lib/slack/interactivity";
import type {
  PostSlackMessageInput,
  UpdateSlackMessageInput,
} from "../../lib/slack/client";
import type { supabaseAdmin } from "../../lib/supabase/admin";

// Service E2E: signed HTTP events, actual conversational routing, tool execution,
// real Postgres request storage and Slack message payloads. Slack's native
// renderer and the hosted queue remain provider boundaries.
test("a reply stays below one compact connection card, and Cancel dismisses the pending request", async ({
  request,
}) => {
  const db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create table profiles(id uuid primary key); create table slack_installations(id uuid primary key); create table teams(id uuid primary key); create table repos(id uuid primary key);"
  );
  await db.exec(
    await readFile(
      "neon/migrations/20261010193000_slack_connection_requests.sql",
      "utf8"
    )
  );
  await db.exec(
    await readFile(
      "neon/migrations/20261101190000_slack_connection_request_cancellation.sql",
      "utf8"
    )
  );
  await db.query("insert into profiles values($1)", [
    installation.installed_by_user_id,
  ]);
  await db.query("insert into slack_installations values($1)", [
    installation.id,
  ]);
  const client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  }) as unknown as Pick<typeof supabaseAdmin, "from">;
  const posts: PostSlackMessageInput[] = [];
  const edits: UpdateSlackMessageInput[] = [];
  const work: Promise<void>[] = [];
  const secret = crypto.randomBytes(32).toString("hex");
  let now = 1000;
  let requestId = "";
  const postMessage = async (_token: string, input: PostSlackMessageInput) => {
    posts.push(input);
    return { channel: input.channel, ts: `${posts.length}.1` };
  };
  const updateMessage = async (
    _token: string,
    input: UpdateSlackMessageInput
  ) => {
    edits.push(input);
    return { channel: input.channel, ts: input.ts };
  };
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => secret,
    getNativeIngressEnv: () => ({}),
    scheduleAfterResponse: (callback) =>
      void work.push(Promise.resolve(callback())),
    dispatch: async (event) => {
      if (event.kind === "interactivity") {
        const result = await handleConnectionRecoveryAction(
          event.body as SlackBlockActionsPayload,
          {
            getInstallation: async () => installation,
            getUserMapping: async () => null,
            getBotToken: async () => "fixture-token",
            loadRequest: (id, user) =>
              loadConnectionRecoveryRequest(id, user, client),
            cancelRequest: (id, user) =>
              cancelConnectionRecoveryRequest(id, user, client),
            updateMessage,
          }
        );
        expect(result).toBe("cancelled");
        return;
      }
      if (event.kind !== "event") throw new Error("Unexpected event");
      const payload = buildSlackEventTaskPayload(event.body);
      if (!payload) throw new Error("Missing event identity");
      await runSlackEventTask(payload, {
        getInstallation: async () => installation,
        getBotToken: async () => "fixture-token",
        resolveSlackAttribution: async () => ({
          mode: "installer_fallback",
          mogplexUserId: installation.installed_by_user_id,
          slackEmail: null,
        }),
        getChannelLink: async () => null,
        loadBoundConversation: async () => null,
        loadOrCreateConversation: async () => ({
          id: "conversation",
          user_id: installation.installed_by_user_id,
          messages: [],
          model: null,
          title: null,
        }),
        persistConversation: async () => {},
        findGuidanceRuns: async () => [],
        loadThreadRunContext: async () => null,
        resolveRepoContext: async () => null,
        resolveModelPreference: async () => null,
        now: () => new Date((now += 2000)),
        postMessage,
        updateMessage,
        requestConnectionRecovery: (input) =>
          requestSlackConnectionRecovery(input, {
            canRecover: async () => true,
            saveRequest: (input) =>
              saveConnectionRecoveryRequest(input, client),
            describe: async () => ({
              name: undefined,
              icon: "github",
              restoreRepository: false,
            }),
            postMessage,
            appUrl: () => "https://mogplex.example",
          }),
        runAgent: async (input) => {
          for (let index = 0; index < 20; index++)
            await input.onProgress?.({
              type: "tool_started",
              toolCallId: `tool-${index}`,
              toolName: "github_list_repos",
            });
          const connect = input.additionalTools!.request_connection.execute!;
          for (const resumeText of [
            "List acme repositories",
            "List repositories in acme",
          ]) {
            const result = (await connect(
              { target: { provider: "github", access: "read" }, resumeText },
              { toolCallId: resumeText, messages: [], context: {} }
            )) as { requestId: string };
            requestId = result.requestId;
          }
          return {
            finalText: "Connect GitHub to list acme repositories.",
            finishReason: "stop",
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            stepCount: 2,
          };
        },
      });
    },
  });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const response = await handler(
      new Request("http://localhost/api/webhooks/slack", {
        method: "POST",
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks).toString(),
      })
    );
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const send = async (body: string, contentType: string) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return request.post(endpoint, {
      data: body,
      headers: {
        "content-type": contentType,
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
      },
    });
  };
  try {
    const event = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event_id: "Ev-ui",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        ts: "1.1",
        text: "List acme repositories",
      },
    });
    expect((await send(event, "application/json")).status()).toBe(200);
    await Promise.all(work);
    expect(posts).toHaveLength(3);
    expect(posts.at(-1)?.text).toBe(
      "Connect GitHub to list acme repositories."
    );
    expect(posts.at(-1)?.blocks).toEqual([
      { type: "markdown", text: "Connect GitHub to list acme repositories." },
    ]);
    expect(posts[1].blocks).toHaveLength(2);
    expect(JSON.stringify(posts[1].blocks)).toContain("Cancel request");
    expect(JSON.stringify(posts[1].blocks)).not.toContain("accessory");
    expect(
      edits.every((edit) => !JSON.stringify(edit).includes("task_update"))
    ).toBe(true);
    const action = {
      type: "block_actions",
      team: { id: "T1" },
      user: { id: "U1" },
      channel: { id: "D1" },
      message: { ts: "2.1" },
      actions: [{ action_id: CONNECTION_CANCEL_ACTION, value: requestId }],
    };
    expect(
      (
        await send(
          new URLSearchParams({ payload: JSON.stringify(action) }).toString(),
          "application/x-www-form-urlencoded"
        )
      ).status()
    ).toBe(200);
    await Promise.all(work);
    expect(
      (
        await loadConnectionRecoveryRequest(
          requestId,
          installation.installed_by_user_id,
          client
        )
      )?.cancelled_at
    ).toBeTruthy();
    expect(edits.at(-1)?.text).toContain("Connection request cancelled");
    expect(JSON.stringify(edits.at(-1)?.blocks)).not.toContain(
      "mogplex_connection_open"
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await db.close();
  }
});
