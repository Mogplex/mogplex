import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getSlackReplyThreadTs } from "../../trigger/slack-event-lib/channel-state";
import { getSlackConversationThreadTs } from "../../lib/slack/conversation-scope";

import { buildSlackThreadContext } from "../../trigger/slack-event-lib/thread-context";
import {
  basePayload,
  baseInstallation,
  mappedAttribution,
  agentSuccess,
  loadSlackEventTask,
  restoreFetch,
} from "./helpers/slack-event-task-fixtures";

const question = {
  teamId: "T1",
  eventId: "Ev1",
  channelId: "D1",
  channelType: "im" as const,
  eventType: "message" as const,
  threadTs: "1789231705.455829",
  messageTs: "1789232900.307699",
  slackUserId: "U1",
  text: "Why did this run fail?",
};
test("a DM thread question keeps its reply and conversation in that exact thread", () => {
  assert.equal(getSlackReplyThreadTs(question), question.threadTs);
  assert.equal(getSlackConversationThreadTs(question), question.threadTs);
});
test("ordinary DM messages share a conversation and remain top-level", () => {
  const root = { ...question, threadTs: question.messageTs };
  assert.equal(getSlackReplyThreadTs(root), undefined);
  assert.equal(getSlackConversationThreadTs(root), root.channelId);
});
after(restoreFetch);

test("hydrates a DM reply with its run card and earlier thread messages", async () => {
  const context = await buildSlackThreadContext({
    deps: {
      getThreadMessages: async (_token, input) => {
        assert.equal(input.threadTs, basePayload.threadTs);
        return [
          {
            type: "message",
            bot_id: "B1",
            ts: basePayload.threadTs,
            text: "Run failed: tool-calls. Run 4b129988",
          },
        ];
      },
      fetchAttachment: async () => {
        throw new Error("unexpected attachment");
      },
    },
    botToken: "fixture",
    payload: {
      ...basePayload,
      channelType: "im",
      messageTs: "1700000099.000100",
    },
  });
  assert.match(
    String(context.contextMessage?.content),
    /Run failed: tool-calls/
  );
});

test("a run question in a DM thread receives exact-run evidence and replies in place", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  let loaded = false;
  let posted = false;
  let answered = false;
  const result = await runSlackEventTask(
    { ...basePayload, ...question },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "fixture",
      resolveSlackAttribution: async () => mappedAttribution(),
      loadOrCreateConversation: async (input) => {
        assert.equal(input.threadTs, question.threadTs);
        return {
          id: "thread-conversation",
          user_id: "user-mogplex",
          messages: [],
          model: null,
          title: null,
        };
      },
      getThreadMessages: async () => [],
      resolveRepoContext: async () => null,
      resolveModelPreference: async () => null,
      loadThreadRunContext: async (input) => {
        assert.deepEqual(input, {
          userId: "user-mogplex",
          teamId: question.teamId,
          channelId: question.channelId,
          threadTs: question.threadTs,
          slackUserId: question.slackUserId,
        });
        loaded = true;
        return "Recorded terminal cause: Mogplex run stopped: tool-calls";
      },
      runAgent: async (input) => {
        assert.equal(loaded, true);
        assert.match(
          input.systemSuffix ?? "",
          /Recorded terminal cause: Mogplex run stopped: tool-calls/
        );
        answered = true;
        return agentSuccess({
          finalText: "The run hit its configured step limit.",
        });
      },
      postMessage: async (_token, input) => {
        assert.equal(input.thread_ts, question.threadTs);
        posted = true;
        return { channel: question.channelId, ts: "reply" };
      },
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
      persistConversation: async () => {},
    }
  );
  assert.equal(result.outcome, "conversational_reply");
  assert.equal(posted && answered, true);
});
