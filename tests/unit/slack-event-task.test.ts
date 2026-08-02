import assert from "node:assert/strict";
import test, { after } from "node:test";
import { DEFAULT_MESSAGE_WINDOW } from "../../lib/agents/message-window";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("should not fetch in this test");
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

async function loadSlackEventTask() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../trigger/slack-event");
}

type AgentResult = {
  finalText: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stepCount: number;
};

type Installation = {
  id: string;
  team_id: string;
  team_name: string | null;
  installed_by_user_id: string;
  bot_user_id: string;
  vault_bot_token_id: string;
  scopes: string[];
  authed_user_slack_id: string | null;
  created_at: string;
  updated_at: string;
};

const baseInstallation: Installation = {
  id: "install-1",
  team_id: "T1",
  team_name: "Mogplex",
  installed_by_user_id: "installer-user",
  bot_user_id: "UBOT",
  vault_bot_token_id: "vault-secret-1",
  scopes: ["chat:write", "app_mentions:read"],
  authed_user_slack_id: "USLACK-INSTALLER",
  created_at: "2026-05-11T00:00:00Z",
  updated_at: "2026-05-11T00:00:00Z",
};

const mappedAttribution = (
  mogplexUserId = "user-mogplex",
  slackEmail: string | null = "user@example.com",
  githubUsername?: string | null
) => ({
  mode: "mapped_profile" as const,
  mogplexUserId,
  slackEmail,
  ...(githubUsername === undefined ? {} : { githubUsername }),
});

const installerFallbackAttribution = (
  mogplexUserId = "installer-user",
  slackEmail: string | null = "installer@example.com"
) => ({
  mode: "installer_fallback" as const,
  mogplexUserId,
  slackEmail,
});

const basePayload = {
  teamId: "T1",
  eventId: "Ev123",
  channelId: "C1",
  threadTs: "1700000000.000100",
  messageTs: "1700000000.000100",
  slackUserId: "USLACK",
  text: "<@UBOT> what's the build status?",
  channelType: "im" as const,
  eventType: "message" as const,
};

const fixedNow = new Date("2026-05-13T12:00:00.000Z");
const fixedMonthStartDate = "2026-05-01";

const agentSuccess = (overrides: Partial<AgentResult> = {}): AgentResult => ({
  finalText: "Build is green ✅",
  finishReason: "stop",
  inputTokens: 100,
  outputTokens: 25,
  totalTokens: 125,
  stepCount: 1,
  ...overrides,
});

test("builds Slack tool scopes only from complete event identities", async () => {
  const { buildSlackToolExecutionIdempotencyKey } = await loadSlackEventTask();

  assert.equal(
    buildSlackToolExecutionIdempotencyKey({
      teamId: " T1 ",
      eventId: " Ev123 ",
    }),
    "slack:T1:Ev123"
  );
  assert.equal(
    buildSlackToolExecutionIdempotencyKey({
      teamId: "T1",
      eventId: undefined,
    } as never),
    null
  );
  assert.equal(
    buildSlackToolExecutionIdempotencyKey({
      teamId: " ",
      eventId: "Ev123",
    }),
    null
  );
});

test("returns unknown_workspace when the team isn't installed", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => null,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    loadOrCreateConversation: async () => {
      throw new Error("should not be called");
    },
    persistConversation: async () => undefined,
    runAgent: async () => agentSuccess(),
    postMessage: async () => ({
      channel: "C1",
      ts: "1700000000.000200",
    }),
    updateMessage: async () => ({
      channel: "C1",
      ts: "1700000000.000200",
    }),
  });

  assert.deepEqual(result, { outcome: "unknown_workspace" });
});

test("ignores events authored by the bot itself", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const result = await runSlackEventTask(
    { ...basePayload, slackUserId: "UBOT" },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => {
        throw new Error("should not be called");
      },
      loadOrCreateConversation: async () => {
        throw new Error("should not be called");
      },
      persistConversation: async () => undefined,
      runAgent: async () => agentSuccess(),
      postMessage: async () => {
        throw new Error("should not post when ignoring self");
      },
      updateMessage: async () => {
        throw new Error("should not update when ignoring self");
      },
    }
  );

  assert.deepEqual(result, { outcome: "ignored_self_message" });
});

