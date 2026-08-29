import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SlackInstallationRow } from "./installations";
import type { SlackModelCommandPayload } from "./model-command";

let createSlackModelCommandHandler: typeof import("./model-command").createSlackModelCommandHandler;

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

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ createSlackModelCommandHandler } = await import("./model-command"));
});

describe("Slack model command", () => {
  it("shows the usable fallback when a saved selection is unavailable", async () => {
    const postResponse = vi.fn(async () => undefined);
    const handler = createSlackModelCommandHandler({
      getInstallation: async () => installation,
      getUserMapping: async () => explicitMapping(),
      listUsableModels: async () => ["openai/gpt-5.4"],
      resolveDefaultModel: async () => "openai/gpt-5.4",
      getPreference: async () => ({ model_id: "anthropic/claude-4" }) as never,
      postResponse,
    });

    await handler(payload);

    expect(postResponse).toHaveBeenCalledWith(
      payload.responseUrl,
      expect.objectContaining({
        text: expect.stringContaining(
          "Current model: openai/gpt-5.4 (default; saved selection anthropic/claude-4 is unavailable)"
        ),
      })
    );
  });

  it("validates and saves a model for the invoking user and channel", async () => {
    const savePreference = vi.fn(async () => ({}) as never);
    const postResponse = vi.fn(async () => undefined);
    const handler = createSlackModelCommandHandler({
      getInstallation: async () => installation,
      getUserMapping: async () => explicitMapping(),
      listUsableModels: async () => ["openai/gpt-5.4"],
      resolveDefaultModel: async () => "openai/gpt-5.4",
      getPreference: async () => null,
      savePreference,
      postResponse,
    });

    await handler({ ...payload, text: "model gpt-5.4" });

    expect(savePreference).toHaveBeenCalledWith({
      installationId: installation.id,
      channelId: payload.channelId,
      slackUserId: payload.slackUserId,
      modelId: "openai/gpt-5.4",
    });
    expect(postResponse).toHaveBeenCalledWith(
      payload.responseUrl,
      expect.objectContaining({ text: expect.stringMatching(/next eligible/i) })
    );
  });

  it("returns an ephemeral error for an unlinked Slack identity", async () => {
    const postResponse = vi.fn(async () => undefined);
    const handler = createSlackModelCommandHandler({
      getInstallation: async () => installation,
      getUserMapping: async () => null,
      postResponse,
    });

    await handler(payload);

    expect(postResponse).toHaveBeenCalledWith(
      payload.responseUrl,
      expect.objectContaining({
        response_type: "ephemeral",
        text: expect.stringMatching(/link your Slack identity/i),
      })
    );
  });
});
