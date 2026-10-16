import { describe, expect, it } from "vitest";
import {
  handleEntityDetailsRequested,
  handleLinkShared,
  type WorkObjectDeps,
} from "./work-object-events";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

const RUN_ID = "00000000-0000-4000-8000-000000000041";
const LINK = `https://mogplex.com/runs/${RUN_ID}`;

const run = {
  id: RUN_ID,
  user_id: "owner",
  repo_id: "repo-1",
  status: "success",
  prompt: "Fix the header",
  harness: "mogplex",
  working_branch: "fix/header",
  metadata: {
    slackRunControls: { teamId: "T1", channelId: "C-card", messageTs: "1.2" },
  },
  created_at: "2026-10-16T10:00:00.000Z",
  updated_at: "2026-10-16T10:05:00.000Z",
};

function harness(options: { run?: typeof run | null } = {}) {
  const unfurls: Array<Record<string, unknown>> = [];
  const details: Array<Record<string, unknown>> = [];
  const deps = {
    appOrigin: () => "https://mogplex.com",
    getBotToken: async () => "xoxb",
    getInstallation: async () => ({
      id: "I1",
      authed_user_slack_id: "U-owner",
      installed_by_user_id: "owner",
    }),
    getUserMapping: async () => null,
    loadRun: async () => (options.run === undefined ? run : options.run),
    loadRepoName: async () => "acme/web",
    unfurl: async (_token: string, input: Record<string, unknown>) => {
      unfurls.push(input);
    },
    presentDetails: async (_token: string, input: Record<string, unknown>) => {
      details.push(input);
    },
  } as unknown as Partial<WorkObjectDeps>;
  return { deps, unfurls, details };
}

const shared = (user: string, channel: string) => ({
  type: "link_shared" as const,
  channel,
  user,
  message_ts: "100.1",
  unfurl_id: "unfurl-1",
  source: "conversations_history",
  links: [
    { url: LINK, domain: "mogplex.com" },
    { url: "https://github.com/acme/web", domain: "github.com" },
  ],
});

describe("handleLinkShared", () => {
  it("should unfurl the owner's run link anywhere", async () => {
    const { deps, unfurls } = harness();

    expect(
      await handleLinkShared("T1", shared("U-owner", "C-else"), deps)
    ).toBe("unfurled");

    expect(unfurls).toHaveLength(1);
    expect(unfurls[0]).toMatchObject({
      unfurl_id: "unfurl-1",
      source: "conversations_history",
    });
    const entities = (unfurls[0].metadata as { entities: unknown[] }).entities;
    expect(entities).toHaveLength(1);
    expect(JSON.stringify(entities[0])).toContain(`"app_unfurl_url":"${LINK}"`);
  });

  it("should unfurl a teammate's link in the run card's channel", async () => {
    const { deps, unfurls } = harness();

    expect(
      await handleLinkShared("T1", shared("U-teammate", "C-card"), deps)
    ).toBe("unfurled");
    expect(unfurls).toHaveLength(1);
  });

  it("should leave a teammate's link elsewhere as a plain link", async () => {
    const { deps, unfurls } = harness();

    expect(
      await handleLinkShared("T1", shared("U-teammate", "C-else"), deps)
    ).toBe("not_visible");
    expect(unfurls).toHaveLength(0);
  });

  it("should ignore messages without run links", async () => {
    const { deps, unfurls } = harness();
    const event = { ...shared("U-owner", "C-else"), links: [] };

    expect(await handleLinkShared("T1", event, deps)).toBe("ignored");
    expect(unfurls).toHaveLength(0);
  });
});

describe("handleEntityDetailsRequested", () => {
  const requested = (user: string, channel: string) => ({
    type: "entity_details_requested" as const,
    user,
    channel,
    trigger_id: "trigger-1",
    external_ref: { id: RUN_ID, type: "agent_run" },
    entity_url: LINK,
  });

  it("should fill the flexpane for the owner", async () => {
    const { deps, details } = harness();

    expect(
      await handleEntityDetailsRequested(
        "T1",
        requested("U-owner", "C-else"),
        deps
      )
    ).toBe("presented");
    expect(details[0].trigger_id).toBe("trigger-1");
    const metadata = details[0].metadata as Record<string, unknown>;
    expect(metadata.app_unfurl_url).toBeUndefined();
    expect(JSON.stringify(metadata)).toContain("acme/web");
  });

  it("should answer restricted for a run the viewer cannot see, and the same for a missing run", async () => {
    const hidden = harness();
    expect(
      await handleEntityDetailsRequested(
        "T1",
        requested("U-teammate", "C-else"),
        hidden.deps
      )
    ).toBe("restricted");
    expect(hidden.details[0]).toEqual({
      trigger_id: "trigger-1",
      error: { status: "restricted" },
    });

    const missing = harness({ run: null });
    expect(
      await handleEntityDetailsRequested(
        "T1",
        requested("U-owner", "C-else"),
        missing.deps
      )
    ).toBe("restricted");
    expect(missing.details[0]).toEqual(hidden.details[0]);
  });
});
