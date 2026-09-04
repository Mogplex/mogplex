import { describe, expect, it } from "vitest";
import type { PostSlackMessageInput } from "@/lib/slack/client";
import type { HarnessCheckpoint } from "@/lib/harness/checkpoint";
import {
  buildRunCheckpointText,
  notifySlackRunCheckpoint,
} from "./run-checkpoint-notify";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

function makeDeps() {
  const posts: PostSlackMessageInput[] = [];
  return {
    posts,
    deps: {
      getSlackBotToken: async () => "xoxb-test" as string | null,
      postSlackMessage: async (
        _token: string,
        input: PostSlackMessageInput
      ) => {
        posts.push(input);
      },
    },
  };
}

const runWithSlack = {
  id: "run-1",
  metadata: {
    slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "123.45" },
  },
};

const fullCheckpoint: HarnessCheckpoint = {
  previewUrl: "https://sb-abc.vercel.run",
  summary: "Moved sign in into the menu.",
};

describe("buildRunCheckpointText", () => {
  it("should include the summary, preview URL and steering instructions", () => {
    const text = buildRunCheckpointText({
      runId: "run-1",
      runUrl: "https://mogplex.com/runs/run-1",
      checkpoint: fullCheckpoint,
    });
    expect(text).toContain("Moved sign in into the menu.");
    expect(text).toContain("https://sb-abc.vercel.run");
    expect(text.toLowerCase()).toContain("reply in this thread");
    expect(text).toContain("ship it");
  });

  it("should omit the preview line when there is no preview URL", () => {
    const text = buildRunCheckpointText({
      runId: "run-1",
      runUrl: "https://mogplex.com/runs/run-1",
      checkpoint: { previewUrl: null, summary: null },
    });
    expect(text).not.toContain("Preview:");
    expect(text.toLowerCase()).toContain("reply in this thread");
  });
});

describe("notifySlackRunCheckpoint", () => {
  it("should post a thread reply with the checkpoint details", async () => {
    const { posts, deps } = makeDeps();
    await notifySlackRunCheckpoint(runWithSlack, fullCheckpoint, deps);

    expect(posts).toHaveLength(1);
    expect(posts[0].channel).toBe("C1");
    expect(posts[0].thread_ts).toBe("123.45");
    expect(posts[0].text).toContain("https://sb-abc.vercel.run");
    expect(posts[0].blocks?.length).toBeGreaterThan(0);
  });

  it("should be a no-op for a run that did not come from Slack", async () => {
    const { posts, deps } = makeDeps();
    await notifySlackRunCheckpoint(
      { id: "run-2", metadata: { source: "external-api" } },
      fullCheckpoint,
      deps
    );
    expect(posts).toHaveLength(0);
  });

  it("should be a no-op when no bot token is available", async () => {
    const posts: PostSlackMessageInput[] = [];
    await notifySlackRunCheckpoint(runWithSlack, fullCheckpoint, {
      getSlackBotToken: async () => null,
      postSlackMessage: async (_token, input) => {
        posts.push(input);
      },
    });
    expect(posts).toHaveLength(0);
  });
});
