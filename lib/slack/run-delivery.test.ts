import { expect, it } from "vitest";
import { deliverSlackRunUpdate } from "./run-delivery";
import { stripSlackRunControlsForTerminalRun } from "./run-controls-notify";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import { serializeRunProgress } from "./run-progress-store";
import { applyRunProgress, createRunProgressState } from "./run-progress-state";
import type { PostSlackMessageInput, UpdateSlackMessageInput } from "./client";
import { postGuidanceReplies } from "./run-guidance-replies";
import type { PendingGuidanceReply } from "./run-guidance-store";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

function fixture() {
  const state = createRunProgressState(1000);
  applyRunProgress(
    state,
    {
      kind: "phase",
      phase: "Verifying",
      summary: "Updated the mobile controls.",
      next: "Check desktop layout.",
    },
    2000
  );
  let run = buildRunRow({
    status: "streaming",
    metadata: {
      slack_task_title: "Fix mobile controls",
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
    },
    slack_progress: serializeRunProgress(state),
    slack_progress_revision: 3,
  });
  const updates: UpdateSlackMessageInput[] = [];
  const posts: PostSlackMessageInput[] = [];
  // In-memory guidance inbox: replies the agent wrote, and the posted ts.
  const replies: (PendingGuidanceReply & { posted?: string })[] = [];
  let clock = 10_000;
  const updateMessage = async (
    _token: string,
    message: UpdateSlackMessageInput
  ) => {
    updates.push(message);
    return { channel: "C1", ts: "1.2" };
  };
  const deps = {
    loadRun: async (userId: string, runId: string) =>
      userId === run.user_id && runId === run.id ? run : null,
    getToken: async () => "test-token",
    updateMessage,
    sendTerminal: (
      row: Parameters<typeof stripSlackRunControlsForTerminalRun>[0],
      status: typeof run.status,
      _deps?: unknown,
      options: { announce?: boolean } = {}
    ) =>
      stripSlackRunControlsForTerminalRun(
        row,
        status,
        {
          getSlackBotToken: async () => "test-token",
          updateSlackMessage: updateMessage,
          postSlackMessage: async (_token, message) => {
            posts.push(message);
          },
          loadRunOutput: async () =>
            "Changed the controls. Tests passed. https://github.com/example/app/pull/42",
        },
        options
      ),
    markDelivered: async (
      _row: typeof run,
      _status: typeof run.status,
      key: string
    ) => {
      run = { ...run, slack_terminal_notification_key: key };
    },
    markProgressDelivered: async (_row: typeof run, key: string) => {
      run = {
        ...run,
        slack_progress_delivered_key: key,
        slack_progress_delivered_at: new Date(clock).toISOString(),
      };
    },
    postReplies: (row: { id: string; user_id: string }, teamId: string) =>
      postGuidanceReplies(row, teamId, {
        loadReplies: async () => replies.filter((reply) => !reply.posted),
        getToken: async () => "test-token",
        post: async (_token, message) => {
          posts.push(message);
          return { channel: message.channel, ts: `9.${posts.length}` };
        },
        markPosted: async ({ id, messageTs }) => {
          const reply = replies.find((item) => item.id === id);
          if (reply) reply.posted = messageTs;
        },
      }),
    now: () => clock,
    wait: async (milliseconds: number) => {
      clock += milliseconds;
    },
  };
  return {
    updates,
    posts,
    replies,
    deps,
    input: { runId: run.id, userId: run.user_id },
    getRun: () => run,
    setRun: (update: Partial<typeof run>) => {
      run = { ...run, ...update };
    },
  };
}

it("coalesces queued progress jobs against the latest durable snapshot", async () => {
  const f = fixture();
  await deliverSlackRunUpdate(f.input, f.deps);
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates).toHaveLength(1);
  expect(f.updates[0].text).toContain("Updated the mobile controls.");
  expect(f.getRun().slack_progress_delivered_key).toBeTruthy();
});

it("a late progress job renders the actual terminal result and cannot resurrect Cancel", async () => {
  const f = fixture();
  f.setRun({ status: "success" });
  await deliverSlackRunUpdate(f.input, f.deps);
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates).toHaveLength(1);
  expect(f.updates[0].text).toContain("https://github.com/example/app/pull/42");
  expect(f.updates[0].text).not.toContain("Preparing the next step");
  expect(JSON.stringify(f.updates[0].blocks)).not.toContain(
    "mogplex-cancel-run"
  );
});

it("reloads after delivery pacing so completion during the wait wins", async () => {
  const f = fixture();
  f.setRun({ slack_progress_delivered_at: new Date(9500).toISOString() });
  await deliverSlackRunUpdate(f.input, {
    ...f.deps,
    wait: async () => {
      f.setRun({ status: "cancelled" });
    },
  });
  expect(f.updates[0].text).toContain("cancelled");
  expect(f.updates[0].blocks?.some((block) => block.type === "plan")).toBe(
    false
  );
});

it("does not mark a missing token or failed Slack call as delivered", async () => {
  const f = fixture();
  await expect(
    deliverSlackRunUpdate(f.input, { ...f.deps, getToken: async () => null })
  ).rejects.toThrow();
  await expect(
    deliverSlackRunUpdate(f.input, {
      ...f.deps,
      updateMessage: async () => {
        throw new Error("Slack unavailable");
      },
    })
  ).rejects.toThrow();
  expect(f.getRun().slack_progress_delivered_key).toBeUndefined();
});

it("does not cross the run owner boundary", async () => {
  const f = fixture();
  expect(
    await deliverSlackRunUpdate({ ...f.input, userId: "other-owner" }, f.deps)
  ).toEqual({ delivered: false });
  expect(f.updates).toHaveLength(0);
});

