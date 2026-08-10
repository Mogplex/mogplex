import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { RunChatAgentInput } from "@/lib/agents/run-chat-agent";
import {
  getSlackThreadMessages,
  type SlackThreadMessage,
} from "@/lib/slack/client";
import { extractSlackRepoCandidates } from "@/trigger/slack-event-lib/repo-context";
import { buildSlackThreadContext } from "@/trigger/slack-event-lib/thread-context";
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

test("extracts named repositories across Slack thread replies", () => {
  assert.deepEqual(
    extractSlackRepoCandidates([
      "Please inspect mogplex/mogplex",
      "Org = Mogplex",
      "Repo = mogplex",
    ]),
    ["Mogplex/mogplex"]
  );
});

test("extracts repositories from pasted GitHub URLs without domain candidates", () => {
  assert.deepEqual(
    extractSlackRepoCandidates([
      "Review https://github.com/Mogplex/mogplex/pull/135",
      "Then inspect <https://github.com/WebRenew/other-repo.git|the repo>",
    ]),
    ["Mogplex/mogplex", "WebRenew/other-repo"]
  );
});

test("bounds Slack thread history before the current event", async () => {
  let requestUrl = "";
  const messages = await getSlackThreadMessages(
    "xoxb-test",
    {
      channel: "C1",
      threadTs: "1700000000.000100",
      latestTs: "1700000099.000100",
      limit: 200,
    },
    async (input, init) => {
      requestUrl = String(input);
      assert.equal(init?.method, "GET");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer xoxb-test"
      );
      return Response.json({ ok: true, messages: [] });
    }
  );

  const url = new URL(requestUrl);
  assert.equal(url.pathname, "/api/conversations.replies");
  assert.equal(url.searchParams.get("channel"), "C1");
  assert.equal(url.searchParams.get("ts"), "1700000000.000100");
  assert.equal(url.searchParams.get("latest"), "1700000099.000100");
  assert.equal(url.searchParams.get("inclusive"), "false");
  assert.equal(url.searchParams.get("limit"), "200");
  assert.deepEqual(messages, []);
});

test("keeps the thread root and tail of the fetched Slack page", async () => {
  const replies: SlackThreadMessage[] = Array.from(
    { length: 24 },
    (_, index) => ({
      type: "message",
      user: "UCHARLES",
      ts: `17000000${String(index + 1).padStart(2, "0")}.000100`,
      text:
        index === 4
          ? "old-context-marker"
          : index === 23
            ? "page-tail-context-marker"
            : `thread reply ${index + 1}`,
    })
  );
  replies[22] = {
    type: "message",
    user: "UBOT",
    bot_id: "BOTHER",
    ts: "1700000023.000100",
    text: "third-party-status",
  };

  const context = await buildSlackThreadContext({
    deps: {
      getThreadMessages: async () => [
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000000.000100",
          text: "root-context-marker",
        },
        ...replies,
      ],
      fetchAttachment: async () => {
        throw new Error("unexpected attachment fetch");
      },
    },
    botToken: "xoxb-test",
    payload: {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
      messageTs: "1700000099.000100",
    },
  });

  const content = context.contextMessage?.content;
  assert.equal(typeof content, "string");
  const text = content as string;
  assert.match(text, /root-context-marker/);
  assert.match(text, /page-tail-context-marker/);
  assert.match(text, /Slack bot BOTHER: third-party-status/);
  assert.doesNotMatch(text, /old-context-marker/);
  assert.equal(context.messages.length, 20);
});

test("deduplicates persisted turns without hiding them from repo resolution", async () => {
  const context = await buildSlackThreadContext({
    deps: {
      getThreadMessages: async () => [
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000000.000100",
          text: "persisted-thread-turn",
        },
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000001.000100",
          text: "new-thread-context",
        },
      ],
      fetchAttachment: async () => {
        throw new Error("unexpected attachment fetch");
      },
    },
    botToken: "xoxb-test",
    payload: {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
      messageTs: "1700000099.000100",
    },
    conversationMessages: [{ role: "user", content: "persisted-thread-turn" }],
  });

  assert.equal(typeof context.contextMessage?.content, "string");
  const content = context.contextMessage?.content as string;
  assert.doesNotMatch(content, /persisted-thread-turn/);
  assert.match(content, /new-thread-context/);
  assert.deepEqual(context.texts, [
    "persisted-thread-turn",
    "new-thread-context",
  ]);
});