test("skips messages whose text is only a mention", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const result = await runSlackEventTask(
    { ...basePayload, text: "<@UBOT>" },
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
      runAgent: async () => agentSuccess(),
      postMessage: async () => {
        throw new Error("should not post for empty text");
      },
      updateMessage: async () => {
        throw new Error("should not update for empty text");
      },
    }
  );

  assert.equal(result.outcome, "skipped_empty_text");
});

test("skips messages whose text is only a display-name mention", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const result = await runSlackEventTask(
    { ...basePayload, text: "<@UBOT|Mogplex>" },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      loadOrCreateConversation: async () => {
        throw new Error("should not load for empty text");
      },
      persistConversation: async () => undefined,
      runAgent: async () => agentSuccess(),
      postMessage: async () => {
        throw new Error("should not post for empty text");
      },
      updateMessage: async () => {
        throw new Error("should not update for empty text");
      },
    }
  );

  assert.equal(result.outcome, "skipped_empty_text");
});

test("ignores messages from Slack users that do not map to a Mogplex profile", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const posted: Array<{ text: string }> = [];
  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => ({
      mode: "unmapped",
      mogplexUserId: null,
      slackEmail: null,
    }),
    loadOrCreateConversation: async () => {
      throw new Error("should not load for unmapped users");
    },
    persistConversation: async () => undefined,
    runAgent: async () => agentSuccess(),
    postMessage: async (_token, input) => {
      posted.push({ text: input.text });
      return { channel: input.channel, ts: "1700000000.000200" };
    },
    postEphemeral: async () => {
      throw new Error("should not post ephemeral for DM link notices");
    },
    updateMessage: async () => {
      throw new Error("should not update for unmapped users");
    },
    createUserLinkToken: async () => ({
      token: "link-token",
      expiresAt: "2026-05-13T12:15:00.000Z",
    }),
    buildSlackLinkUrl: (token) =>
      `https://example.test/slack/link?token=${token}`,
  });

  assert.deepEqual(result, {
    outcome: "ignored_no_mogplex_user",
    mogplexUserId: null,
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /https:\/\/example\.test\/slack\/link/);
});

test("posts an ephemeral link notice for unmapped channel mentions", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const ephemerals: Array<{ user: string; threadTs?: string; text: string }> =
    [];
  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => ({
        mode: "legacy_email",
        mogplexUserId: null,
        slackEmail: "user@example.com",
      }),
      loadOrCreateConversation: async () => {
        throw new Error("should not load for unmapped users");
      },
      persistConversation: async () => undefined,
      runAgent: async () => agentSuccess(),
      postMessage: async () => {
        throw new Error("should not post visible channel link notices");
      },
      postEphemeral: async (_token, input) => {
        ephemerals.push({
          user: input.user,
          threadTs: input.thread_ts,
          text: input.text,
        });
        return { message_ts: "1700000000.000200" };
      },
      updateMessage: async () => {
        throw new Error("should not update for unmapped users");
      },
      createUserLinkToken: async () => ({
        token: "link-token",
        expiresAt: "2026-05-13T12:15:00.000Z",
      }),
      buildSlackLinkUrl: (token) =>
        `https://example.test/slack/link?token=${token}`,
    }
  );

  assert.equal(result.outcome, "ignored_no_mogplex_user");
  assert.deepEqual(ephemerals, [
    {
      user: "USLACK",
      threadTs: undefined,
      text: ":lock: I found a Mogplex account with your Slack email, but you still need to explicitly link Slack before I can act for you: https://example.test/slack/link?token=link-token",
    },
  ]);
});

test("skips a link notice when token creation is suppressed", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const result = await runSlackEventTask(basePayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => ({
      mode: "unmapped",
      mogplexUserId: null,
      slackEmail: null,
    }),
    loadOrCreateConversation: async () => {
      throw new Error("should not load for unmapped users");
    },
    persistConversation: async () => undefined,
    runAgent: async () => agentSuccess(),
    postMessage: async () => {
      throw new Error("should not post when a link notice is already active");
    },
    postEphemeral: async () => {
      throw new Error("should not post when a link notice is already active");
    },
    updateMessage: async () => {
      throw new Error("should not update for unmapped users");
    },
    createUserLinkToken: async () => null,
  });

  assert.deepEqual(result, {
    outcome: "ignored_no_mogplex_user",
    mogplexUserId: null,
  });
});

