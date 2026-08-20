import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  loadSlackEventTask,
  restoreFetch,
  baseInstallation,
  basePayload,
  mappedAttribution,
  agentSuccess,
} from "./helpers/slack-event-task-fixtures";

after(() => {
  restoreFetch();
});

test("posts a visible DM placeholder, runs the agent, and finalises the reply", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];
  let nowMs = Date.parse("2026-05-13T12:00:00.000Z");

  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    loadOrCreateConversation: async () => ({
      id: "conv-1",
      user_id: "user-mogplex",
      messages: [
        { role: "user", content: "earlier turn" },
        { role: "assistant", content: "earlier reply" },
      ],
      model: null,
      title: null,
    }),
    persistConversation: async (input) => {
      calls.push({ op: "persist", input });
    },
    runAgent: async (input) => {
      calls.push({
        op: "agent",
        userId: input.userId,
        conversationId: input.conversationId,
        messages: input.messages,
        onProgress: input.onProgress,
        toolExecutionIdempotencyKey: input.toolExecutionIdempotencyKey,
      });
      await input.onProgress?.({
        type: "tool_started",
        toolCallId: "tool-1",
        toolName: "start_sandbox",
      });
      nowMs += 1_500;
      await input.onProgress?.({
        type: "tool_finished",
        toolCallId: "tool-1",
        toolName: "start_sandbox",
        success: true,
      });
      nowMs += 1_500;
      await input.onProgress?.({
        type: "text_delta",
        textDelta: "Build is",
        accumulatedText: "Build is",
      });
      nowMs += 1_500;
      return agentSuccess({ finalText: "Build is green" });
    },
    postMessage: async (_token, input) => {
      calls.push({ op: "post", input });
      return { channel: input.channel, ts: "1700000000.000999" };
    },
    updateMessage: async (_token, input) => {
      calls.push({ op: "update", input });
      return { channel: input.channel, ts: input.ts };
    },
    now: () => new Date(nowMs),
  });

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(result.conversationId, "conv-1");
  assert.equal(result.mogplexUserId, "user-mogplex");

  const placeholderPost = calls.find((c) => c.op === "post") as {
    input: { channel: string; thread_ts?: string; text: string };
  };
  assert.equal(placeholderPost.input.channel, "C1");
  assert.equal(placeholderPost.input.thread_ts, undefined);
  assert.equal(placeholderPost.input.text, "_Preparing your request..._");

  const agentCall = calls.find((c) => c.op === "agent") as {
    userId: string;
    conversationId: string;
    messages: Array<{ role: string; content: unknown }>;
    onProgress?: unknown;
    toolExecutionIdempotencyKey?: string;
  };
  assert.equal(agentCall.userId, "user-mogplex");
  assert.equal(agentCall.conversationId, "conv-1");
  assert.equal(
    agentCall.toolExecutionIdempotencyKey,
    "slack:T1:Ev123",
    "Slack retries must reuse the same tool-execution scope"
  );
  assert.equal(typeof agentCall.onProgress, "function");
  assert.deepEqual(
    calls
      .filter((call) => call.op === "update")
      .map((call) => (call.input as { text: string }).text),
    ["_Starting the sandbox..._", "Build is", "Build is green"]
  );
  assert.equal(agentCall.messages.length, 3);
  assert.equal(agentCall.messages[2].role, "user");
  assert.equal(agentCall.messages[2].content, "what's the build status?");

  const finalUpdate = calls.findLast((c) => c.op === "update") as {
    input: { channel: string; ts: string; text: string };
  };
  assert.equal(
    calls.filter((c) => c.op === "update").length,
    3,
    "tool progress, partial text, and the final answer should update in order"
  );
  assert.equal(finalUpdate.input.ts, "1700000000.000999");
  assert.equal(finalUpdate.input.text, "Build is green");

  const persistCall = calls.find((c) => c.op === "persist") as {
    input: {
      conversationId: string;
      userId: string;
      messages: Array<{ role: string; content: unknown }>;
    };
  };
  assert.equal(persistCall.input.conversationId, "conv-1");
  assert.equal(persistCall.input.userId, "user-mogplex");
  assert.equal(persistCall.input.messages.length, 4);
  assert.equal(persistCall.input.messages[3].role, "assistant");
  assert.equal(persistCall.input.messages[3].content, "Build is green");
});

test("formats conversational final replies as Slack mrkdwn", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const updates: Array<{ text: string }> = [];
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
    runAgent: async () =>
      agentSuccess({
        finalText:
          "Public GitHub shows **5 open PRs**: [webrenew/drawit#49](https://github.com/webrenew/drawit/pull/49).",
      }),
    postMessage: async (_token, input) => ({
      channel: input.channel,
      ts: "1700000000.000999",
    }),
    updateMessage: async (_token, input) => {
      updates.push({ text: input.text });
      return { channel: input.channel, ts: input.ts };
    },
  });

  assert.equal(result.outcome, "conversational_reply");
  assert.deepEqual(updates, [
    {
      text: "Public GitHub shows *5 open PRs*: <https://github.com/webrenew/drawit/pull/49|webrenew/drawit#49>.",
    },
  ]);
});