test("degrades to empty context when Slack thread history is unavailable", async () => {
  const context = await buildSlackThreadContext({
    deps: {
      getThreadMessages: async () => {
        throw new Error("Slack unavailable");
      },
      fetchAttachment: async () => {
        throw new Error("unexpected attachment fetch");
      },
    },
    botToken: "xoxb-test",
    payload: {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
      messageTs: "1700000099.000100",
    },
  });

  assert.deepEqual(context, {
    messages: [],
    contextMessage: null,
    texts: [],
  });
});

test("does not fetch Slack history for DMs or a thread root event", async () => {
  let fetchCount = 0;
  const deps = {
    getThreadMessages: async () => {
      fetchCount += 1;
      return [];
    },
    fetchAttachment: async () => {
      throw new Error("unexpected attachment fetch");
    },
  };

  const dmContext = await buildSlackThreadContext({
    deps,
    botToken: "xoxb-test",
    payload: { ...basePayload, channelType: "im" },
  });
  const rootContext = await buildSlackThreadContext({
    deps,
    botToken: "xoxb-test",
    payload: {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(dmContext.contextMessage, null);
  assert.equal(rootContext.contextMessage, null);
});

test("bounds injected Slack thread text to six thousand characters", async () => {
  const firstText = `first-${"a".repeat(3_000)}`;
  const overflowText = `overflow-${"b".repeat(3_000)}`;
  const context = await buildSlackThreadContext({
    deps: {
      getThreadMessages: async () => [
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000000.000100",
          text: firstText,
        },
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000001.000100",
          text: overflowText,
        },
        {
          type: "message",
          user: "UCHARLES",
          ts: "1700000002.000100",
          text: "Mogplex/mogplex",
        },
      ],
      fetchAttachment: async () => {
        throw new Error("unexpected attachment fetch");
      },
    },
    botToken: "xoxb-test",
    payload: {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
      messageTs: "1700000099.000100",
    },
  });

  assert.equal(typeof context.contextMessage?.content, "string");
  const content = context.contextMessage?.content as string;
  assert.ok(content.includes(firstText));
  assert.ok(!content.includes(overflowText));
  assert.ok(!content.includes("Mogplex/mogplex"));
  assert.deepEqual(context.texts, [firstText, overflowText, "Mogplex/mogplex"]);
});

test("hydrates Slack thread context, prior images, and named repo scope for conversational agent tools", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let resolvedRepoTexts: string[] = [];
  const agentInputs: RunChatAgentInput[] = [];
  const operationOrder: string[] = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
      text: "<@UBOT> Org = Mogplex\nRepo = mogplex",
      messageTs: "1700000003.000100",
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => null,
      getThreadMessages: async (_token, input) => {
        operationOrder.push("thread-context");
        assert.deepEqual(input, {
          channel: "C1",
          threadTs: "1700000000.000100",
          latestTs: "1700000003.000100",
          limit: 200,
        });
        return [
          {
            type: "message",
            user: "UCHARLES",
            ts: "1700000000.000100",
            text: "<@UBOT> for repo mogplex/mogplex fix the mobile header",
            files: [
              {
                id: "F1",
                mimetype: "image/png",
                url_private_download:
                  "https://files.slack.com/files-pri/T-F1/png",
                name: "mobile-header.png",
                size: 4,
              },
            ],
          },
          {
            type: "message",
            bot_id: "BMOG",
            ts: "1700000001.000100",
            text: "_Thinking..._",
          },
          {
            type: "message",
            user: "UCHARLES",
            ts: "1700000002.000100",
            text: "Then at this section on home page at mobile we lose our side borders",
          },
          {
            type: "message",
            user: "UCHARLES",
            ts: "1700000003.000100",
            text: "Org = Mogplex\nRepo = mogplex",
          },
        ];
      },
      resolveRepoContext: async (input) => {
        resolvedRepoTexts = input.texts;
        return {
          repoId: "repo-uuid-1",
          repoFullName: "Mogplex/mogplex",
          repoOwner: "Mogplex",
          repoName: "mogplex",
          repoBaseBranch: "main",
          teamId: null,
        };
      },
      fetchAttachment: async (input) => {
        assert.equal(input.url, "https://files.slack.com/files-pri/T-F1/png");
        return new Response(Buffer.from([1, 2, 3, 4]), {
          headers: { "content-type": "image/png", "content-length": "4" },
        });
      },
      loadOrCreateConversation: async () => ({
        id: "conv-1",
        user_id: "user-mogplex",
        messages: [
          { role: "user", content: "persisted user turn" },
          { role: "assistant", content: "persisted assistant turn" },
        ],
        model: null,
        title: null,
      }),
      persistConversation: async () => undefined,
      runAgent: async (input) => {
        agentInputs.push(input);
        return agentSuccess({
          finalText: "I'll inspect the named repo and screenshots.",
        });
      },
      postMessage: async (_token, input) => {
        operationOrder.push("placeholder");
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
  const agentInput = agentInputs[0];
  assert.ok(agentInput);
  assert.equal(agentInput.repoId, "repo-uuid-1");
  assert.equal(agentInput.repoFullName, "Mogplex/mogplex");
  assert.equal(agentInput.repoOwner, "Mogplex");
  assert.equal(agentInput.repoName, "mogplex");
  assert.equal(agentInput.repoBaseBranch, "main");

  assert.equal(agentInput.messages[0]?.content, "persisted user turn");
  assert.equal(agentInput.messages[1]?.content, "persisted assistant turn");
  const contextContent = agentInput.messages.at(-2)?.content;
  assert.ok(Array.isArray(contextContent));
  assert.equal(contextContent[0].type, "text");
  assert.match(contextContent[0].text, /Prior Slack thread messages/);
  assert.match(contextContent[0].text, /mobile header/);
  assert.match(contextContent[0].text, /side borders/);
  assert.doesNotMatch(contextContent[0].text, /Thinking/);
  assert.deepEqual(contextContent[1], {
    type: "file",
    mediaType: "image/png",
    url: "data:image/png;base64,AQIDBA==",
    filename: "mobile-header.png",
  });
  assert.ok(
    resolvedRepoTexts.some((text) => text.includes("mogplex/mogplex")),
    "repo resolver should see prior Slack thread text, not only the latest reply"
  );
  assert.ok(
    operationOrder.indexOf("placeholder") <
      operationOrder.indexOf("thread-context"),
    "the user-visible placeholder should be posted before thread hydration"
  );
});

test("updates the Slack placeholder when repository resolution fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const updates: string[] = [];

  await assert.rejects(
    runSlackEventTask(
      {
        ...basePayload,
        channelType: "channel",
        eventType: "app_mention",
        messageTs: "1700000003.000100",
      },
      {
        getInstallation: async () => baseInstallation,
        getBotToken: async () => "xoxb-test",
        resolveSlackAttribution: async () => mappedAttribution(),
        getChannelLink: async () => null,
        getThreadMessages: async () => [],
        resolveRepoContext: async () => {
          throw new Error("repository lookup failed");
        },
        loadOrCreateConversation: async () => ({
          id: "conv-1",
          user_id: "user-mogplex",
          messages: [],
          model: null,
          title: null,
        }),
        runAgent: async () => {
          throw new Error("agent should not run");
        },
        postMessage: async (_token, input) => ({
          channel: input.channel,
          ts: "1700000000.000999",
        }),
        updateMessage: async (_token, input) => {
          updates.push(input.text);
          return { channel: input.channel, ts: input.ts };
        },
      }
    ),
    /repository lookup failed/
  );

  assert.equal(updates.length, 1);
  assert.match(updates[0], /hit an error while responding/);
});
