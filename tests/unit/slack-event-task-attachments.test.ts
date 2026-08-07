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

test("fetches Slack image attachments and sends them to the conversational agent", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      text: "what does this say?",
      attachments: [
        {
          id: "F1",
          mimetype: "image/png",
          urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
          name: "screenshot.png",
          sizeBytes: 11,
        },
      ],
    },
    {
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
      persistConversation: async (input) => {
        calls.push({ op: "persist", input });
      },
      fetchAttachment: async (input) => {
        calls.push({
          op: "fetch",
          botToken: input.botToken,
          url: input.url,
          aborted: input.signal.aborted,
        });
        return new Response(Buffer.from("image-bytes"), {
          headers: { "content-length": "11" },
        });
      },
      runAgent: async (input) => {
        calls.push({ op: "agent", messages: input.messages });
        return agentSuccess({ finalText: "It says hello." });
      },
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "1700000000.000999",
      }),
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(result.attachments_attached, 1);
  assert.equal(result.attachments_dropped, 0);

  const fetchCall = calls.find((c) => c.op === "fetch") as {
    botToken: string;
    url: string;
    aborted: boolean;
  };
  assert.equal(fetchCall.botToken, "xoxb-test");
  assert.equal(fetchCall.url, "https://files.slack.com/files-pri/T-F1/png");
  assert.equal(fetchCall.aborted, false);

  const agentCall = calls.find((c) => c.op === "agent") as {
    messages: Array<{ role: string; content: unknown }>;
  };
  const userContent = agentCall.messages.at(-1)?.content;
  assert.ok(Array.isArray(userContent));
  assert.deepEqual(userContent[0], {
    type: "text",
    text: "what does this say?",
  });
  assert.deepEqual(userContent[1], {
    type: "file",
    mediaType: "image/png",
    url: `data:image/png;base64,${Buffer.from("image-bytes").toString(
      "base64"
    )}`,
    filename: "screenshot.png",
  });

  const persistCall = calls.find((c) => c.op === "persist") as {
    input: { messages: Array<{ role: string; content: unknown }> };
  };
  assert.equal(persistCall.input.messages[0]?.content, "what does this say?");
});

test("skips Slack images larger than the attachment cap", async () => {
  const { runSlackEventTask, SLACK_IMAGE_ATTACHMENT_MAX_BYTES } =
    await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await runSlackEventTask(
      {
        ...basePayload,
        text: "explain this",
        attachments: [
          {
            id: "F-big",
            mimetype: "image/jpeg",
            urlPrivateDownload: "https://files.slack.com/files-pri/T-F-big/jpg",
            name: "huge.jpg",
            sizeBytes: SLACK_IMAGE_ATTACHMENT_MAX_BYTES + 1,
          },
        ],
      },
      {
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
        fetchAttachment: async () => {
          throw new Error("should not fetch oversized files");
        },
        runAgent: async (input) => {
          calls.push({ op: "agent", messages: input.messages });
          return agentSuccess({ finalText: "Skipped." });
        },
        postMessage: async (_token, input) => ({
          channel: input.channel,
          ts: "1700000000.000999",
        }),
        updateMessage: async (_token, input) => ({
          channel: input.channel,
          ts: input.ts,
        }),
      }
    );

    assert.equal(result.attachments_attached, 0);
    assert.equal(result.attachments_dropped, 1);
    const agentCall = calls.find((c) => c.op === "agent") as {
      messages: Array<{ role: string; content: unknown }>;
    };
    assert.equal(
      agentCall.messages.at(-1)?.content,
      "explain this\n\n(image too large)"
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("continues with text when a Slack image fetch fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await runSlackEventTask(
      {
        ...basePayload,
        text: "inspect this",
        attachments: [
          {
            id: "F-fail",
            mimetype: "image/webp",
            urlPrivateDownload:
              "https://files.slack.com/files-pri/T-F-fail/webp",
            name: "broken.webp",
            sizeBytes: 100,
          },
        ],
      },
      {
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
        fetchAttachment: async () => {
          throw new Error("Slack timed out");
        },
        runAgent: async (input) => {
          calls.push({ op: "agent", messages: input.messages });
          return agentSuccess({ finalText: "I could not see it." });
        },
        postMessage: async (_token, input) => ({
          channel: input.channel,
          ts: "1700000000.000999",
        }),
        updateMessage: async (_token, input) => ({
          channel: input.channel,
          ts: input.ts,
        }),
      }
    );

    assert.equal(result.attachments_attached, 0);
    assert.equal(result.attachments_dropped, 1);
    const agentCall = calls.find((c) => c.op === "agent") as {
      messages: Array<{ role: string; content: unknown }>;
    };
    assert.equal(
      agentCall.messages.at(-1)?.content,
      "inspect this\n\n(couldn't load attached image)"
    );
  } finally {
    console.warn = originalWarn;
  }
});
