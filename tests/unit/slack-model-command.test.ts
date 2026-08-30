import assert from "node:assert/strict";
import test from "node:test";
import type { SlackInstallationRow } from "../../lib/slack/installations";
import type { SlackModelCommandPayload } from "../../lib/slack/model-command";

const installation: SlackInstallationRow = {
  id: "installation-1",
  team_id: "T1",
  team_name: "Workspace",
  installed_by_user_id: "owner-1",
  bot_user_id: "UBOT",
  vault_bot_token_id: "vault-1",
  scopes: ["chat:write"],
  authed_user_slack_id: "UOWNER",
  created_at: "2026-08-29T00:00:00Z",
  updated_at: "2026-08-29T00:00:00Z",
};

const payload: SlackModelCommandPayload = {
  command: "/mogplex",
  text: "model",
  teamId: "T1",
  channelId: "C1",
  slackUserId: "U1",
  responseUrl: "https://hooks.slack.test/response",
};

async function loadHandler() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/slack/model-command");
}

function explicitMapping() {
  return {
    id: "mapping-1",
    slack_installation_id: installation.id,
    slack_user_id: payload.slackUserId,
    mogplex_user_id: "user-1",
    slack_email: "user@example.com",
    matched_at: "2026-08-29T00:00:00Z",
    link_status: "explicit" as const,
    linked_at: "2026-08-29T00:00:00Z",
    linked_by_user_id: "user-1",
    created_at: "2026-08-29T00:00:00Z",
  };
}

test("lists the current channel-user preference and usable models", async () => {
  const { createSlackModelCommandHandler } = await loadHandler();
  const responses: Array<Record<string, unknown>> = [];
  const handler = createSlackModelCommandHandler({
    getInstallation: async () => installation,
    getUserMapping: async () => explicitMapping(),
    listUsableModels: async () => ["openai/gpt-5.4", "anthropic/claude-4"],
    resolveDefaultModel: async () => "openai/gpt-5.4",
    getPreference: async () => ({ model_id: "anthropic/claude-4" }) as never,
    postResponse: async (_url, body) => {
      responses.push(body);
    },
  });
  await handler(payload);
  assert.match(String(responses[0]?.text), /anthropic\/claude-4/);
  assert.match(String(responses[0]?.text), /selected for you in this channel/);
  assert.match(String(responses[0]?.text), /openai\/gpt-5\.4/);
  const blocks = responses[0]?.blocks as Array<{
    type?: string;
    elements?: Array<{
      type?: string;
      action_id?: string;
      options?: Array<{ value?: string }>;
      initial_option?: { value?: string };
    }>;
  }>;
  const picker = blocks
    .flatMap((block) => block.elements ?? [])
    .find((element) => element.type === "static_select");
  assert.equal(picker?.action_id, "mogplex_select_model");
  assert.deepEqual(
    picker?.options?.map((option) => option.value),
    ["openai/gpt-5.4", "anthropic/claude-4"]
  );
  assert.equal(picker?.initial_option?.value, "anthropic/claude-4");
});

test("opens the model picker when /mogplex has no arguments", async () => {
  const { createSlackModelCommandHandler } = await loadHandler();
  const responses: Array<Record<string, unknown>> = [];
  const handler = createSlackModelCommandHandler({
    getInstallation: async () => installation,
    getUserMapping: async () => explicitMapping(),
    listUsableModels: async () => ["openai/gpt-5.4"],
    resolveDefaultModel: async () => "openai/gpt-5.4",
    getPreference: async () => null,
    postResponse: async (_url, body) => {
      responses.push(body);
    },
  });

  await handler({ ...payload, text: "" });

  assert.match(String(responses[0]?.text), /Current model: openai\/gpt-5\.4/);
  assert.doesNotMatch(String(responses[0]?.text), /^Usage:/);
  assert.ok(Array.isArray(responses[0]?.blocks));
});

test("shows the effective fallback when a saved preference is unavailable", async () => {
  const { createSlackModelCommandHandler } = await loadHandler();
  const responses: Array<Record<string, unknown>> = [];
  const handler = createSlackModelCommandHandler({
    getInstallation: async () => installation,
    getUserMapping: async () => explicitMapping(),
    listUsableModels: async () => ["openai/gpt-5.4"],
    resolveDefaultModel: async () => "openai/gpt-5.4",
    getPreference: async () => ({ model_id: "anthropic/claude-4" }) as never,
    postResponse: async (_url, body) => {
      responses.push(body);
    },
  });
  await handler(payload);
  assert.match(
    String(responses[0]?.text),
    /Current model: openai\/gpt-5\.4 \(default; saved selection anthropic\/claude-4 is unavailable\)/
  );
  assert.doesNotMatch(
    String(responses[0]?.text),
    /anthropic\/claude-4 \(selected for you in this channel\)/
  );
});

test("validates and saves a model for the invoking user and channel", async () => {
  const { createSlackModelCommandHandler } = await loadHandler();
  let saved: Record<string, unknown> | null = null;
  const responses: Array<Record<string, unknown>> = [];
  const handler = createSlackModelCommandHandler({
    getInstallation: async () => installation,
    getUserMapping: async () => explicitMapping(),
    listUsableModels: async () => ["openai/gpt-5.4"],
    resolveDefaultModel: async () => "openai/gpt-5.4",
    getPreference: async () => null,
    savePreference: async (input) => {
      saved = input;
      return { model_id: input.modelId } as never;
    },
    postResponse: async (_url, body) => {
      responses.push(body);
    },
  });
  await handler({ ...payload, text: "model gpt-5.4" });
  assert.deepEqual(saved, {
    installationId: "installation-1",
    channelId: "C1",
    slackUserId: "U1",
    modelId: "openai/gpt-5.4",
  });
  assert.match(String(responses[0]?.text), /next eligible/i);
});

test("returns actionable ephemeral errors without saving", async () => {
  const { createSlackModelCommandHandler } = await loadHandler();
  let saveCount = 0;
  const responses: Array<Record<string, unknown>> = [];
  const handler = createSlackModelCommandHandler({
    getInstallation: async () => installation,
    getUserMapping: async () => explicitMapping(),
    listUsableModels: async () => ["openai/gpt-5.4"],
    resolveDefaultModel: async () => "openai/gpt-5.4",
    getPreference: async () => null,
    savePreference: async () => {
      saveCount += 1;
      return {} as never;
    },
    postResponse: async (_url, body) => {
      responses.push(body);
    },
  });
  await handler({ ...payload, text: "model unavailable" });
  assert.equal(saveCount, 0);
  assert.match(String(responses[0]?.text), /unknown model/i);
  assert.match(String(responses[0]?.text), /list models/i);
});

test("rejects a Slack identity that is not explicitly linked", async () => {
  const { createSlackModelCommandHandler } = await loadHandler();
  const responses: Array<Record<string, unknown>> = [];
  const handler = createSlackModelCommandHandler({
    getInstallation: async () => installation,
    getUserMapping: async () => null,
    postResponse: async (_url, body) => {
      responses.push(body);
    },
  });
  await handler(payload);
  assert.match(String(responses[0]?.text), /link your Slack identity/i);
});