test("posts a visible DM placeholder, runs the agent, and finalises the reply", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

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
        onTextDelta: input.onTextDelta,
        toolExecutionIdempotencyKey: input.toolExecutionIdempotencyKey,
      });
      return agentSuccess({ finalText: "Build is green ✅" });
    },
    postMessage: async (_token, input) => {
      calls.push({ op: "post", input });
      return { channel: input.channel, ts: "1700000000.000999" };
    },
    updateMessage: async (_token, input) => {
      calls.push({ op: "update", input });
      return { channel: input.channel, ts: input.ts };
    },
  });

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(result.conversationId, "conv-1");
  assert.equal(result.mogplexUserId, "user-mogplex");

  const placeholderPost = calls.find((c) => c.op === "post") as {
    input: { channel: string; thread_ts?: string; text: string };
  };
  assert.equal(placeholderPost.input.channel, "C1");
  assert.equal(placeholderPost.input.thread_ts, undefined);
  // Placeholder is non-empty (Slack rejects empty text).
  assert.ok(placeholderPost.input.text.length > 0);

  const agentCall = calls.find((c) => c.op === "agent") as {
    userId: string;
    conversationId: string;
    messages: Array<{ role: string; content: unknown }>;
    onTextDelta?: unknown;
    toolExecutionIdempotencyKey?: string;
  };
  assert.equal(agentCall.userId, "user-mogplex");
  assert.equal(agentCall.conversationId, "conv-1");
  assert.equal(
    agentCall.toolExecutionIdempotencyKey,
    "slack:T1:Ev123",
    "Slack retries must reuse the same tool-execution scope"
  );
  assert.equal(
    agentCall.onTextDelta,
    undefined,
    "Slack conversational replies should not stream partial model text"
  );
  // Includes prior history plus the new user turn (with mention stripped).
  assert.equal(agentCall.messages.length, 3);
  assert.equal(agentCall.messages[2].role, "user");
  assert.equal(agentCall.messages[2].content, "what's the build status?");

  const finalUpdate = calls.findLast((c) => c.op === "update") as {
    input: { channel: string; ts: string; text: string };
  };
  assert.equal(
    calls.filter((c) => c.op === "update").length,
    1,
    "only the final answer should edit the Slack placeholder"
  );
  assert.equal(finalUpdate.input.ts, "1700000000.000999");
  assert.equal(finalUpdate.input.text, "Build is green ✅");

  const persistCall = calls.find((c) => c.op === "persist") as {
    input: {
      conversationId: string;
      userId: string;
      messages: Array<{ role: string; content: unknown }>;
    };
  };
  assert.equal(persistCall.input.conversationId, "conv-1");
  assert.equal(persistCall.input.userId, "user-mogplex");
  // Persisted history = prior + user + assistant.
  assert.equal(persistCall.input.messages.length, 4);
  assert.equal(persistCall.input.messages[3].role, "assistant");
  assert.equal(persistCall.input.messages[3].content, "Build is green ✅");
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

