import { getSlackBotToken, updateSlackMessage } from "@/lib/slack/client";
import { fitSlackMessageText } from "@/lib/slack/format";
import type { RunChatAgentProgressEvent } from "@/lib/agents/run-chat-progress";
import {
  buildSlackRequestStatus,
  SLACK_REQUEST_MESSAGE_KEY,
} from "@/lib/slack/request-presentation";
import {
  createDebouncedSlackUpdater,
  postOrReuseSlackMessage,
  readSlackMessageRef,
  saveSlackMessageRef,
  readSlackTerminalState,
  saveSlackTerminalState,
} from "./messaging";
import {
  SLACK_INITIAL_PROGRESS_TEXT,
  slackToolTaskTitle,
  type SlackProgressSanitizationContext,
} from "./progress";
import type { SlackEventTaskDeps, SlackEventTaskPayload } from "./types";

export type SlackConversationalReply = {
  onProgress: (event: RunChatAgentProgressEvent) => Promise<void>;
  finalize: (reply: { markdown: string; slackText: string }) => Promise<void>;
  fail: (text: string) => Promise<boolean>;
};

/** One small, editable status. The answer is a new message after any cards. */
export async function openSlackConversationalReply(input: {
  deps: SlackEventTaskDeps;
  botToken: string;
  payload: SlackEventTaskPayload;
  postThreadTs: string;
  context: SlackProgressSanitizationContext;
}): Promise<SlackConversationalReply> {
  const { deps, botToken, payload } = input;
  const status = await postOrReuseSlackMessage({
    deps,
    botToken,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    postThreadTs: input.postThreadTs,
    eventId: payload.eventId,
    metadataKey: SLACK_REQUEST_MESSAGE_KEY,
    text: SLACK_INITIAL_PROGRESS_TEXT,
    blocks: buildSlackRequestStatus(
      SLACK_INITIAL_PROGRESS_TEXT,
      deps.runtimeRunId
    ),
  });
  let terminal = false;
  const updater = createDebouncedSlackUpdater({
    botToken,
    channel: payload.channelId,
    ts: status.ts,
    now: () => deps.now().getTime(),
    updateMessage: (token, message) =>
      deps.updateMessage(token, {
        ...message,
        blocks: buildSlackRequestStatus(
          message.text,
          terminal ? undefined : deps.runtimeRunId
        ),
      }),
  });
  return {
    async onProgress(event) {
      if (terminal) return;
      // Model prose may be revised after a tool result. Keep it out of the
      // status so no intermediate answer is stranded above the final reply.
      const text =
        event.type === "tool_started"
          ? `_${slackToolTaskTitle(event.toolName)}…_`
          : "_Working on your request…_";
      await updater(text);
    },
    async finalize(reply) {
      deps.runtimeSignal?.throwIfAborted();
      terminal = true;
      await updater.finalize("_Finished._");
      deps.runtimeSignal?.throwIfAborted();
      const blocks = [
        { type: "markdown", text: fitSlackMessageText(reply.markdown) },
      ];
      const key = "slackConversationalAnswer";
      const previous = readSlackMessageRef(key);
      if (
        previous?.eventId === payload.eventId &&
        previous.channel === payload.channelId &&
        previous.threadTs === payload.threadTs
      ) {
        const update = {
          channel: previous.channel,
          ts: previous.ts,
          text: reply.slackText,
          blocks,
        };
        try {
          await deps.updateMessage(botToken, update);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/\binvalid_blocks\b/.test(error.message)
          )
            throw error;
          await deps.updateMessage(botToken, { ...update, blocks: [] });
        }
        return;
      }
      const message = {
        channel: payload.channelId,
        thread_ts: input.postThreadTs,
        text: reply.slackText,
        blocks,
        unfurl_links: false,
      };
      let posted;
      try {
        posted = await deps.postMessage(botToken, message);
      } catch (error) {
        // Older self-hosted Slack apps may not have Markdown blocks enabled.
        // Retry only Slack's explicit rejection, never an uncertain timeout.
        if (
          !(error instanceof Error) ||
          !/\binvalid_blocks\b/.test(error.message)
        )
          throw error;
        posted = await deps.postMessage(botToken, { ...message, blocks: [] });
      }
      await saveSlackMessageRef(key, {
        channel: posted.channel,
        ts: posted.ts,
        threadTs: payload.threadTs,
        eventId: payload.eventId,
      });
    },
    async fail(text) {
      terminal = true;
      try {
        await updater.finalize(text);
        return true;
      } catch (error) {
        console.warn("[slack-event] status update failed", error);
        return false;
      }
    },
  };
}

/** The task signal aborts the model first; remove controls after it settles. */
export async function recoverSlackConversationalCancellation(
  payload: SlackEventTaskPayload
) {
  if (readSlackTerminalState()) return;
  const ref = readSlackMessageRef(SLACK_REQUEST_MESSAGE_KEY);
  if (ref?.channel !== payload.channelId || ref.eventId !== payload.eventId)
    return;
  const token = await getSlackBotToken(payload.teamId);
  if (!token) return;
  await updateSlackMessage(token, {
    channel: ref.channel,
    ts: ref.ts,
    text: "_Request stopped._",
    blocks: buildSlackRequestStatus("_Request stopped._"),
  });
  await saveSlackTerminalState("delivered");
}
