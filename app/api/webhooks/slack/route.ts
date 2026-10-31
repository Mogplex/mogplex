import { after, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { forwardNativeWebhook } from "@/lib/trigger/webhook-forwarding";
import { parseDurableSlackWebhook } from "./_lib/native-input";
import {
  dispatchVerifiedSlackWebhook,
  parseSlackCommand,
} from "./_lib/verified-dispatch";

import {
  SLACK_WEBHOOK_MAX_BODY_BYTES,
  getSlackEventIdentityDiagnostics,
  hasCompleteSlackEventIdentity,
  isSlackWorkObjectEvent,
  type SlackInteractivityPayload,
  type SlackEventPayload,
  type SlackWebhookDeps,
  type SlackWebhookDispatchInput,
} from "./_lib/event-types";
import { parseCommand } from "@/lib/slack/command-parse";
import { buildSlackCommandHelpResponse } from "@/lib/slack/command-help";

// Re-export types and functions that tests depend on
export {
  SLACK_WEBHOOK_MAX_BODY_BYTES,
  type SlackUrlVerificationBody,
  type SlackEventCallbackBody,
  type SlackEvent,
  type SlackEventFile,
  type SlackEventPayload,
  type SlackInteractivityPayload,
  type SlackWebhookDispatchInput,
  type SlackWebhookDeps,
  isSupportedSlackEvent,
  buildSlackEventTaskPayload,
  buildSlackThreadConcurrencyKey,
} from "./_lib/event-types";

async function handleSlashCommandRequest(
  rawBody: string,
  dispatch: SlackWebhookDeps["dispatch"],
  scheduleAfterResponse: NonNullable<SlackWebhookDeps["scheduleAfterResponse"]>
) {
  const payload = parseSlackCommand(new URLSearchParams(rawBody));
  if (!payload) {
    return NextResponse.json(
      {
        response_type: "ephemeral",
        text: "Mogplex could not read this command. Try `/mogplex help` again.",
      },
      { status: 200 }
    );
  }
  // Static help fits Slack's acknowledgement window and works before linking.
  if (parseCommand(payload)?.name === "help") {
    return NextResponse.json(buildSlackCommandHelpResponse());
  }
  scheduleAfterResponse(() =>
    safeDispatch(
      dispatch,
      { kind: "command", body: payload, rawBody },
      { command: payload.command }
    )
  );
  // Slack requires an acknowledgement within three seconds. The user-facing
  // result is posted asynchronously to the signed request's response_url.
  return new NextResponse(null, { status: 200 });
}

const defaultDeps: SlackWebhookDeps = {
  getSigningSecret: () => process.env.SLACK_SIGNING_SECRET ?? null,
  dispatch: dispatchVerifiedSlackWebhook,
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
  dispatch: SlackWebhookDeps["dispatch"],
  scheduleAfterResponse: NonNullable<SlackWebhookDeps["scheduleAfterResponse"]>
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
    if (isSlackWorkObjectEvent(body.event)) {
      // The flexpane's trigger_id expires within seconds and a late unfurl
      // is useless: ack now and answer after the response.
      scheduleAfterResponse(() =>
        safeDispatch(
          dispatch,
          { kind: "event", body, rawBody },
          { eventType: body.event.type }
        )
      );
      return NextResponse.json({ ok: true });
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

    if (
      process.env.TRIGGER_SLACK_WEBHOOK_URL &&
      parseDurableSlackWebhook(rawBody, contentType)
    ) {
      return forwardNativeWebhook("slack", rawBody, request.headers);
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      if (params.has("command")) {
        return handleSlashCommandRequest(
          rawBody,
          deps.dispatch,
          runAfterResponse
        );
      }
      return handleInteractivityRequest(
        rawBody,
        deps.dispatch,
        runAfterResponse
      );
    }

    return handleEventRequest(rawBody, deps.dispatch, runAfterResponse);
  };
}

export const POST = createSlackWebhookPostHandler();
