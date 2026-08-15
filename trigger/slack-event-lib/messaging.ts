import { metadata } from "@trigger.dev/sdk/v3";
import type { updateSlackMessage } from "@/lib/slack/client";
import type { SlackEventTaskDeps, SlackPostedMessageRef } from "./types";

/** Slack rate-limits chat.update at roughly 1/sec/channel. */
const SLACK_UPDATE_MIN_INTERVAL_MS = 1_000;

export function readSlackMessageRef(key: string): SlackPostedMessageRef | null {
  let stored: unknown;
  try {
    stored = metadata.get(key);
  } catch {
    return null;
  }
  if (!stored || typeof stored !== "object") return null;
  const ref = stored as Partial<SlackPostedMessageRef>;
  if (
    typeof ref.channel !== "string" ||
    typeof ref.ts !== "string" ||
    typeof ref.threadTs !== "string" ||
    typeof ref.eventId !== "string"
  ) {
    return null;
  }
  return {
    channel: ref.channel,
    ts: ref.ts,
    threadTs: ref.threadTs,
    eventId: ref.eventId,
  };
}

async function saveSlackMessageRef(key: string, ref: SlackPostedMessageRef) {
  try {
    await metadata.set(key, ref).flush();
  } catch {
    // Trigger metadata is only available inside a task run. Unit tests call the
    // pure task body directly, so metadata persistence is best-effort there.
  }
}

export async function postOrReuseSlackMessage(input: {
  deps: SlackEventTaskDeps;
  botToken: string;
  channelId: string;
  // Cache identity key for idempotent retries. For one-to-one DMs this stays
  // bound to the inbound thread even when the outbound message is top-level.
  threadTs: string;
  // Slack API `thread_ts` for the message being posted. Omit for top-level DMs.
  postThreadTs?: string;
  eventId: string;
  metadataKey: string;
  text: string;
}) {
  const stored = readSlackMessageRef(input.metadataKey);
  if (
    stored?.channel === input.channelId &&
    stored.threadTs === input.threadTs &&
    stored.eventId === input.eventId
  ) {
    return { channel: stored.channel, ts: stored.ts };
  }

  const posted = await input.deps.postMessage(input.botToken, {
    channel: input.channelId,
    thread_ts: input.postThreadTs,
    text: input.text,
  });
  await saveSlackMessageRef(input.metadataKey, {
    channel: posted.channel,
    ts: posted.ts,
    threadTs: input.threadTs,
    eventId: input.eventId,
  });
  return posted;
}

export async function updateMessageBestEffort(
  deps: SlackEventTaskDeps,
  botToken: string,
  input: Parameters<typeof updateSlackMessage>[1],
  context: string
) {
  try {
    await deps.updateMessage(botToken, input);
    return true;
  } catch (error) {
    console.warn(`[slack-event] ${context} failed`, error);
    return false;
  }
}

export async function postMessageBestEffort(
  deps: Pick<SlackEventTaskDeps, "postMessage">,
  botToken: string,
  input: Parameters<SlackEventTaskDeps["postMessage"]>[1],
  label: string
) {
  try {
    await deps.postMessage(botToken, input);
    return true;
  } catch (error) {
    console.warn(`[slack-event] ${label} failed`, error);
    return false;
  }
}

const SLACK_TERMINAL_STATE_METADATA_KEY = "slackTerminalState";

export type SlackTerminalState = "delivered" | "failed";

export function readSlackTerminalState(): SlackTerminalState | null {
  try {
    const state = metadata.get(SLACK_TERMINAL_STATE_METADATA_KEY);
    return state === "delivered" || state === "failed" ? state : null;
  } catch {
    return null;
  }
}

export async function saveSlackTerminalState(state: SlackTerminalState) {
  try {
    await metadata.set(SLACK_TERMINAL_STATE_METADATA_KEY, state).flush();
  } catch {
    // Unit tests invoke the task body without Trigger run metadata.
  }
}

export function createDebouncedSlackUpdater(input: {
  botToken: string;
  channel: string;
  ts: string;
  updateMessage: typeof updateSlackMessage;
  minIntervalMs?: number;
  now?: () => number;
}) {
  const minIntervalMs = input.minIntervalMs ?? SLACK_UPDATE_MIN_INTERVAL_MS;
  const now = input.now ?? Date.now;
  let lastSentText = "";
  let lastSentAt = 0;
  let inFlight: Promise<void> | null = null;

  const pushUpdate = async function pushUpdate(latestText: string) {
    if (latestText === lastSentText) return;
    if (inFlight) return; // collapse concurrent attempts
    const elapsed = now() - lastSentAt;
    if (elapsed < minIntervalMs) return;

    lastSentText = latestText;
    lastSentAt = now();

    inFlight = input
      .updateMessage(input.botToken, {
        channel: input.channel,
        ts: input.ts,
        text: latestText,
      })
      .then(() => undefined)
      .catch((error) => {
        console.warn("[slack-event] streaming chat.update failed", error);
      })
      .finally(() => {
        inFlight = null;
      });
  };

  return Object.assign(pushUpdate, {
    async flush() {
      if (inFlight) await inFlight;
    },
  });
}
