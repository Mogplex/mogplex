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
