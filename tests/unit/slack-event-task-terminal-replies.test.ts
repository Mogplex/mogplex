import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  agentSuccess,
  baseInstallation,
  basePayload,
  loadSlackEventTask,
  mappedAttribution,
  restoreFetch,
} from "./helpers/slack-event-task-fixtures";

after(() => {
  restoreFetch();
});

test("shortens oversized agent replies before updating the Slack placeholder", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const updates: string[] = [];
  const oversizedReply = `${"a".repeat(3_998)}😀😀`;
  let agentAbortSignal: AbortSignal | undefined;

  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    loadOrCreateConversation: async () => ({
      id: "conv-1",
      user_id: "user-mogplex",
      messages: [],
      model: null,
      title: null,
    }),
    persistConversation: async () => undefined,
    runAgent: async (input) => {
      agentAbortSignal = input.abortSignal;
      return agentSuccess({ finalText: oversizedReply });
    },
    postMessage: async (_token, input) => ({
      channel: input.channel,
      ts: "1700000000.000999",
    }),
    updateMessage: async (_token, input) => {
      if (input.text.length > 4_000) {
        throw new Error("Slack chat.update failed: msg_too_long");
      }
      updates.push(input.text);
      return { channel: input.channel, ts: input.ts };
    },
  });

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(updates.length, 1);
  assert.ok(updates[0].length <= 4_000);
  assert.match(updates[0], /shortened to fit Slack/i);
  assert.ok(agentAbortSignal instanceof AbortSignal);
  assert.equal(agentAbortSignal.aborted, false);
});

test("does not recover a Slack reply that already reached a terminal state", async () => {
  const { recoverSlackEventTerminalFailure } = await loadSlackEventTask();
  let dependencyCalls = 0;

  const recovered = await recoverSlackEventTerminalFailure(
    basePayload,
    {
      getBotToken: async () => {
        dependencyCalls += 1;
        return "xoxb-test";
      },
      updateMessage: async (_token, input) => {
        dependencyCalls += 1;
        return { channel: input.channel, ts: input.ts };
      },
      postMessage: async (_token, input) => {
        dependencyCalls += 1;
        return { channel: input.channel, ts: "1700000000.001000" };
      },
    },
    undefined,
    {
      read: () => "delivered",
      save: async () => undefined,
    }
  );

  assert.equal(recovered, true);
  assert.equal(dependencyCalls, 0);
});

test("does not throw when Slack bot token recovery fails", async () => {
  const { recoverSlackEventTerminalFailure } = await loadSlackEventTask();

  const recovered = await recoverSlackEventTerminalFailure(basePayload, {
    getBotToken: async () => {
      throw new Error("database unavailable");
    },
  });

  assert.equal(recovered, false);
});

test("replaces a known placeholder after the Trigger task exhausts retries", async () => {
  const { recoverSlackEventTerminalFailure } = await loadSlackEventTask();
  const updates: string[] = [];

  const recovered = await recoverSlackEventTerminalFailure(
    basePayload,
    {
      getBotToken: async () => "xoxb-test",
      updateMessage: async (_token, input) => {
        updates.push(input.text);
        return { channel: input.channel, ts: input.ts };
      },
    },
    { channel: basePayload.channelId, ts: "1700000000.000999" }
  );

  assert.equal(recovered, true);
  assert.equal(updates.length, 1);
  assert.match(updates[0], /couldn't finish this response/i);
  assert.doesNotMatch(updates[0], /stack|exception|token/i);
});

test("posts an idempotent terminal fallback when the placeholder cannot be updated", async () => {
  const { recoverSlackEventTerminalFailure } = await loadSlackEventTask();
  const posts: Array<{ text: string; threadTs?: string }> = [];

  const recovered = await recoverSlackEventTerminalFailure(
    {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
    },
    {
      getBotToken: async () => "xoxb-test",
      updateMessage: async () => {
        throw new Error("Slack chat.update failed: message_not_found");
      },
      postMessage: async (_token, input) => {
        posts.push({ text: input.text, threadTs: input.thread_ts });
        return { channel: input.channel, ts: "1700000000.001000" };
      },
    },
    { channel: basePayload.channelId, ts: "1700000000.000999" }
  );

  assert.equal(recovered, true);
  assert.deepEqual(posts, [
    {
      text: ":warning: Mogplex couldn't finish this response. Try again from Slack or open Mogplex for details.",
      threadTs: basePayload.threadTs,
    },
  ]);
});
