import { beforeAll, describe, expect, it, vi } from "vitest";

let setSlackChannelLink: typeof import("./channel-links").setSlackChannelLink;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ setSlackChannelLink } = await import("./channel-links"));
});

describe("Slack channel links", () => {
  it("atomically replaces the repository for an existing channel", async () => {
    const row = {
      id: "link-1",
      slack_installation_id: "installation-1",
      channel_id: "C1",
      channel_name: null,
      repo_id: "repo-2",
      created_by_user_id: "user-1",
      created_at: "2026-08-29T00:00:00Z",
    };
    const query = {
      upsert: vi.fn(() => query),
      select: vi.fn(() => query),
      single: vi.fn(async () => ({ data: row, error: null })),
    };
    const client = { from: vi.fn(() => query) };

    await expect(
      setSlackChannelLink(
        {
          installationId: "installation-1",
          channelId: "C1",
          channelName: null,
          repoId: "repo-2",
          createdByUserId: "user-1",
        },
        client as never
      )
    ).resolves.toEqual(row);
    expect(query.upsert).toHaveBeenCalledWith(
      {
        slack_installation_id: "installation-1",
        channel_id: "C1",
        channel_name: null,
        repo_id: "repo-2",
        created_by_user_id: "user-1",
      },
      { onConflict: "slack_installation_id,channel_id" }
    );
  });
});
