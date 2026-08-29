import { describe, expect, it, vi } from "vitest";
import {
  getSlackModelPreference,
  upsertSlackModelPreference,
} from "./model-preferences";

function createClient(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    upsert: vi.fn(),
    single: vi.fn(async () => result),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.upsert.mockReturnValue(builder);
  return { client: { from: vi.fn(() => builder) }, builder };
}

describe("Slack model preferences", () => {
  it("loads a preference in installation, channel, and user scope", async () => {
    const row = { id: "preference-1", model_id: "openai/gpt-5.4" };
    const { client, builder } = createClient({ data: row, error: null });

    await expect(
      getSlackModelPreference(
        {
          installationId: "installation-1",
          channelId: "channel-1",
          slackUserId: "slack-user-1",
        },
        client as never
      )
    ).resolves.toBe(row);
    expect(builder.eq.mock.calls).toEqual([
      ["slack_installation_id", "installation-1"],
      ["channel_id", "channel-1"],
      ["slack_user_id", "slack-user-1"],
    ]);
  });

  it("upserts the model in the same scope", async () => {
    const row = { id: "preference-1", model_id: "openai/gpt-5.4" };
    const { client, builder } = createClient({ data: row, error: null });

    await expect(
      upsertSlackModelPreference(
        {
          installationId: "installation-1",
          channelId: "channel-1",
          slackUserId: "slack-user-1",
          modelId: "openai/gpt-5.4",
        },
        client as never
      )
    ).resolves.toBe(row);
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        slack_installation_id: "installation-1",
        channel_id: "channel-1",
        slack_user_id: "slack-user-1",
        model_id: "openai/gpt-5.4",
      }),
      { onConflict: "slack_installation_id,channel_id,slack_user_id" }
    );
  });

  it("fails closed when persistence reports an error", async () => {
    const { client } = createClient({
      data: null,
      error: { message: "write failed" },
    });

    await expect(
      upsertSlackModelPreference(
        {
          installationId: "installation-1",
          channelId: "channel-1",
          slackUserId: "slack-user-1",
          modelId: "openai/gpt-5.4",
        },
        client as never
      )
    ).rejects.toThrow("Failed to save Slack model preference");
  });
});
