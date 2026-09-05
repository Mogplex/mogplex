import { describe, expect, it, vi } from "vitest";
import {
  getSlackHarnessPreference,
  upsertSlackHarnessPreference,
} from "./harness-preferences";

const scope = { installationId: "I1", channelId: "C1", slackUserId: "U1" };
function database(data: unknown, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: async () => ({ data, error }),
    upsert: vi.fn(async () => ({ error })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return { builder, client: { from: vi.fn(() => builder) } };
}

describe("Slack harness persistence", () => {
  it("filters every read by installation, channel and Slack user", async () => {
    const { builder, client } = database({ harness: "codex" });
    expect(await getSlackHarnessPreference(scope, client as never)).toBe(
      "codex"
    );
    expect(client.from).toHaveBeenCalledWith("slack_harness_preferences");
    expect(builder.eq.mock.calls).toEqual([
      ["slack_installation_id", "I1"],
      ["channel_id", "C1"],
      ["slack_user_id", "U1"],
    ]);
  });
  it("returns no preference for a new scope", async () => {
    const { client } = database(null);
    expect(await getSlackHarnessPreference(scope, client as never)).toBeNull();
  });
  it("upserts only the same scope", async () => {
    const { builder, client } = database(null);
    await upsertSlackHarnessPreference(
      { ...scope, harness: "mogplex" },
      client as never
    );
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        slack_installation_id: "I1",
        channel_id: "C1",
        slack_user_id: "U1",
        harness: "mogplex",
      }),
      { onConflict: "slack_installation_id,channel_id,slack_user_id" }
    );
  });
  it("does not silently switch runner on database errors", async () => {
    const { client } = database(null, { message: "unavailable" });
    await expect(
      getSlackHarnessPreference(scope, client as never)
    ).rejects.toThrow("Failed to load");
    await expect(
      upsertSlackHarnessPreference(
        { ...scope, harness: "codex" },
        client as never
      )
    ).rejects.toThrow("Failed to save");
  });
  it("rejects corrupt saved values", async () => {
    const { client } = database({ harness: "unexpected" });
    await expect(
      getSlackHarnessPreference(scope, client as never)
    ).rejects.toThrow("Invalid saved");
    await expect(
      upsertSlackHarnessPreference(
        { ...scope, harness: "unexpected" as never },
        client as never
      )
    ).rejects.toThrow("Invalid harness");
  });
});
