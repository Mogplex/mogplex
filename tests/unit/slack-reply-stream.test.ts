import assert from "node:assert/strict";
import test from "node:test";
import { openSlackConversationalReply } from "../../trigger/slack-event-lib/reply-stream";
import type {
  SlackEventTaskDeps,
  SlackEventTaskPayload,
} from "../../trigger/slack-event-lib/types";

type Message = {
  channel: string;
  ts?: string;
  thread_ts?: string;
  text: string;
  blocks?: unknown[];
};
const payload = {
  teamId: "T1",
  channelId: "C1",
  slackUserId: "U1",
  threadTs: "100.1",
  messageTs: "100.1",
  eventId: "Ev1",
} as SlackEventTaskPayload;
function setup(
  options: { failFinal?: boolean; rejectMarkdown?: boolean } = {}
) {
  const posts: Message[] = [];
  const updates: Message[] = [];
  let time = 1000;
  const deps = {
    runtimeRunId: "run_test123",
    now: () => new Date((time += 2000)),
    postMessage: async (_token: string, input: Message) => {
      if (
        options.rejectMarkdown &&
        input.blocks?.some(
          (block) => (block as { type?: string }).type === "markdown"
        )
      )
        throw new Error("Slack chat.postMessage failed: invalid_blocks");
      if (options.failFinal && posts.length > 0)
        throw new Error("Slack unavailable");
      posts.push(input);
      return { channel: input.channel, ts: `${posts.length}.1` };
    },
    updateMessage: async (_token: string, input: Message) => {
      updates.push(input);
      return { channel: input.channel, ts: input.ts! };
    },
    startStream: async () => {
      throw new Error("Progress must not create a task timeline");
    },
    appendStream: async () => {},
    stopStream: async () => {},
  } as unknown as SlackEventTaskDeps;
  return { deps, posts, updates };
}
async function open(deps: SlackEventTaskDeps) {
  return openSlackConversationalReply({
    deps,
    botToken: "test-token",
    payload,
    postThreadTs: payload.threadTs,
    context: { userText: "List repositories in acme" },
  });
}
test("shows one compact status with a stop action instead of accumulating tool cards", async () => {
  const { deps, posts, updates } = setup();
  const reply = await open(deps);
  assert.equal(posts.length, 1);
  assert.match(JSON.stringify(posts[0].blocks), /Stop request/);
  for (let index = 0; index < 30; index++) {
    await reply.onProgress({
      type: "tool_started",
      toolCallId: `t${index}`,
      toolName: "github_list_repos",
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(posts.length, 1);
  assert.ok(updates.every((update) => (update.blocks?.length ?? 0) <= 2));
  assert.ok(
    updates.every((update) => !JSON.stringify(update).includes("task_update"))
  );
});
test("posts the final answer after connection cards and removes the stop action", async () => {
  const { deps, posts, updates } = setup();
  const reply = await open(deps);
  await deps.postMessage("test-token", {
    channel: "C1",
    thread_ts: payload.threadTs,
    text: "Connect GitHub",
  });
  await reply.onProgress({
    type: "text_delta",
    textDelta: "intermediate prose",
    accumulatedText: "intermediate prose",
  });
  await reply.finalize({
    markdown: "Authorize **acme** to continue.",
    slackText: "Authorize *acme* to continue.",
  });
  assert.equal(posts.at(-1)?.text, "Authorize *acme* to continue.");
  assert.equal(posts.at(-1)?.thread_ts, payload.threadTs);
  assert.deepEqual(posts.at(-1)?.blocks, [
    { type: "markdown", text: "Authorize **acme** to continue." },
  ]);
  assert.doesNotMatch(
    JSON.stringify(updates.at(-1)),
    /Stop request|intermediate prose/
  );
  assert.ok(!updates.some((update) => update.text.includes("Authorize")));
});
test("keeps the answer retryable when its new message cannot be delivered", async () => {
  const { deps } = setup({ failFinal: true });
  const reply = await open(deps);
  await assert.rejects(
    reply.finalize({ markdown: "Final", slackText: "Final" }),
    /Slack unavailable/
  );
});
test("removes active controls on failure", async () => {
  const { deps, updates } = setup();
  const reply = await open(deps);
  assert.equal(await reply.fail("Stopped."), true);
  assert.equal(updates.at(-1)?.text, "Stopped.");
  assert.doesNotMatch(JSON.stringify(updates.at(-1)), /Stop request/);
});

test("falls back to a plain answer if an older Slack app explicitly rejects Markdown blocks", async () => {
  const { deps, posts } = setup({ rejectMarkdown: true });
  const reply = await open(deps);
  await reply.finalize({ markdown: "**Final**", slackText: "*Final*" });
  assert.equal(posts.at(-1)?.text, "*Final*");
  assert.deepEqual(posts.at(-1)?.blocks, []);
});
