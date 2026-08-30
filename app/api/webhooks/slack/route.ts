import { after, NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack/verify";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";

import {
  SLACK_WEBHOOK_MAX_BODY_BYTES,
  buildSlackEventTaskPayload,
  buildSlackThreadConcurrencyKey,
  getSlackEventIdentityDiagnostics,
  hasCompleteSlackEventIdentity,
  shouldDispatchSlackEvent,
  type SlackInteractivityPayload,
  type SlackEventPayload,
  type SlackWebhookDeps,
  type SlackWebhookDispatchInput,
} from "./_lib/event-types";
import type { SlackCommandPayload } from "@/lib/slack/command";

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

async function dispatchInteractivity(
  payload: SlackInteractivityPayload
): Promise<void> {
  if (payload.type === "view_submission") {
    const { handleSlackIssueModalSubmission } =
      await import("@/lib/slack/command-interactions");
    await handleSlackIssueModalSubmission(payload);
    return;
  }
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
  if (input.kind === "command") {
    const { handleSlackCommand } = await import("@/lib/slack/command");
    await handleSlackCommand(input.body);
    return;
  }
  if (input.kind === "interactivity") {
    await dispatchInteractivity(input.body);
    return;
  }

  const event = input.body.event;
  if (!event || !shouldDispatchSlackEvent(event)) {
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

function parseSlackCommand(
  params: URLSearchParams
): SlackCommandPayload | null {
  const [command, teamId, channelId, slackUserId, responseUrl] = [
    "command",
    "team_id",
    "channel_id",
    "user_id",
    "response_url",
  ].map((field) => params.get(field)?.trim() ?? "");
  if ([command, teamId, channelId, slackUserId, responseUrl].includes(""))
    return null;
  return {
    command,
    text: params.get("text") ?? "",
    teamId,
    channelId,
    slackUserId,
    responseUrl,
    ...(params.get("trigger_id")?.trim()
      ? { triggerId: params.get("trigger_id")!.trim() }
      : {}),
  };
}

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

    return handleEventRequest(rawBody, deps.dispatch);
  };
}

export const POST = createSlackWebhookPostHandler();
