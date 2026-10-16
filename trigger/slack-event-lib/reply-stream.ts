import type { RunChatAgentProgressEvent } from "@/lib/agents/run-chat-progress";
import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import type {
  SlackStreamChunk,
  StartSlackStreamInput,
  updateSlackMessage,
} from "@/lib/slack/client";
import { SLACK_MESSAGE_TEXT_MAX_CHARS } from "@/lib/slack/format";
import {
  createDebouncedSlackUpdater,
  finalizeSlackUpdaterBestEffort,
  postOrReuseSlackMessage,
  readSlackMessageRef,
  saveSlackMessageRef,
} from "./messaging";
import {
  createSlackAgentProgressHandler,
  SLACK_INITIAL_PROGRESS_TEXT,
  slackToolTaskTitle,
  type SlackProgressSanitizationContext,
} from "./progress";
import type { SlackEventTaskDeps, SlackEventTaskPayload } from "./types";

// chat.appendStream is a Tier 2 method (about 20 calls a minute, shared by
// every reply in the workspace), so appends batch text and task updates.
const STREAM_APPEND_INTERVAL_MS = 3_500;
const STREAM_MARKDOWN_MAX_CHARS = 12_000;
const PREPARE_TASK_ID = "mogplex-prepare";
const METADATA_KEY = "slackConversationalPlaceholder";

/** The conversational reply: progress while the agent works, then the answer. */
export type SlackConversationalReply = {
  onProgress: (event: RunChatAgentProgressEvent) => Promise<void>;
  /**
   * Deliver the answer. `markdown` is the sanitized reply as the model wrote
   * it; `slackText` is the same reply in Slack mrkdwn, fitted to the limit.
   */
  finalize: (reply: { markdown: string; slackText: string }) => Promise<void>;
  /** Replace the reply with an error notice. Never throws. */
  fail: (text: string) => Promise<boolean>;
};

type StreamDeps = Required<
  Pick<SlackEventTaskDeps, "startStream" | "appendStream" | "stopStream">
> & { updateMessage: typeof updateSlackMessage };

/** Text up to the last whitespace, so a half-streamed token never shows. */
function completeWords(text: string) {
  const end = text.search(/\s\S*$/);
  return end === -1 ? "" : text.slice(0, end + 1);
}

/**
 * A reply streamed with chat.startStream: tool steps become task cards and
 * the answer streams in as markdown. Only sanitized, whole-word text that
 * extends what was already sent is appended. If the final answer does not
 * extend it, the message is replaced with the final text, so the end state
 * matches the non-streamed reply. A failed append stops streaming; the final
 * edit still lands.
 */
export function createSlackReplyStream(input: {
  deps: StreamDeps;
  botToken: string;
  channel: string;
  ts: string;
  context: SlackProgressSanitizationContext;
  now: () => number;
  appendIntervalMs?: number;
}): SlackConversationalReply {
  const { deps, botToken, channel, ts } = input;
  const interval = input.appendIntervalMs ?? STREAM_APPEND_INTERVAL_MS;
  const tasks = new Map<string, SlackStreamChunk>();
  let prepareOpen = true;
  let accumulated = "";
  let sent = "";
  let lastAppendAt = input.now();
  let inFlight: Promise<void> | null = null;
  let broken = false;

  const task = (
    id: string,
    title: string,
    status: "in_progress" | "complete" | "error"
  ): SlackStreamChunk => ({ type: "task_update", id, title, status });

  const closePrepare = () => {
    if (!prepareOpen) return;
    prepareOpen = false;
    tasks.set(
      PREPARE_TASK_ID,
      task(PREPARE_TASK_ID, "Reading your request", "complete")
    );
  };

  const pendingDelta = () => {
    const visible = completeWords(
      sanitizeAgentUserFacingText(accumulated, {
        repoName: input.context.repoName,
        userRequestText: input.context.userText,
      })
    );
    return visible.startsWith(sent) && visible.length > sent.length
      ? visible.slice(sent.length)
      : "";
  };

  const takeChunks = () => {
    const delta = pendingDelta();
    const chunks = [
      ...tasks.values(),
      ...(delta ? [{ type: "markdown_text", text: delta }] : []),
    ];
    tasks.clear();
    return { chunks, delta };
  };

  const flush = (force = false) => {
    if (broken || inFlight) return;
    if (!force && input.now() - lastAppendAt < interval) return;
    const { chunks, delta } = takeChunks();
    if (chunks.length === 0) return;
    lastAppendAt = input.now();
    inFlight = deps
      .appendStream(botToken, { channel, ts, chunks })
      .then(() => {
        sent += delta;
      })
      .catch((error) => {
        broken = true;
        console.warn("[slack-event] chat.appendStream failed", error);
      })
      .finally(() => {
        inFlight = null;
      });
  };

  return {
    async onProgress(event) {
      switch (event.type) {
        case "text_delta":
          closePrepare();
          accumulated = event.accumulatedText;
          break;
        case "tool_started":
          closePrepare();
          tasks.set(
            event.toolCallId,
            task(
              event.toolCallId,
              slackToolTaskTitle(event.toolName),
              "in_progress"
            )
          );
          break;
        case "tool_finished":
          tasks.set(
            event.toolCallId,
            task(
              event.toolCallId,
              slackToolTaskTitle(event.toolName),
              event.success ? "complete" : "error"
            )
          );
          break;
        default:
          break;
      }
      flush();
    },

    async finalize(reply) {
      if (inFlight) await inFlight;
      closePrepare();
      const finished = [...tasks.values()];
      tasks.clear();
      const remainder = reply.markdown.startsWith(sent)
        ? reply.markdown.slice(sent.length)
        : null;
      const keepStream =
        !broken &&
        remainder !== null &&
        Array.from(reply.markdown).length <= SLACK_MESSAGE_TEXT_MAX_CHARS &&
        remainder.length <= STREAM_MARKDOWN_MAX_CHARS;
      try {
        await deps.stopStream(botToken, {
          channel,
          ts,
          chunks: [
            ...finished,
            ...(keepStream && remainder
              ? [{ type: "markdown_text", text: remainder }]
              : []),
          ],
        });
        if (keepStream) return;
      } catch (error) {
        console.warn("[slack-event] chat.stopStream failed", error);
      }
      // The streamed text cannot be rewritten in place; replace it.
      await deps.updateMessage(botToken, {
        channel,
        ts,
        text: reply.slackText,
      });
    },

    async fail(text) {
      if (inFlight) await inFlight;
      try {
        await deps.stopStream(botToken, { channel, ts });
      } catch {
        // A stream that never started or already stopped still takes an edit.
      }
      try {
        await deps.updateMessage(botToken, { channel, ts, text });
        return true;
      } catch (error) {
        console.warn("[slack-event] reply error update failed", error);
        return false;
      }
    },
  };
}

