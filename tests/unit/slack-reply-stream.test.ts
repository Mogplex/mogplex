import assert from "node:assert/strict";
import test from "node:test";
import {
  createSlackReplyStream,
  openSlackConversationalReply,
} from "../../trigger/slack-event-lib/reply-stream";
import type {
  SlackEventTaskDeps,
  SlackEventTaskPayload,
} from "../../trigger/slack-event-lib/types";

type Call = { op: string; input: Record<string, unknown> };

function streamDeps(
  options: { failAppend?: boolean; failStop?: boolean } = {}
) {
  const calls: Call[] = [];
  const deps = {
    startStream: async (_token: string, input: Record<string, unknown>) => {
      calls.push({ op: "start", input });
      return { channel: String(input.channel), ts: "200.1" };
    },
    appendStream: async (_token: string, input: Record<string, unknown>) => {
      calls.push({ op: "append", input });
      if (options.failAppend) throw new Error("rate_limited");
    },
    stopStream: async (_token: string, input: Record<string, unknown>) => {
      calls.push({ op: "stop", input });
      if (options.failStop) throw new Error("message_not_in_streaming_state");
    },
    updateMessage: async (_token: string, input: Record<string, unknown>) => {
      calls.push({ op: "update", input });
      return { channel: String(input.channel), ts: String(input.ts) };
    },
  };
  return { calls, deps };
}

