import { expect, it } from "vitest";
import { stripSlackRunControlsForTerminalRun } from "./run-controls-notify";
import type { PostSlackMessageInput } from "./client";
import { emptyRunResultEvidence } from "./run-result-evidence";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

const run = {
  id: "run-1",
  prompt: "Fix the mobile controls",
  working_branch: "fix/mobile",
  metadata: {
    slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
  } as Record<string, unknown>,
};

// Fixtures: run message has view link but NOT outcome line; announcements have
// BOTH view link AND "Run finished/failed/cancelled".
const runOwnMessage = {
  ts: "1.2",
  bot_id: "B123",
  text: "Started: /runs/run-1?view=details",
};
const existingAnnouncement = {
  ts: "1.3",
  bot_id: "B123",
  text: "Run finished\n/runs/run-1?view=details",
};
// Regression: run message with view link but no outcome line (ts exclusion fix).
const runMsgWithViewLinkNoOutcome = {
  ts: "1.2",
  bot_id: "B123",
  text: ":rocket: Started run `run-1` — <https://mogplex.com/runs/run-1?view=details|view in Mogplex>",
};

it.each([
  {
    case: "duplicate",
    threadMsgs: [runOwnMessage, existingAnnouncement],
    expectPost: false,
  },
  { case: "no prior", threadMsgs: [runOwnMessage], expectPost: true },
  { case: "check fails", threadMsgs: "throw", expectPost: true },
  // Regression: run's own message with view link but no outcome - must post
  {
    case: "self-match",
    threadMsgs: [runMsgWithViewLinkNoOutcome],
    expectPost: true,
  },
] as const)(
  "idempotent announcement: $case",
  async ({ threadMsgs, expectPost }) => {
    const posts: PostSlackMessageInput[] = [];
    const threadFetchCalls: Array<{
      channel: string;
      threadTs: string;
      oldest?: string;
      limit?: number;
    }> = [];
    const threadRun = {
      ...run,
      metadata: {
        ...run.metadata,
        slackRunControls: {
          teamId: "T1",
          channelId: "C1",
          messageTs: "1.2",
          threadTs: "1.1",
        },
      },
    };
    await stripSlackRunControlsForTerminalRun(
      threadRun,
      "success",
      {
        getSlackBotToken: async () => "fixture-token",
        updateSlackMessage: async () => {},
        postSlackMessage: async (_token, msg) => posts.push(msg),
        getThreadMessages: async (_token, input) => {
          threadFetchCalls.push(input);
          if (threadMsgs === "throw") throw new Error("Slack API unavailable");
          return [...threadMsgs];
        },
        loadRunOutput: async () => "Done.",
        loadEvidence: async () => emptyRunResultEvidence(),
      },
      { announce: true }
    );
    expect(posts).toHaveLength(expectPost ? 1 : 0);
    // Pin thread fetch arguments: channel, thread, oldest (after run msg), limit.
    // The mock records arguments even when it then throws, so this always runs.
    expect(threadFetchCalls[0]).toEqual({
      channel: "C1",
      threadTs: "1.1",
      oldest: "1.2",
      limit: 200,
    });
  }
);

// Without threadTs, announceRunEnd posts as a top-level channel message. The
// duplicate check uses conversations.history (getChannelMessages) instead of
// conversations.replies (getThreadMessages).
it("uses getChannelMessages for top-level announcement idempotency", async () => {
  const posts: PostSlackMessageInput[] = [];
  let threadFetchCalled = false;
  const channelFetchCalls: Array<{
    channel: string;
    oldest?: string;
    limit?: number;
  }> = [];
  const noThreadRun = {
    ...run,
    metadata: {
      ...run.metadata,
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
    },
  };
  await stripSlackRunControlsForTerminalRun(
    noThreadRun,
    "success",
    {
      getSlackBotToken: async () => "fixture-token",
      updateSlackMessage: async () => {},
      postSlackMessage: async (_token, msg) => posts.push(msg),
      getThreadMessages: async () => {
        threadFetchCalled = true;
        return [];
      },
      getChannelMessages: async (_token, input) => {
        channelFetchCalls.push(input);
        return []; // no prior announcement
      },
      loadRunOutput: async () => "Done.",
      loadEvidence: async () => emptyRunResultEvidence(),
    },
    { announce: true }
  );
  expect(threadFetchCalled).toBe(false); // should use channel, not thread
  expect(channelFetchCalls).toHaveLength(1);
  expect(channelFetchCalls[0]).toEqual({
    channel: "C1",
    oldest: "1.2",
    limit: 200,
  });
  expect(posts).toHaveLength(1);
  expect(posts[0]?.thread_ts).toBeUndefined(); // top-level, not threaded
});

// When an existing announcement is found in channel history, skip the duplicate.
it("skips duplicate top-level announcement", async () => {
  const posts: PostSlackMessageInput[] = [];
  const existingTopLevelAnnouncement = {
    ts: "1.5",
    bot_id: "B123",
    text: "Run finished\n/runs/run-1?view=details",
  };
  const noThreadRun = {
    ...run,
    metadata: {
      ...run.metadata,
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
    },
  };
  await stripSlackRunControlsForTerminalRun(
    noThreadRun,
    "success",
    {
      getSlackBotToken: async () => "fixture-token",
      updateSlackMessage: async () => {},
      postSlackMessage: async (_token, msg) => posts.push(msg),
      getChannelMessages: async () => [existingTopLevelAnnouncement],
      loadRunOutput: async () => "Done.",
      loadEvidence: async () => emptyRunResultEvidence(),
    },
    { announce: true }
  );
  expect(posts).toHaveLength(0); // duplicate found, skip
});