test("passes the full thread history to the agent, which owns compaction/windowing", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const longHistory = Array.from({ length: 200 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `turn ${i}`,
  }));

  let agentMessages: Array<{ role: string; content: unknown }> = [];
  let persistedMessages: Array<{ role: string; content: unknown }> = [];

  await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    loadOrCreateConversation: async () => ({
      id: "conv-long",
      user_id: "user-mogplex",
      messages: longHistory,
      model: null,
      title: null,
    }),
    persistConversation: async (input) => {
      persistedMessages = input.messages;
    },
    runAgent: async (input) => {
      agentMessages = input.messages;
      return agentSuccess({ finalText: "ok" });
    },
    postMessage: async (_token, input) => ({
      channel: input.channel,
      ts: "1700000000.000999",
    }),
    updateMessage: async (_token, input) => ({
      channel: input.channel,
      ts: input.ts,
    }),
  });

  // The handler must hand the runner the FULL history: checkpoint reuse
  // fingerprints the stable prefix, so pre-windowing here would break it.
  // The runner compacts oversized histories and windows small ones itself.
  assert.equal(agentMessages.length, longHistory.length + 1);
  assert.equal(agentMessages.at(-1)?.content, "what's the build status?");
  assert.equal(persistedMessages.length, 202);
});

test("persists Slack thread history under the linked conversation owner", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let agentUserId: string | null = null;
  let persistedUserId: string | null = null;

  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () =>
      mappedAttribution("current-slack-user", "current@example.com"),
    loadOrCreateConversation: async () => ({
      id: "conv-1",
      user_id: "conversation-owner",
      messages: [],
      model: null,
      title: null,
    }),
    persistConversation: async (input) => {
      persistedUserId = input.userId;
    },
    runAgent: async (input) => {
      agentUserId = input.userId;
      return agentSuccess({ finalText: "Done" });
    },
    postMessage: async (_token, input) => ({
      channel: input.channel,
      ts: "1700000000.000999",
    }),
    updateMessage: async (_token, input) => ({
      channel: input.channel,
      ts: input.ts,
    }),
  });

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(result.mogplexUserId, "current-slack-user");
  assert.equal(agentUserId, "current-slack-user");
  assert.equal(persistedUserId, "conversation-owner");
});

test("merges Slack thread turns into latest history after a persist conflict", async () => {
  const { runSlackEventTask, SlackConversationPersistConflictError } =
    await loadSlackEventTask();

  const persistCalls: Array<{
    expectedUpdatedAt?: string | null;
    messages: Array<{ role: string; content: unknown }>;
  }> = [];
  let firstPersist = true;

  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () =>
      mappedAttribution("current-slack-user", "current@example.com"),
    loadOrCreateConversation: async () => ({
      id: "conv-1",
      user_id: "conversation-owner",
      messages: [{ role: "user", content: "earlier turn" }],
      model: null,
      title: null,
      updated_at: "2026-05-11T00:00:00.000Z",
    }),
    persistConversation: async (input) => {
      persistCalls.push({
        expectedUpdatedAt: input.expectedUpdatedAt,
        messages: input.messages,
      });
      if (!firstPersist) return;
      firstPersist = false;
      throw new SlackConversationPersistConflictError({
        id: "conv-1",
        user_id: "conversation-owner",
        messages: [{ role: "user", content: "parallel turn" }],
        model: null,
        title: null,
        updated_at: "2026-05-11T00:00:01.000Z",
      });
    },
    runAgent: async () => agentSuccess({ finalText: "Done" }),
    postMessage: async (_token, input) => ({
      channel: input.channel,
      ts: "1700000000.000999",
    }),
    updateMessage: async (_token, input) => ({
      channel: input.channel,
      ts: input.ts,
    }),
  });

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(persistCalls.length, 2);
  assert.equal(persistCalls[0].expectedUpdatedAt, "2026-05-11T00:00:00.000Z");
  assert.deepEqual(
    persistCalls[0].messages.map((message) => message.content),
    ["earlier turn", "what's the build status?", "Done"]
  );
  assert.equal(persistCalls[1].expectedUpdatedAt, "2026-05-11T00:00:01.000Z");
  assert.deepEqual(
    persistCalls[1].messages.map((message) => message.content),
    ["parallel turn", "what's the build status?", "Done"]
  );
});

test("posts an error notice and rethrows when the agent fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  await assert.rejects(
    () =>
      runSlackEventTask(basePayload, {
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
        runAgent: async () => {
          throw new Error("model unreachable");
        },
        postMessage: async (_token, input) => ({
          channel: input.channel,
          ts: "1700000000.000999",
        }),
        updateMessage: async (_token, input) => {
          calls.push({ op: "update", input });
          return { channel: input.channel, ts: input.ts };
        },
      }),
    /model unreachable/
  );

  const errorUpdate = calls.find((c) => c.op === "update") as {
    input: { text: string };
  };
  assert.match(errorUpdate.input.text, /Mogplex hit an error/i);
  assert.doesNotMatch(errorUpdate.input.text, /model unreachable/i);
});

test("preserves the original agent error when the Slack error update fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  await assert.rejects(
    () =>
      runSlackEventTask(basePayload, {
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
        runAgent: async () => {
          throw new Error("model unreachable");
        },
        postMessage: async (_token, input) => ({
          channel: input.channel,
          ts: "1700000000.000999",
        }),
        updateMessage: async () => {
          throw new Error("slack update failed");
        },
      }),
    /model unreachable/
  );
});
