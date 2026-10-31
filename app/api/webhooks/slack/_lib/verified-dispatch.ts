import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  buildSlackEventTaskPayload,
  buildSlackThreadConcurrencyKey,
  isSlackWorkObjectEvent,
  shouldDispatchSlackEvent,
  type SlackInteractivityPayload,
  type SlackWebhookDispatchInput,
} from "./event-types";
import type { SlackCommandPayload } from "@/lib/slack/command";
import { SLACK_CHECKPOINT_REVISE_CALLBACK_ID } from "@/lib/slack/run-checkpoint-presentation";

async function dispatchInteractivity(
  payload: SlackInteractivityPayload
): Promise<void> {
  if (payload.type === "view_submission") {
    if (payload.view?.callback_id === SLACK_CHECKPOINT_REVISE_CALLBACK_ID) {
      const { handleCheckpointReviseSubmission } =
        await import("@/lib/slack/run-checkpoint-interactions");
      await handleCheckpointReviseSubmission(payload);
      return;
    }
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

export async function dispatchVerifiedSlackWebhook(
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
  if (isSlackWorkObjectEvent(event)) {
    const { handleSlackWorkObjectEvent } =
      await import("@/lib/slack/work-object-events");
    await handleSlackWorkObjectEvent(input.body.team_id, event);
    return;
  }
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

export function parseSlackCommand(
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
