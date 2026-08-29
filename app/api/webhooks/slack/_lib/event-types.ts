import {
  isSlackImageAttachmentMimetype,
  SLACK_IMAGE_ATTACHMENT_MAX_COUNT,
} from "@/lib/slack/run-attachments";
import type { SlackEventTaskPayload } from "@/trigger/slack-event";
import type { SlackBlockActionsPayload } from "@/lib/slack/interactivity";
import type { SlackModelCommandPayload } from "@/lib/slack/model-command";

/**
 * Sanity ceiling on the request body. Legitimate Slack event/interactivity
 * payloads are a few KB at most; anything past this is rejected after the body
 * is read (Next.js route handlers don't expose a pre-read size hook), which at
 * least bounds what we hand to the JSON parser and HMAC verifier.
 */
export const SLACK_WEBHOOK_MAX_BODY_BYTES = 1_000_000;

export type SlackUrlVerificationBody = {
  type: "url_verification";
  token?: string;
  challenge: string;
};

export type SlackEventCallbackBody = {
  type: "event_callback";
  team_id: string;
  api_app_id?: string;
  event_id: string;
  event_time?: number;
  event: SlackEvent;
};

export type SlackEvent = {
  type: string;
  channel?: string;
  channel_type?: "im" | "mpim" | "channel" | "group";
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  bot_profile?: unknown;
  subtype?: string;
  files?: SlackEventFile[];
};

export type SlackEventFile = {
  id?: string;
  mimetype?: string;
  url_private_download?: string;
  name?: string;
  size?: number;
  filetype?: string;
  mode?: string;
};

export type SlackEventPayload =
  | SlackUrlVerificationBody
  | SlackEventCallbackBody;

// Extends the handler's payload shape so passing one to `handleSlackBlockActions`
// is checked structurally rather than via an `as` cast — if `SlackBlockActionsPayload`
// is ever tightened, this stops compiling instead of silently masking a mismatch.
// No `[key: string]: unknown` index signature: it would make the intersection
// vacuous (any `{ type: string }` would satisfy it), defeating that check.
export type SlackInteractivityPayload = SlackBlockActionsPayload & {
  trigger_id?: string;
};

export type SlackWebhookDispatchInput =
  | { kind: "event"; body: SlackEventCallbackBody; rawBody: string }
  | { kind: "interactivity"; body: SlackInteractivityPayload; rawBody: string }
  | { kind: "command"; body: SlackModelCommandPayload; rawBody: string };

export type SlackWebhookDeps = {
  /** Lookup of the signing secret — abstracted so tests can pass a literal. */
  getSigningSecret: () => string | null;
  /**
   * Forward verified, parsed payloads onward (Trigger.dev dispatch in later slices).
   * Must return quickly — the webhook is expected to ack within 3 seconds.
   */
  dispatch?: (input: SlackWebhookDispatchInput) => void | Promise<void>;
  /**
   * Run work after the HTTP response has been sent. Defaults to Next's `after`.
   * Tests inject a synchronous shim so they can assert ack-before-dispatch
   * ordering (`after` itself throws outside a request scope).
   */
  scheduleAfterResponse?: (work: () => void | Promise<void>) => void;
  now?: () => number;
};

export function getSlackEventIdentityDiagnostics(body: SlackEventCallbackBody) {
  const untrusted = body as {
    team_id?: unknown;
    event_id?: unknown;
    event?: { type?: unknown } | null;
  };
  return {
    hasTeamId:
      typeof untrusted.team_id === "string" &&
      untrusted.team_id.trim().length > 0,
    hasEventId:
      typeof untrusted.event_id === "string" &&
      untrusted.event_id.trim().length > 0,
    eventType:
      typeof untrusted.event?.type === "string" &&
      untrusted.event.type.trim().length > 0
        ? untrusted.event.type
        : null,
  };
}

export function hasCompleteSlackEventIdentity(
  body: SlackEventCallbackBody
): boolean {
  const diagnostics = getSlackEventIdentityDiagnostics(body);
  return (
    diagnostics.hasTeamId &&
    diagnostics.hasEventId &&
    diagnostics.eventType !== null
  );
}

function isBotOriginatedEvent(event: SlackEvent): boolean {
  return Boolean(
    event.bot_id || event.bot_profile || event.subtype === "bot_message"
  );
}

export function isSupportedSlackEvent(event: SlackEvent): boolean {
  if (event.type === "app_mention") return true;
  if (event.type === "message") return isSupportedMessageEvent(event);
  return false;
}

function isSupportedMessageEvent(event: SlackEvent): boolean {
  if (isDirectConversationChannelType(event.channel_type)) return true;
  return isThreadReplyMessageEvent(event);
}

function isDirectConversationChannelType(
  channelType: SlackEvent["channel_type"]
) {
  return channelType === "im" || channelType === "mpim";
}