test("windows a long thread history before passing it to the agent", async () => {
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

  // The agent only sees the trailing window (+1 for the new user turn cap).
  assert.equal(agentMessages.length, DEFAULT_MESSAGE_WINDOW);
  assert.equal(agentMessages.at(-1)?.content, "what's the build status?");
  // Full history is still persisted: 200 prior + user + assistant.
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

  // The error path should update the placeholder with a user-visible notice
  // before propagating so the user sees Slack-side feedback.
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

test("routes app_mention in a linked channel through the repo-agent branch", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
      text: "<@UBOT> fix the failing test in repo",
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      loadOrCreateConversation: async () => {
        throw new Error("conversation should not load in repo-agent mode");
      },
      persistConversation: async () => undefined,
      runAgent: async () => {
        throw new Error("agent should not run in repo-agent mode");
      },
      startRepoAgentRun: async (input) => {
        calls.push({ op: "start_run", input });
        return { runId: "run-abc-123" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
      updateMessage: async (_token, input) => {
        calls.push({ op: "update", input });
        return { channel: input.channel, ts: input.ts };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(result.runId, "run-abc-123");
  assert.equal(result.attachments_attached, 0);
  assert.equal(result.attachments_dropped, 0);

  const startCall = calls.find((c) => c.op === "start_run") as {
    input: {
      mogplexUserId: string;
      repoId: string;
      prompt: string;
      idempotencyKey: string;
      slackMessage?: {
        teamId: string;
        channelId: string;
        messageTs: string;
      };
      slackContext: {
        mode: string;
        teamId: string;
        installationId: string;
        channelId: string;
        slackUserId: string;
        slackEmail: string | null;
        attributionMode: string;
      };
    };
  };
  assert.equal(startCall.input.mogplexUserId, "user-mogplex");
  assert.equal(startCall.input.repoId, "repo-uuid-1");
  assert.equal(startCall.input.prompt, "fix the failing test in repo");
  assert.equal(startCall.input.idempotencyKey, "slack:Ev123");
  assert.deepEqual(startCall.input.slackContext, {
    mode: "repo_agent",
    teamId: "T1",
    installationId: "install-1",
    channelId: "C1",
    slackUserId: "USLACK",
    slackEmail: "user@example.com",
    attributionMode: "mapped_profile",
  });
  // The "Cancel run" message coordinates are threaded into the run so the
  // completion hook can strip the button later (issue #398).
  assert.deepEqual(startCall.input.slackMessage, {
    teamId: "T1",
    channelId: "C1",
    messageTs: "1700000000.000999",
  });

  const placeholderPost = calls.find((c) => c.op === "post") as {
    input: { channel: string; thread_ts?: string; text: string };
  };
  assert.equal(placeholderPost.input.channel, "C1");
  assert.equal(placeholderPost.input.thread_ts, "1700000000.000100");
  assert.match(placeholderPost.input.text, /Starting repo agent run/);

  const finalUpdate = calls.findLast((c) => c.op === "update") as {
    input: { text: string };
  };
  assert.match(finalUpdate.input.text, /run-abc-123/);
  assert.match(
    finalUpdate.input.text,
    /https:\/\/example\.test\/runs\/run-abc-123/
  );
});

test("passes Slack image-only app_mention events to linked repo agents", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
      text: "<@UBOT>",
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
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      loadOrCreateConversation: async () => {
        throw new Error("conversation should not load in repo-agent mode");
      },
      persistConversation: async () => undefined,
      fetchAttachment: async () => {
        throw new Error("repo-agent mode should not fetch images in Trigger");
      },
      runAgent: async () => {
        throw new Error("agent should not run in repo-agent mode");
      },
      startRepoAgentRun: async (input) => {
        calls.push({ op: "start_run", input });
        return { runId: "run-image-123" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
      updateMessage: async (_token, input) => {
        calls.push({ op: "update", input });
        return { channel: input.channel, ts: input.ts };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(result.runId, "run-image-123");
  assert.equal(result.attachments_attached, 1);
  assert.equal(result.attachments_dropped, 0);

  const startCall = calls.find((c) => c.op === "start_run") as {
    input: {
      prompt: string;
      slackAttachments?: Array<{
        id: string;
        mimetype: string;
        urlPrivateDownload: string;
        name?: string;
        sizeBytes?: number;
      }>;
    };
  };
  assert.match(startCall.input.prompt, /attached Slack image/);
  assert.deepEqual(startCall.input.slackAttachments, [
    {
      id: "F1",
      mimetype: "image/png",
      urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
      name: "screenshot.png",
      sizeBytes: 11,
    },
  ]);

  const placeholderPost = calls.find((c) => c.op === "post") as {
    input: { thread_ts?: string };
  };
  assert.equal(placeholderPost.input.thread_ts, "1700000000.000100");
});

test("passes installer-fallback Slack attribution through repo-agent metadata", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const startedContexts: Array<{
    attributionMode?: string;
    slackUserId?: string;
  }> = [];
  const reservations: Array<{
    installationId: string;
    teamId: string;
    eventId: string;
    monthStartDate: string;
    monthlyLimit: number;
  }> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        monthly_repo_run_limit: 5,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => installerFallbackAttribution(),
      now: () => fixedNow,
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      startRepoAgentRun: async (input) => {
        startedContexts.push(input.slackContext);
        return { runId: "run-fallback-123" };
      },
      reserveSlackRepoAgentMonthlyRun: async (input) => {
        reservations.push(input);
        return true;
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
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

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(result.mogplexUserId, "installer-user");
  assert.equal(result.attachments_attached, 0);
  assert.equal(result.attachments_dropped, 0);
  const startedContext = startedContexts[0];
  assert.ok(startedContext);
  assert.equal(startedContext.attributionMode, "installer_fallback");
  assert.equal(startedContext.slackUserId, "USLACK");
  assert.equal(reservations.length, 1);
  assert.deepEqual(
    {
      installationId: reservations[0]?.installationId,
      teamId: reservations[0]?.teamId,
      eventId: reservations[0]?.eventId,
      monthlyLimit: reservations[0]?.monthlyLimit,
    },
    {
      installationId: "install-1",
      teamId: "T1",
      eventId: "Ev123",
      monthlyLimit: 5,
    }
  );
  assert.equal(reservations[0]?.monthStartDate, fixedMonthStartDate);
});

test("blocks repo-agent runs when the Slack workspace disables them", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        repo_agent_enabled: false,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      startRepoAgentRun: async () => {
        throw new Error("should not start a disabled workspace run");
      },
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_disabled");
  const denial = calls.find((call) => call.op === "post") as {
    input: { text: string };
  };
  assert.match(denial.input.text, /disabled/i);
});

test("treats null repo-agent enablement as default-on for older installation rows", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let startedRun = false;
  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        repo_agent_enabled: null,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      startRepoAgentRun: async () => {
        startedRun = true;
        return { runId: "run-1" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
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

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(startedRun, true);
});

test("blocks repo-agent runs for Slack users outside the workspace allowlist", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let countedRuns = false;
  let startedRun = false;
  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        allowed_slack_user_ids: ["UOTHER"],
        monthly_repo_run_limit: 5,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => installerFallbackAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      reserveSlackRepoAgentMonthlyRun: async () => {
        countedRuns = true;
        return true;
      },
      startRepoAgentRun: async () => {
        startedRun = true;
        return { runId: "should-not-start" };
      },
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_user_not_allowed");
  assert.equal(countedRuns, false);
  assert.equal(startedRun, false);
  const denial = calls.find((call) => call.op === "post") as {
    input: { text: string };
  };
  assert.match(denial.input.text, /not allowed/i);
});

test("blocks repo-agent runs when the workspace allowlist is explicitly empty", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let startedRun = false;
  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        allowed_slack_user_ids: [],
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => installerFallbackAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      startRepoAgentRun: async () => {
        startedRun = true;
        return { runId: "should-not-start" };
      },
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "1700000000.000999",
      }),
    }
  );

  assert.equal(result.outcome, "repo_agent_user_not_allowed");
  assert.equal(startedRun, false);
});