function clock() {
  let time = 0;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function build(deps: ReturnType<typeof streamDeps>["deps"], now: () => number) {
  return createSlackReplyStream({
    deps: deps as unknown as Parameters<
      typeof createSlackReplyStream
    >[0]["deps"],
    botToken: "xoxb",
    channel: "C1",
    ts: "200.1",
    context: { userText: "why is the build red?" },
    now,
    appendIntervalMs: 1_000,
  });
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("streams tool steps as task cards and only whole words of the answer", async () => {
  const { calls, deps } = streamDeps();
  const time = clock();
  const reply = build(deps, time.now);

  await reply.onProgress({
    type: "tool_started",
    toolCallId: "t1",
    toolName: "github_api",
  });
  time.advance(1_000);
  await reply.onProgress({
    type: "text_delta",
    textDelta: "The build fails in lin",
    accumulatedText: "The build fails in lin",
  });
  await settle();

  const append = calls.find((call) => call.op === "append");
  assert.deepEqual(append?.input.chunks, [
    {
      type: "task_update",
      id: "mogplex-prepare",
      title: "Reading your request",
      status: "complete",
    },
    {
      type: "task_update",
      id: "t1",
      title: "Checking GitHub",
      status: "in_progress",
    },
    { type: "markdown_text", text: "The build fails in " },
  ]);
});

test("finishes by streaming the rest of the answer and keeps the task cards", async () => {
  const { calls, deps } = streamDeps();
  const time = clock();
  const reply = build(deps, time.now);
  time.advance(1_000);
  await reply.onProgress({
    type: "text_delta",
    textDelta: "Lint fails ",
    accumulatedText: "Lint fails ",
  });
  await settle();

  await reply.finalize({
    markdown: "Lint fails on **two** files.",
    slackText: "Lint fails on *two* files.",
  });

  // The last streamed word is held back until a space confirms it ended.
  const append = calls.find((call) => call.op === "append");
  assert.deepEqual((append?.input.chunks as unknown[]).at(-1), {
    type: "markdown_text",
    text: "Lint ",
  });
  const stop = calls.find((call) => call.op === "stop");
  assert.deepEqual(stop?.input.chunks, [
    { type: "markdown_text", text: "fails on **two** files." },
  ]);
  assert.equal(
    calls.some((call) => call.op === "update"),
    false
  );
});

test("replaces the streamed text when the final answer does not extend it", async () => {
  const { calls, deps } = streamDeps();
  const time = clock();
  const reply = build(deps, time.now);
  time.advance(1_000);
  await reply.onProgress({
    type: "text_delta",
    textDelta: "Let me check the logs first. ",
    accumulatedText: "Let me check the logs first. ",
  });
  await settle();

  await reply.finalize({
    markdown: "Lint fails on two files.",
    slackText: "Lint fails on two files.",
  });

  assert.deepEqual(
    calls.filter((call) => call.op !== "append").map((call) => call.op),
    ["stop", "update"]
  );
  assert.equal(calls.at(-1)?.input.text, "Lint fails on two files.");
});

test("a failed append stops streaming but the final answer still lands", async () => {
  const { calls, deps } = streamDeps({ failAppend: true });
  const time = clock();
  const reply = build(deps, time.now);
  time.advance(1_000);
  await reply.onProgress({
    type: "text_delta",
    textDelta: "Partial answer ",
    accumulatedText: "Partial answer ",
  });
  await settle();
  time.advance(1_000);
  await reply.onProgress({
    type: "text_delta",
    textDelta: "more ",
    accumulatedText: "Partial answer more ",
  });

  await reply.finalize({
    markdown: "Partial answer more text.",
    slackText: "Partial answer more text.",
  });

  assert.equal(calls.filter((call) => call.op === "append").length, 1);
  assert.equal(calls.at(-1)?.op, "update");
  assert.equal(calls.at(-1)?.input.text, "Partial answer more text.");
});

test("an error notice stops the stream and edits the message", async () => {
  const { calls, deps } = streamDeps({ failStop: true });
  const reply = build(deps, clock().now);

  assert.equal(await reply.fail(":warning: failed"), true);
  assert.deepEqual(
    calls.map((call) => call.op),
    ["stop", "update"]
  );
});

const payload = {
  teamId: "T1",
  channelId: "C1",
  slackUserId: "U1",
  threadTs: "100.1",
  messageTs: "100.1",
  eventId: "Ev1",
} as SlackEventTaskPayload;

function eventDeps(overrides: Partial<SlackEventTaskDeps>) {
  const posts: unknown[] = [];
  const deps = {
    now: () => new Date(0),
    postMessage: async (_token: string, input: { channel: string }) => {
      posts.push(input);
      return { channel: input.channel, ts: "300.1" };
    },
    updateMessage: async () => ({ channel: "C1", ts: "300.1" }),
    ...overrides,
  } as unknown as SlackEventTaskDeps;
  return { deps, posts };
}

test("opens a stream addressed to the requester in the reply thread", async () => {
  const starts: Array<Record<string, unknown>> = [];
  const { deps, posts } = eventDeps({
    startStream: async (_token, input) => {
      starts.push(input);
      return { channel: input.channel, ts: "200.1" };
    },
    appendStream: async () => {},
    stopStream: async () => {},
  });

  await openSlackConversationalReply({
    deps,
    botToken: "xoxb",
    payload,
    postThreadTs: "100.1",
    context: { userText: "hi" },
  });

  assert.equal(posts.length, 0);
  assert.equal(starts[0].thread_ts, "100.1");
  assert.equal(starts[0].recipient_user_id, "U1");
  assert.equal(starts[0].recipient_team_id, "T1");
  assert.equal(starts[0].task_display_mode, "timeline");
});

test("falls back to an edited placeholder when Slack rejects streaming", async () => {
  const { deps, posts } = eventDeps({
    startStream: async () => {
      throw new Error("Slack chat.startStream failed: invalid_thread_ts");
    },
    appendStream: async () => {},
    stopStream: async () => {},
  });

  await openSlackConversationalReply({
    deps,
    botToken: "xoxb",
    payload,
    postThreadTs: "100.1",
    context: { userText: "hi" },
  });

  assert.equal(posts.length, 1);
});

test("streaming can be switched off", async () => {
  const previous = process.env.SLACK_STREAMING_REPLIES;
  process.env.SLACK_STREAMING_REPLIES = "off";
  try {
    const { deps, posts } = eventDeps({
      startStream: async () => {
        throw new Error("must not stream");
      },
      appendStream: async () => {},
      stopStream: async () => {},
    });
    await openSlackConversationalReply({
      deps,
      botToken: "xoxb",
      payload,
      postThreadTs: "100.1",
      context: { userText: "hi" },
    });
    assert.equal(posts.length, 1);
  } finally {
    if (previous === undefined) delete process.env.SLACK_STREAMING_REPLIES;
    else process.env.SLACK_STREAMING_REPLIES = previous;
  }
});
