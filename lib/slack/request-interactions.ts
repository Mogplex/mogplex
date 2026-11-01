import { runs } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "./installations";
import { resolveSlackCommandUserId } from "./command-identity";
import { postSlackResponse } from "./response";
import type { SlackBlockActionsPayload } from "./interactivity";
import {
  SLACK_REQUEST_MESSAGE_KEY,
  SLACK_REQUEST_OWNER_KEY,
  SLACK_STOP_REQUEST_ACTION,
} from "./request-presentation";

const defaultDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getMapping: getSlackUserMapping,
  retrieve: async (id: string) => {
    const run = await runs.retrieve(id);
    return {
      taskIdentifier: run.taskIdentifier,
      payload: run.payload as unknown,
      metadata: run.metadata as Record<string, unknown> | undefined,
      isCompleted: run.isCompleted,
    };
  },
  cancel: async (id: string) => {
    await runs.cancel(id);
  },
  respond: postSlackResponse,
};
const scopeSchema = z.object({
  teamId: z.string(),
  channelId: z.string(),
  slackUserId: z.string(),
  eventId: z.string(),
  threadTs: z.string(),
});
const messageSchema = z.object({
  channel: z.string(),
  ts: z.string(),
  eventId: z.string(),
  threadTs: z.string(),
});

/** Load scope from the runtime, never from the button's mutable value. */
export async function handleSlackRequestStop(
  payload: SlackBlockActionsPayload,
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const action = payload.actions?.find(
    (item) => item.action_id === SLACK_STOP_REQUEST_ACTION
  );
  const id = action?.value;
  if (
    !id ||
    !/^run_[a-zA-Z0-9]+$/.test(id) ||
    !payload.team?.id ||
    !payload.user?.id
  )
    return "invalid";
  const installation = await deps.getInstallation(payload.team.id);
  if (!installation) return "unknown_workspace";
  const mapping = await deps.getMapping({
    installationId: installation.id,
    slackUserId: payload.user.id,
  });
  const userId = resolveSlackCommandUserId(
    installation,
    mapping,
    payload.user.id
  );
  if (!userId) return "not_linked";
  const run = await deps.retrieve(id);
  const scope = scopeSchema.safeParse(run.payload);
  const message = messageSchema.safeParse(
    run.metadata?.[SLACK_REQUEST_MESSAGE_KEY]
  );
  const channel = payload.channel?.id ?? payload.container?.channel_id;
  const ts = payload.message?.ts ?? payload.container?.message_ts;
  if (
    run.taskIdentifier !== TRIGGER_TASK_IDS.slackEventHandler ||
    !scope.success ||
    !message.success ||
    run.metadata?.[SLACK_REQUEST_OWNER_KEY] !== userId ||
    scope.data.teamId !== payload.team.id ||
    scope.data.slackUserId !== payload.user.id ||
    scope.data.channelId !== channel ||
    message.data.channel !== channel ||
    message.data.ts !== ts ||
    message.data.eventId !== scope.data.eventId ||
    message.data.threadTs !== scope.data.threadTs
  )
    return "not_owner";
  if (
    run.isCompleted ||
    run.metadata?.slackTerminalState === "delivered" ||
    run.metadata?.slackTerminalState === "failed"
  ) {
    if (payload.response_url)
      await deps.respond(payload.response_url, {
        response_type: "ephemeral",
        replace_original: false,
        text: "This request has already finished.",
      });
    return "already_finished";
  }
  try {
    await deps.cancel(id);
  } catch (error) {
    if (payload.response_url)
      await deps.respond(payload.response_url, {
        response_type: "ephemeral",
        replace_original: false,
        text: "Could not stop this request right now. Try Stop request again.",
      });
    throw error;
  }
  if (payload.response_url)
    await deps.respond(payload.response_url, {
      response_type: "ephemeral",
      replace_original: false,
      text: "Stopping your request…",
    });
  return "stop_requested";
}