test("blocks repo-agent runs when the Slack workspace monthly limit is reached", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let startedRun = false;
  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        monthly_repo_run_limit: 2,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      reserveSlackRepoAgentMonthlyRun: async () => false,
      startRepoAgentRun: async () => {
        startedRun = true;
        return { runId: "should-not-start" };
      },
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_monthly_limit_reached");
  assert.equal(startedRun, false);
  const denial = calls.find((call) => call.op === "post") as {
    input: { text: string };
  };
  assert.match(denial.input.text, /monthly/i);
});

test("preserves the original repo-agent error when the Slack error update fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const releasedReservations: Array<{
    teamId: string;
    eventId: string;
    monthStartDate: string;
  }> = [];

  await assert.rejects(
    () =>
      runSlackEventTask(
        {
          ...basePayload,
          channelType: "channel" as const,
          eventType: "app_mention" as const,
        },
        {
          getInstallation: async () => ({
            ...baseInstallation,
            monthly_repo_run_limit: 2,
          }),
          getBotToken: async () => "xoxb-test",
          resolveSlackAttribution: async () => mappedAttribution(),
          now: () => fixedNow,
          getChannelLink: async () => ({
            id: "link-1",
            slack_installation_id: baseInstallation.id,
            channel_id: "C1",
            channel_name: "ops",
            repo_id: "repo-uuid-1",
            created_by_user_id: "installer-user",
            created_at: "2026-05-11T00:00:00Z",
          }),
          loadOrCreateConversation: async () => {
            throw new Error("conversation should not load in repo-agent mode");
          },
          persistConversation: async () => undefined,
          runAgent: async () => {
            throw new Error("agent should not run in repo-agent mode");
          },
          startRepoAgentRun: async () => {
            throw new Error("run queue unavailable");
          },
          reserveSlackRepoAgentMonthlyRun: async () => true,
          releaseSlackRepoAgentMonthlyRun: async (input) => {
            releasedReservations.push(input);
          },
          buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
          postMessage: async (_token, input) => ({
            channel: input.channel,
            ts: "1700000000.000999",
          }),
          updateMessage: async () => {
            throw new Error("slack update failed");
          },
        }
      ),
    /run queue unavailable/
  );

  assert.equal(releasedReservations.length, 1);
  assert.deepEqual(
    {
      teamId: releasedReservations[0]?.teamId,
      eventId: releasedReservations[0]?.eventId,
    },
    { teamId: "T1", eventId: "Ev123" }
  );
  assert.equal(releasedReservations[0]?.monthStartDate, fixedMonthStartDate);
});

