import { createHmac, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPostgrestShim } from "../../lib/db/postgrest-shim";
import { createSlackWebhookPostHandler } from "../../app/api/webhooks/slack/route";
import { createSlackModelCommandHandler } from "../../lib/slack/model-command";
import {
  getSlackModelPreference,
  upsertSlackModelPreference,
} from "../../lib/slack/model-preferences";
import { defaultStartRepoAgentRun } from "../../trigger/slack-event-lib/run-start";
import { startMogplexApiRun } from "../../lib/mogplex-api/runs";
import {
  buildRunRow,
  buildStartDeps,
} from "../unit/helpers/mogplex-api-runs-fixtures";
import { exercise } from "../support/native-run-fixture";

// Service E2E: signed Slack command -> persisted preference -> launch metadata
// -> native worker -> SDK invocation and observability. Account, queue and
// model transports are fixtures; no messages or billed work leave the test.
test("the model chosen in Slack is the model used by its repository run", async () => {
  const db = await PGlite.create();
  await db.exec(`create table slack_model_preferences(
    id uuid default gen_random_uuid(), slack_installation_id text,
    channel_id text, slack_user_id text, model_id text,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique(slack_installation_id,channel_id,slack_user_id));`);
  const client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  }) as unknown as SupabaseClient;
  const scope = {
    installationId: "installation-1",
    channelId: "D1",
    slackUserId: "U1",
  };
  const responses: string[] = [];
  const handleModel = createSlackModelCommandHandler({
    getInstallation: async () => ({
      id: scope.installationId,
      team_id: "T1",
      team_name: "Test",
      installed_by_user_id: "user-123",
      authed_user_slack_id: "U1",
      bot_user_id: "BOT",
      vault_bot_token_id: "fixture",
      scopes: [],
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    }),
    getUserMapping: async () => null,
    listUsableModels: async () => [
      "openai/gpt-6-astra",
      "meta/muse-spark-1.3-contributor",
    ],
    resolveDefaultModel: async () => "meta/muse-spark-1.3-contributor",
    getPreference: (input) => getSlackModelPreference(input, client),
    savePreference: (input) => upsertSlackModelPreference(input, client),
    postResponse: async (_url, response) => {
      responses.push(typeof response.text === "string" ? response.text : "");
    },
  });
  const secret = randomBytes(32).toString("hex");
  let delivered: Promise<void> | undefined;
  const handler = createSlackWebhookPostHandler({
    getSigningSecret: () => secret,
    scheduleAfterResponse: (work) => {
      delivered = Promise.resolve(work());
    },
    dispatch: async (event) => {
      if (event.kind !== "command") throw new Error("Expected model command");
      await handleModel(event.body);
    },
  });
  try {
    const body = new URLSearchParams({
      command: "/mogplex",
      text: "model openai/gpt-6-astra",
      team_id: "T1",
      channel_id: "D1",
      user_id: "U1",
      response_url: "https://hooks.slack.test/response",
    }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await handler(
      new Request("http://localhost/api/webhooks/slack", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
        },
      })
    );
    expect(response.status).toBe(200);
    await delivered;
    expect(responses.join(" ")).toContain("Model set to openai/gpt-6-astra");
    let stored = buildRunRow();
    await defaultStartRepoAgentRun(
      {
        mogplexUserId: "user-123",
        repoId: "repo-1",
        prompt: "Fix the mobile header",
        idempotencyKey: "slack:fixture",
        slackContext: {
          ...scope,
          teamId: "T1",
          mode: "repo_agent",
          slackEmail: null,
          attributionMode: "mapped_profile",
        },
      },
      (input) =>
        startMogplexApiRun({
          ...input,
          deps: buildStartDeps({
            insertRun: async (insert) => {
              stored = buildRunRow({
                harness: insert.normalized.harness,
                metadata: insert.metadata,
              });
              return stored;
            },
            markRunQueued: async () => stored,
          }),
        }),
      async () => "mogplex",
      async () => {},
      async () => null,
      (input) => getSlackModelPreference(input, client)
    );
    // Changing the channel afterward cannot rewrite an accepted run.
    await upsertSlackModelPreference(
      { ...scope, modelId: "meta/muse-spark-1.3-contributor" },
      client
    );
    const execution = await exercise("success", "Fixed.", stored.metadata);
    expect(execution.caught).toBeUndefined();
    expect(execution.invokedModel).toBe("openai/gpt-6-astra");
    expect(execution.call.model).toBe("openai/gpt-6-astra");
    expect(execution.call.status).toBe("success");
  } finally {
    await db.close();
  }
});