it("shows a real review pause without an active work timeline", async () => {
  const f = fixture();
  f.setRun({ status: "awaiting_input" });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates[0].text).toContain("Waiting for your review");
  expect(f.updates[0].blocks?.some((block) => block.type === "plan")).toBe(
    false
  );
});

it("preserves worker preparation rather than labelling it queued", async () => {
  const f = fixture();
  const state = createRunProgressState(1000);
  applyRunProgress(
    state,
    {
      kind: "phase",
      phase: "Preparing workspace",
      summary: "Starting the isolated workspace.",
      next: "Inspect the repository.",
    },
    2000
  );
  f.setRun({ status: "pending", slack_progress: serializeRunProgress(state) });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates[0].text).toContain("Starting the isolated workspace.");
  expect(f.updates[0].text).not.toContain("Waiting for the coding worker");
});

it("announces a run's end once, even when a late guidance receipt refreshes the message", async () => {
  const f = fixture();
  f.setRun({ status: "success" });
  await deliverSlackRunUpdate(f.input, f.deps);
  f.setRun({ slack_progress_revision: 4 });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates).toHaveLength(2);
  expect(f.posts).toHaveLength(1);
  expect(f.posts[0].text).toContain("Run finished");
});

it("answers Slack guidance in its thread once, even after the run has ended", async () => {
  const f = fixture();
  f.replies.push({
    id: "00000000-0000-4000-8000-0000000000a1",
    channel_id: "C1",
    thread_ts: "1.2",
    reply_text: "**SITREP** PR #194 is open; fixing review item 5 next.",
  });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.posts).toEqual([
    {
      channel: "C1",
      thread_ts: "1.2",
      text: "*SITREP* PR #194 is open; fixing review item 5 next.",
    },
  ]);
  f.setRun({ status: "success", slack_progress_revision: 4 });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.posts.filter((post) => post.text.includes("SITREP"))).toHaveLength(
    1
  );
});

it("keeps a long guidance answer readable and links the full text", async () => {
  const f = fixture();
  f.replies.push({
    id: "00000000-0000-4000-8000-0000000000a2",
    channel_id: "C1",
    thread_ts: "1.2",
    reply_text: "x".repeat(5000),
  });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(Array.from(f.posts[0].text).length).toBeLessThanOrEqual(4000);
  expect(f.posts[0].text).toContain("|Read the full reply>");
});

it("still updates the run card when a guidance answer cannot be posted", async () => {
  const f = fixture();
  const marked: string[] = [];
  const failing = (message: string, token: string | null = "test-token") => ({
    ...f.deps,
    postReplies: (row: { id: string; user_id: string }, teamId: string) =>
      postGuidanceReplies(row, teamId, {
        loadReplies: async () => [
          {
            id: "00000000-0000-4000-8000-0000000000a3",
            channel_id: "C1",
            thread_ts: "1.2",
            reply_text: "SITREP",
          },
        ],
        getToken: async () => token,
        post: async () => {
          throw new Error(message);
        },
        markPosted: async ({ messageTs }) => {
          marked.push(messageTs);
        },
      }),
  });
  // A transient failure stays pending for the next delivery.
  await deliverSlackRunUpdate(
    f.input,
    failing("Slack chat.postMessage failed: ratelimited")
  );
  expect(f.updates).toHaveLength(1);
  expect(marked).toEqual([]);
  f.setRun({ slack_progress_revision: 4 });
  await deliverSlackRunUpdate(
    f.input,
    failing("Slack chat.postMessage failed: channel_not_found")
  );
  // Re-inviting the bot fixes a channel access error, so it stays pending.
  expect(marked).toEqual([]);
  // A failure no retry can fix is recorded so it is not retried forever.
  f.setRun({ slack_progress_revision: 5 });
  await deliverSlackRunUpdate(
    f.input,
    failing("Slack chat.postMessage failed: is_archived")
  );
  expect(f.updates).toHaveLength(3);
  expect(marked).toEqual(["failed:is_archived"]);
  // No bot token for the answer: the card still updates.
  f.setRun({ slack_progress_revision: 6 });
  await deliverSlackRunUpdate(f.input, failing("unused", null));
  expect(f.updates).toHaveLength(4);
});

it("cuts a long answer on a code point and closes an open code fence before the link", async () => {
  const f = fixture();
  f.replies.push({
    id: "00000000-0000-4000-8000-0000000000a4",
    channel_id: "C1",
    thread_ts: "1.2",
    reply_text: `\`\`\`\n${"😀".repeat(5000)}\n\`\`\``,
  });
  await deliverSlackRunUpdate(f.input, f.deps);
  const text = f.posts[0].text;
  expect(Array.from(text).length).toBeLessThanOrEqual(4000);
  expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  const [, beforeLink] =
    /^([\s\S]*)…\n<[^>]+\|Read the full reply>$/.exec(text) ?? [];
  expect((beforeLink.match(/```/g) ?? []).length % 2).toBe(0);
});

it("answers two messages the agent read in the same step with one thread reply", async () => {
  const f = fixture();
  for (const id of [
    "00000000-0000-4000-8000-0000000000b1",
    "00000000-0000-4000-8000-0000000000b2",
  ])
    f.replies.push({
      id,
      channel_id: "C1",
      thread_ts: "1.2",
      reply_text: "SITREP, and the buttons now sit on an elevated surface.",
    });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.posts).toHaveLength(1);
  expect(f.replies.map((reply) => reply.posted)).toEqual(["9.1", "9.1"]);
});