test("releases repo-agent quota when the placeholder post fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const releasedReservations: Array<{
    teamId: string;
    eventId: string;
    monthStartDate: string;
  }> = [];
  let startedRun = false;

  await assert.rejects(
    () =>
      runSlackEventTask(
        {
          ...basePayload,
          channelType: "channel" as const,
          eventType: "app_mention" as const,
        },
        {
          getInstallation: async () => ({
            ...baseInstallation,
            monthly_repo_run_limit: 2,
          }),
          getBotToken: async () => "xoxb-test",
          resolveSlackAttribution: async () => mappedAttribution(),
          now: () => fixedNow,
          getChannelLink: async () => ({
            id: "link-1",
            slack_installation_id: baseInstallation.id,
            channel_id: "C1",
            channel_name: "ops",
            repo_id: "repo-uuid-1",
            created_by_user_id: "installer-user",
            created_at: "2026-05-11T00:00:00Z",
          }),
          startRepoAgentRun: async () => {
            startedRun = true;
            return { runId: "should-not-start" };
          },
          reserveSlackRepoAgentMonthlyRun: async () => true,
          releaseSlackRepoAgentMonthlyRun: async (input) => {
            releasedReservations.push(input);
          },
          buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
          postMessage: async () => {
            throw new Error("slack post failed");
          },
          updateMessage: async () => {
            throw new Error("should not be called");
          },
        }
      ),
    /slack post failed/
  );

  assert.equal(startedRun, false);
  assert.deepEqual(releasedReservations, [
    {
      teamId: "T1",
      eventId: "Ev123",
      monthStartDate: fixedMonthStartDate,
    },
  ]);
});

