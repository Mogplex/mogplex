import { after, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  isSlackImageAttachmentMimetype,
  SLACK_IMAGE_ATTACHMENT_MAX_COUNT,
} from "@/lib/slack/run-attachments";
import type { SlackEventTaskPayload } from "@/trigger/slack-event";
import type { SlackBlockActionsPayload } from "@/lib/slack/interactivity";

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

function getSlackEventIdentityDiagnostics(body: SlackEventCallbackBody) {
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

function hasCompleteSlackEventIdentity(body: SlackEventCallbackBody): boolean {
  const diagnostics = getSlackEventIdentityDiagnostics(body);
  return (
    diagnostics.hasTeamId &&
    diagnostics.hasEventId &&
    diagnostics.eventType !== null
  );
}

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
  | { kind: "interactivity"; body: SlackInteractivityPayload; rawBody: string };

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

async function dispatchInteractivity(
  payload: SlackInteractivityPayload
): Promise<void> {
  // Only `block_actions` (button clicks etc.) are wired today; other shapes
  // (view submissions, shortcuts) are acked by the webhook and dropped here.
  if (payload.type !== "block_actions") return;

  // Lazy-import so the route module stays loadable in unit tests / during the
  // url_verification handshake without pulling in the run-control + Supabase
  // chain that the interactivity handler depends on.
  const { handleSlackBlockActions } = await import("@/lib/slack/interactivity");
  await handleSlackBlockActions(payload);
}

async function defaultDispatch(
  input: SlackWebhookDispatchInput
): Promise<void> {
  if (input.kind === "interactivity") {
    await dispatchInteractivity(input.body);
    return;
  }

  const event = input.body.event;
  if (!event || isBotOriginatedEvent(event) || !isSupportedSlackEvent(event)) {
    return;
  }

  const payload = buildSlackEventTaskPayload(input.body);
  if (!payload) return;

  // Lazy-import the Trigger SDK so the route module can be exercised in unit
  // tests (and during the Slack url_verification handshake) without pulling in
  // the SDK's runtime configuration.
  const { tasks } = await import("@trigger.dev/sdk/v3");
  await tasks.trigger(TRIGGER_TASK_IDS.slackEventHandler, payload, {
    idempotencyKey: `slack-event:${input.body.event_id}`,
    concurrencyKey: buildSlackThreadConcurrencyKey(payload),
    tags: [
      `slack-team:${payload.teamId}`,
      `slack-channel:${payload.channelId}`,
      `slack-event:${payload.eventType}`,
    ],
  });
}

const defaultDeps: SlackWebhookDeps = {
  getSigningSecret: () => process.env.SLACK_SIGNING_SECRET ?? null,
  dispatch: defaultDispatch,
  scheduleAfterResponse: (work) => {
    after(work);
  },
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function safeDispatch(
  dispatch: SlackWebhookDeps["dispatch"],
  input: SlackWebhookDispatchInput,
  context: Record<string, unknown>
) {
  if (!dispatch) return;
  try {
    await dispatch(input);
  } catch (error) {
    // Dispatch failures must not block the ack — Slack will retry and our
    // idempotency keys will dedupe on the next delivery.
    console.error(`[slack-webhook] ${input.kind} dispatch failed`, {
      ...context,
      error,
    });
  }
}

async function handleInteractivityRequest(
  rawBody: string,
  dispatch: SlackWebhookDeps["dispatch"],
  scheduleAfterResponse: NonNullable<SlackWebhookDeps["scheduleAfterResponse"]>
) {
  const params = new URLSearchParams(rawBody);
  const payloadJson = params.get("payload");
  if (!payloadJson) return jsonError("Missing payload", 400);

  const payload = safeJsonParse<SlackInteractivityPayload>(payloadJson);
  if (!payload || typeof payload.type !== "string") {
    return jsonError("Invalid payload", 400);
  }

  // `dispatch` (see `dispatchInteractivity`) actually performs the cancel and
  // POSTs to `response_url`, which can take longer than Slack's ~3s action
  // timeout. Ack first, then run it after the response is sent — otherwise a
  // slow cancel makes Slack retry the delivery and we redo the work. Failures
  // are swallowed by `safeDispatch`.
  scheduleAfterResponse(() =>
    safeDispatch(
      dispatch,
      { kind: "interactivity", body: payload, rawBody },
      { interactivityType: payload.type }
    )
  );
  return NextResponse.json({ ok: true });
}

async function handleEventRequest(
  rawBody: string,
  dispatch: SlackWebhookDeps["dispatch"]
) {
  const body = safeJsonParse<SlackEventPayload>(rawBody);
  if (!body || typeof body.type !== "string") {
    return jsonError("Invalid payload", 400);
  }

  // First-time Event Subscriptions setup hands us a challenge to echo back.
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (body.type === "event_callback") {
    if (!hasCompleteSlackEventIdentity(body)) {
      // The signed payload cannot be dispatched safely, but a non-2xx would
      // make Slack redeliver the same malformed event without making it valid.
      console.warn(
        "[slack-webhook] ignoring incomplete event identity",
        getSlackEventIdentityDiagnostics(body)
      );
      return NextResponse.json({ ok: true });
    }
    if (!dispatch) {
      console.error("[slack-webhook] event dispatch is not configured", {
        eventId: body.event_id,
        teamId: body.team_id,
      });
      return jsonError("Dispatch unavailable", 503);
    }

    try {
      await dispatch({ kind: "event", body, rawBody });
    } catch (error) {
      console.error("[slack-webhook] event dispatch failed", {
        eventId: body.event_id,
        teamId: body.team_id,
        error,
      });
      return jsonError("Dispatch failed", 503);
    }
    return NextResponse.json({ ok: true });
  }

  // Unknown top-level type — ack so Slack doesn't retry forever.
  return NextResponse.json({ ok: true });
}

export function createSlackWebhookPostHandler(
  overrides: Partial<SlackWebhookDeps> = {}
) {
  const deps: SlackWebhookDeps = { ...defaultDeps, ...overrides };
  const runAfterResponse =
    deps.scheduleAfterResponse ?? ((work) => after(work));

  return async function POST(request: Request) {
    const signingSecret = deps.getSigningSecret();
    if (!signingSecret) {
      // Misconfiguration — don't pretend the route is healthy.
      console.error("[slack-webhook] SLACK_SIGNING_SECRET is not configured");
      return jsonError("Slack integration not configured", 503);
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > SLACK_WEBHOOK_MAX_BODY_BYTES) {
      return jsonError("Payload too large", 413);
    }

    const isValid = verifySlackRequest({
      headers: request.headers,
      rawBody,
      signingSecret,
      now: deps.now,
    });
    if (!isValid) {
      return jsonError("Invalid signature", 401);
    }

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      return handleInteractivityRequest(
        rawBody,
        deps.dispatch,
        runAfterResponse
      );
    }

    return handleEventRequest(rawBody, deps.dispatch);
  };
}

export const POST = createSlackWebhookPostHandler();
