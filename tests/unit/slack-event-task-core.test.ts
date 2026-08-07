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