test("falls back to conversational mode when the channel isn't linked", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let agentCalled = false;
  let runStarted = false;
  let postedThreadTs: string | undefined;
  let systemSuffix: string | null | undefined;

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () =>
        mappedAttribution("user-mogplex", "user@example.com", "charlesrhoward"),
      getChannelLink: async () => null,
      loadOrCreateConversation: async () => ({
        id: "conv-2",
        user_id: "user-mogplex",
        messages: [],
        model: null,
        title: null,
      }),
      persistConversation: async () => undefined,
      runAgent: async (input) => {
        agentCalled = true;
        systemSuffix = input.systemSuffix;
        return agentSuccess({ finalText: "OK" });
      },
      startRepoAgentRun: async () => {
        runStarted = true;
        return { runId: "should-not-happen" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => {
        postedThreadTs = input.thread_ts;
        return {
          channel: input.channel,
          ts: "1700000000.000999",
        };
      },
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(agentCalled, true);
  assert.equal(runStarted, false);
  assert.equal(postedThreadTs, "1700000000.000100");
  assert.match(systemSuffix ?? "", /not linked to a Mogplex repository/);
  assert.match(systemSuffix ?? "", /GitHub username "charlesrhoward"/);
  assert.match(systemSuffix ?? "", /Do not say "No active repo selected"/);
  assert.match(systemSuffix ?? "", /authenticated GitHub PR search/);
  assert.match(
    systemSuffix ?? "",
    /do not add a generic public\/private repo caveat/i
  );
  assert.match(systemSuffix ?? "", /authenticated GitHub issue creation/);
  assert.match(systemSuffix ?? "", /Never claim GitHub is read-only/);
  assert.match(systemSuffix ?? "", /Use Slack mrkdwn/);
  assert.match(systemSuffix ?? "", /Do not narrate hidden reasoning/);
});

test("continues bound channel thread replies without a fresh app mention", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let getChannelLinkCalled = false;
  let postedThreadTs: string | undefined;
  let agentMessages: Array<{ role: string; content: unknown }> = [];
  let systemSuffix: string | null | undefined;

  const result = await runSlackEventTask(
    {
      ...basePayload,
      eventType: "message" as const,
      channelType: "channel" as const,
      text: "confirmed. execute",
      messageTs: "1700000001.000100",
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => {
        getChannelLinkCalled = true;
        return null;
      },
      loadOrCreateConversation: async (input) => {
        assert.equal(input.requireExisting, true);
        return {
          id: "conv-thread",
          user_id: "user-mogplex",
          messages: [
            { role: "assistant", content: "Send confirmation to run." },
          ],
          model: null,
          title: null,
        };
      },
      persistConversation: async () => undefined,
      runAgent: async (input) => {
        agentMessages = input.messages;
        systemSuffix = input.systemSuffix;
        return agentSuccess({ finalText: "Running it now." });
      },
      postMessage: async (_token, input) => {
        postedThreadTs = input.thread_ts;
        return {
          channel: input.channel,
          ts: "1700000001.000999",
        };
      },
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(getChannelLinkCalled, false);
  assert.equal(postedThreadTs, "1700000000.000100");
  assert.equal(agentMessages.at(-1)?.content, "confirmed. execute");
  assert.match(
    systemSuffix ?? "",
    /continuing an existing Mogplex conversation/
  );
  assert.doesNotMatch(systemSuffix ?? "", /may not have repository context/);
  assert.match(systemSuffix ?? "", /treat that as approval/);
  assert.match(systemSuffix ?? "", /Ask at most one blocking question/);
});

test("ignores unbound channel thread replies without posting or fetching attachments", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const result = await runSlackEventTask(
    {
      ...basePayload,
      eventType: "message" as const,
      channelType: "channel" as const,
      text: "random thread reply",
      messageTs: "1700000001.000100",
      attachments: [
        {
          id: "F1",
          mimetype: "image/png",
          urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
        },
      ],
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      loadOrCreateConversation: async (input) => {
        assert.equal(input.requireExisting, true);
        return null;
      },
      persistConversation: async () => {
        throw new Error("should not persist unbound thread messages");
      },
      runAgent: async () => {
        throw new Error("should not run agent for unbound thread messages");
      },
      fetchAttachment: async () => {
        throw new Error("should not fetch attachments for unbound messages");
      },
      postMessage: async () => {
        throw new Error("should not post for unbound thread messages");
      },
      updateMessage: async () => {
        throw new Error("should not update for unbound thread messages");
      },
    }
  );

  assert.deepEqual(result, {
    outcome: "ignored_unbound_thread_message",
    mogplexUserId: "user-mogplex",
  });
});

test("starts an MPIM conversation when Mogplex is mentioned", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let postedThreadTs: string | undefined;
  let systemSuffix: string | null | undefined;

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "mpim" as const,
      eventType: "message" as const,
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => {
        throw new Error("should not lookup channel links for message events");
      },
      loadOrCreateConversation: async (input) => {
        assert.equal(input.requireExisting, false);
        return {
          id: "conv-mpim",
          user_id: "user-mogplex",
          messages: [],
          model: null,
          title: null,
        };
      },
      persistConversation: async () => undefined,
      runAgent: async (input) => {
        systemSuffix = input.systemSuffix;
        return agentSuccess({ finalText: "OK" });
      },
      postMessage: async (_token, input) => {
        postedThreadTs = input.thread_ts;
        return {
          channel: input.channel,
          ts: "1700000000.000999",
        };
      },
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(postedThreadTs, basePayload.threadTs);
  assert.match(systemSuffix ?? "", /Slack direct or group message/);
});

test("ignores unmentioned MPIM messages outside a Mogplex thread", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "mpim" as const,
      eventType: "message" as const,
      text: "What does <@UOTHER> think?",
    },
    {
      getInstallation: async () => baseInstallation,
      loadBoundConversation: async () => null,
      getBotToken: async () => {
        throw new Error("should not load a bot token for uninvoked messages");
      },
      resolveSlackAttribution: async () => {
        throw new Error("should not attribute uninvoked messages");
      },
      runAgent: async () => {
        throw new Error("should not run agent for uninvoked messages");
      },
      postMessage: async () => {
        throw new Error("should not post for uninvoked messages");
      },
    }
  );

  assert.deepEqual(result, {
    outcome: "ignored_uninvoked_group_message",
  });
});

