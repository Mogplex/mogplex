import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { RunChatAgentInput } from "@/lib/agents/run-chat-agent";
import { extractSlackRepoCandidates } from "@/trigger/slack-event-lib/repo-context";
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
    ["mogplex/mogplex"]
  );
});

test("hydrates Slack thread context, prior images, and named repo scope for conversational agent tools", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let resolvedRepoTexts: string[] = [];
  const agentInputs: RunChatAgentInput[] = [];

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
      getThreadMessages: async () => [
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
      ],
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
        messages: [],
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
  const agentInput = agentInputs[0];
  assert.ok(agentInput);
  assert.equal(agentInput.repoId, "repo-uuid-1");
  assert.equal(agentInput.repoFullName, "Mogplex/mogplex");
  assert.equal(agentInput.repoOwner, "Mogplex");
  assert.equal(agentInput.repoName, "mogplex");
  assert.equal(agentInput.repoBaseBranch, "main");

  const contextContent = agentInput.messages[0]?.content;
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
});