/** The pre-streaming reply: a placeholder edited about once a second. */
function createEditedReply(input: {
  deps: SlackEventTaskDeps;
  botToken: string;
  channel: string;
  ts: string;
  context: SlackProgressSanitizationContext;
}): SlackConversationalReply {
  const updater = createDebouncedSlackUpdater({
    botToken: input.botToken,
    channel: input.channel,
    ts: input.ts,
    updateMessage: input.deps.updateMessage,
    now: () => input.deps.now().getTime(),
  });
  return {
    onProgress: createSlackAgentProgressHandler(updater, input.context),
    finalize: (reply) => updater.finalize(reply.slackText),
    fail: (text) =>
      finalizeSlackUpdaterBestEffort(
        updater,
        text,
        "agent error placeholder update"
      ),
  };
}

function streamingEnabled(
  deps: SlackEventTaskDeps
): deps is SlackEventTaskDeps &
  Required<
    Pick<SlackEventTaskDeps, "startStream" | "appendStream" | "stopStream">
  > {
  return Boolean(
    deps.startStream &&
    deps.appendStream &&
    deps.stopStream &&
    process.env.SLACK_STREAMING_REPLIES?.trim().toLowerCase() !== "off"
  );
}

/**
 * Open the reply for one Slack event. Streams when Slack accepts it; falls
 * back to the edited placeholder when streaming is off, unsupported, or
 * fails to start. A retried event reuses its first message rather than
 * posting a second reply.
 */
export async function openSlackConversationalReply(input: {
  deps: SlackEventTaskDeps;
  botToken: string;
  payload: SlackEventTaskPayload;
  postThreadTs: string;
  context: SlackProgressSanitizationContext;
}): Promise<SlackConversationalReply> {
  const { deps, botToken, payload } = input;
  const base = {
    deps,
    botToken,
    channel: payload.channelId,
    context: input.context,
  };
  const retry = readSlackMessageRef(METADATA_KEY);
  if (!retry && streamingEnabled(deps)) {
    const start: StartSlackStreamInput = {
      channel: payload.channelId,
      thread_ts: input.postThreadTs,
      recipient_user_id: payload.slackUserId,
      recipient_team_id: payload.teamId,
      task_display_mode: "timeline",
      chunks: [
        {
          type: "task_update",
          id: PREPARE_TASK_ID,
          title: "Reading your request",
          status: "in_progress",
        },
      ],
    };
    try {
      const started = await deps.startStream(botToken, start);
      await saveSlackMessageRef(METADATA_KEY, {
        channel: payload.channelId,
        ts: started.ts,
        threadTs: payload.threadTs,
        eventId: payload.eventId,
      });
      return createSlackReplyStream({
        ...base,
        deps,
        ts: started.ts,
        now: () => deps.now().getTime(),
      });
    } catch (error) {
      console.warn(
        "[slack-event] chat.startStream failed; editing instead",
        error
      );
    }
  }
  const placeholder = await postOrReuseSlackMessage({
    deps,
    botToken,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    postThreadTs: input.postThreadTs,
    eventId: payload.eventId,
    metadataKey: METADATA_KEY,
    text: SLACK_INITIAL_PROGRESS_TEXT,
  });
  return createEditedReply({ ...base, ts: placeholder.ts });
}