test("keeps unmentioned MPIM replies inside an invoked Mogplex thread", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let postedThreadTs: string | undefined;
  const boundConversation = {
    id: "conv-mpim-thread",
    user_id: "user-mogplex",
    messages: [{ role: "assistant" as const, content: "What else?" }],
    model: null,
    title: null,
  };

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "mpim" as const,
      eventType: "message" as const,
      text: "Check the test output too.",
      messageTs: "1700000001.000100",
    },
    {
      getInstallation: async () => baseInstallation,
      loadBoundConversation: async (input) => {
        assert.deepEqual(input, {
          installationId: baseInstallation.id,
          channelId: basePayload.channelId,
          threadTs: basePayload.threadTs,
        });
        return boundConversation;
      },
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => {
        throw new Error("should not lookup channel links for message events");
      },
      loadOrCreateConversation: async () => {
        throw new Error("should reuse the bound MPIM conversation");
      },
      persistConversation: async () => undefined,
      runAgent: async () => agentSuccess({ finalText: "OK" }),
      postMessage: async (_token, input) => {
        postedThreadTs = input.thread_ts;
        return {
          channel: input.channel,
          ts: "1700000001.000999",
        };
      },
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(postedThreadTs, "1700000000.000100");
});

for (const channelType of ["group"] as const) {
  test(`threads conversational placeholders in ${channelType} Slack events`, async () => {
    const { runSlackEventTask } = await loadSlackEventTask();

    let postedThreadTs: string | undefined;

    const result = await runSlackEventTask(
      {
        ...basePayload,
        channelType,
        eventType: "message" as const,
      },
      {
        getInstallation: async () => baseInstallation,
        getBotToken: async () => "xoxb-test",
        resolveSlackAttribution: async () => mappedAttribution(),
        getChannelLink: async () => {
          throw new Error("should not lookup channel links for message events");
        },
        loadOrCreateConversation: async () => ({
          id: `conv-${channelType}`,
          user_id: "user-mogplex",
          messages: [],
          model: null,
          title: null,
        }),
        persistConversation: async () => undefined,
        runAgent: async () => agentSuccess({ finalText: "OK" }),
        postMessage: async (_token, input) => {
          postedThreadTs = input.thread_ts;
          return {
            channel: input.channel,
            ts: "1700000000.000999",
          };
        },
        updateMessage: async (_token, input) => ({
          channel: input.channel,
          ts: input.ts,
        }),
      }
    );

    assert.equal(result.outcome, "conversational_reply");
    assert.equal(postedThreadTs, "1700000000.000100");
  });
}

test("createDebouncedSlackUpdater coalesces rapid updates within the interval", async () => {
  const { createDebouncedSlackUpdater } = await loadSlackEventTask();

  const sentTexts: string[] = [];
  let now = 1_700_000_000_000;
  const push = createDebouncedSlackUpdater({
    botToken: "xoxb",
    channel: "C",
    ts: "T",
    updateMessage: async (_token, input) => {
      sentTexts.push(input.text);
      return { channel: input.channel, ts: input.ts };
    },
    minIntervalMs: 1_000,
    now: () => now,
  });

  // First call should fire immediately because lastSentAt = 0.
  await push("step 1");
  await sleep(0);
  assert.deepEqual(sentTexts, ["step 1"]);

  // Same content — skipped.
  await push("step 1");
  assert.equal(sentTexts.length, 1);

  // Different content but within the interval — skipped.
  await push("step 2");
  assert.equal(sentTexts.length, 1);

  // Advance past the interval — next push goes through.
  now += 1_500;
  await push("step 3");
  await sleep(0);
  assert.deepEqual(sentTexts, ["step 1", "step 3"]);
});

test("createDebouncedSlackUpdater flush waits for an in-flight update", async () => {
  const { createDebouncedSlackUpdater } = await loadSlackEventTask();

  const updateGate: { release?: () => void } = {};
  const sentTexts: string[] = [];
  const push = createDebouncedSlackUpdater({
    botToken: "xoxb",
    channel: "C",
    ts: "T",
    updateMessage: async (_token, input) => {
      await new Promise<void>((resolve) => {
        updateGate.release = resolve;
      });
      sentTexts.push(input.text);
      return { channel: input.channel, ts: input.ts };
    },
    minIntervalMs: 1,
    now: () => 1_700_000_000_000,
  });

  await push("partial");
  const flushed = push.flush();
  await sleep(0);
  assert.deepEqual(sentTexts, []);
  assert.ok(updateGate.release);
  updateGate.release();
  await flushed;
  assert.deepEqual(sentTexts, ["partial"]);
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