function isThreadReplyMessageEvent(event: SlackEvent): boolean {
  return (
    isConversationChannelType(event.channel_type) &&
    typeof event.thread_ts === "string" &&
    event.thread_ts.length > 0 &&
    event.thread_ts !== event.ts
  );
}

function isConversationChannelType(channelType: SlackEvent["channel_type"]) {
  return (
    channelType === "channel" ||
    channelType === "group" ||
    channelType === "mpim"
  );
}

function isSupportedSlackImageMimetype(
  mimetype: string | undefined
): mimetype is NonNullable<
  SlackEventTaskPayload["attachments"]
>[number]["mimetype"] {
  return isSlackImageAttachmentMimetype(mimetype);
}

function logSlackAttachmentSkipped(input: {
  reason: "mimetype" | "count_cap" | "external" | "no_url";
  attachmentId?: string;
  mimetype?: string;
  sizeBytes?: number;
}) {
  console.warn("[slack-webhook] slack.attachment.skipped", input);
}

type SlackAttachmentMappingResult =
  | {
      kind: "attach";
      attachment: NonNullable<SlackEventTaskPayload["attachments"]>[number];
    }
  | { kind: "drop"; countCap: boolean };

function mapSlackImageFileAttachment(
  file: SlackEventFile,
  currentAttachmentCount: number
): SlackAttachmentMappingResult {
  const attachmentId = file.id;
  const mimetype = file.mimetype;
  const sizeBytes = file.size;
  const isExternal = file.filetype === "external" || file.mode === "external";
  if (isExternal) {
    logSlackAttachmentSkipped({
      reason: "external",
      attachmentId,
      mimetype,
      sizeBytes,
    });
    return { kind: "drop", countCap: false };
  }
  if (!isSupportedSlackImageMimetype(mimetype)) {
    logSlackAttachmentSkipped({
      reason: "mimetype",
      attachmentId,
      mimetype,
      sizeBytes,
    });
    return { kind: "drop", countCap: false };
  }
  if (!file.url_private_download) {
    logSlackAttachmentSkipped({
      reason: "no_url",
      attachmentId,
      mimetype,
      sizeBytes,
    });
    return { kind: "drop", countCap: false };
  }
  if (currentAttachmentCount >= SLACK_IMAGE_ATTACHMENT_MAX_COUNT) {
    logSlackAttachmentSkipped({
      reason: "count_cap",
      attachmentId,
      mimetype,
      sizeBytes,
    });
    return { kind: "drop", countCap: true };
  }
  return {
    kind: "attach",
    attachment: {
      id: attachmentId ?? file.url_private_download,
      mimetype,
      urlPrivateDownload: file.url_private_download,
      name: file.name,
      sizeBytes,
    },
  };
}

export function buildSlackEventTaskPayload(
  body: SlackEventCallbackBody
): SlackEventTaskPayload | null {
  const event = body.event;
  if (!event?.channel || !event.user || !event.ts) return null;
  const attachments: NonNullable<SlackEventTaskPayload["attachments"]> = [];
  const attachmentNotices: NonNullable<
    SlackEventTaskPayload["attachmentNotices"]
  > = [];
  let attachmentDroppedCount = 0;
  let overCapImageCount = 0;

  for (const file of event.files ?? []) {
    const result = mapSlackImageFileAttachment(file, attachments.length);
    if (result.kind === "attach") {
      attachments.push(result.attachment);
    } else {
      attachmentDroppedCount += 1;
      if (result.countCap) overCapImageCount += 1;
    }
  }

  if (overCapImageCount > 0) {
    attachmentNotices.push({
      reason: "count_cap",
      count: overCapImageCount,
    });
  }

  return {
    teamId: body.team_id,
    eventId: body.event_id,
    channelId: event.channel,
    threadTs: event.thread_ts ?? event.ts,
    messageTs: event.ts,
    slackUserId: event.user,
    text: event.text ?? "",
    channelType: (event.channel_type ?? "channel") as
      | "im"
      | "mpim"
      | "channel"
      | "group",
    eventType: event.type as "app_mention" | "message",
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(attachmentNotices.length > 0 ? { attachmentNotices } : {}),
    ...(attachmentDroppedCount > 0 ? { attachmentDroppedCount } : {}),
  };
}

export function buildSlackThreadConcurrencyKey(
  payload: Pick<SlackEventTaskPayload, "teamId" | "channelId" | "threadTs">
) {
  return [
    "slack-thread",
    payload.teamId,
    payload.channelId,
    payload.threadTs,
  ].join(":");
}

export function shouldDispatchSlackEvent(event: SlackEvent): boolean {
  return !isBotOriginatedEvent(event) && isSupportedSlackEvent(event);
}
