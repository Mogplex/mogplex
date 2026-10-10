import { buildAppUrl } from "@/lib/app-url";
import { isUuid } from "@/lib/uuid";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "@/lib/slack/installations";
import { resolveSlackCommandUserId } from "@/lib/slack/command-identity";
import {
  getSlackBotToken,
  openSlackView,
  updateSlackView,
  postSlackEphemeral,
} from "@/lib/slack/client";
import type { SlackBlockActionsPayload } from "@/lib/slack/interactivity";
import type { SlackEventTaskPayload } from "@/trigger/slack-event-lib/types";
import { buildSlackThreadConcurrencyKey } from "@/app/api/webhooks/slack/_lib/event-types";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  checkConnectionRecoveryAccess,
  describeRecoveryConnector,
} from "./access";
import {
  loadConnectionRecoveryRequest,
  markConnectionRecoveryDispatched,
} from "./store";
import {
  CONNECTION_OPEN_ACTION,
  CONNECTION_CONTINUE_ACTION,
  CONNECTION_AUTHORIZE_ACTION,
  CONNECTION_RESTORE_ACTION,
  CONNECTION_SCOPE_ACTION,
  buildConnectionRecoveryModal,
  buildConnectionResumePayload,
} from "./presentation";
import { restoreRecoveryRepository } from "./repository";
import { repairConnectionScope } from "./connection-scope";

async function dispatchContinuation(payload: SlackEventTaskPayload) {
  const { tasks } = await import("@trigger.dev/sdk/v3");
  await tasks.trigger(TRIGGER_TASK_IDS.slackEventHandler, payload, {
    idempotencyKey: payload.eventId,
    concurrencyKey: buildSlackThreadConcurrencyKey(payload),
    tags: [
      `slack-team:${payload.teamId}`,
      `slack-channel:${payload.channelId}`,
      "slack-connection-recovery",
    ],
  });
}

const defaultDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  getBotToken: getSlackBotToken,
  loadRequest: loadConnectionRecoveryRequest,
  markDispatched: markConnectionRecoveryDispatched,
  checkAccess: checkConnectionRecoveryAccess,
  describe: describeRecoveryConnector,
  restoreRepository: restoreRecoveryRepository,
  repairScope: repairConnectionScope,
  openView: openSlackView,
  updateView: updateSlackView,
  postEphemeral: postSlackEphemeral,
  dispatch: dispatchContinuation,
  appUrl: () => buildAppUrl("/").origin,
};

export function isConnectionRecoveryAction(payload: SlackBlockActionsPayload) {
  return (
    payload.actions?.some((action) =>
      [
        CONNECTION_OPEN_ACTION,
        CONNECTION_CONTINUE_ACTION,
        CONNECTION_AUTHORIZE_ACTION,
        CONNECTION_RESTORE_ACTION,
        CONNECTION_SCOPE_ACTION,
      ].includes(action.action_id ?? "")
    ) ?? false
  );
}

export async function handleConnectionRecoveryAction(
  payload: SlackBlockActionsPayload,
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  const action = payload.actions?.find((item) =>
    [
      CONNECTION_OPEN_ACTION,
      CONNECTION_CONTINUE_ACTION,
      CONNECTION_AUTHORIZE_ACTION,
      CONNECTION_RESTORE_ACTION,
      CONNECTION_SCOPE_ACTION,
    ].includes(item.action_id ?? "")
  );
  if (action?.action_id === CONNECTION_AUTHORIZE_ACTION) return "link";
  const requestId = action?.value;
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!requestId || !isUuid(requestId) || !teamId || !slackUserId)
    return "invalid";
  const [installation, botToken] = await Promise.all([
    deps.getInstallation(teamId),
    deps.getBotToken(teamId),
  ]);
  if (!installation || !botToken) return "unknown_workspace";
  const mapping = await deps.getUserMapping({
    installationId: installation.id,
    slackUserId,
  });
  const userId = resolveSlackCommandUserId(installation, mapping, slackUserId);
  if (!userId) return "not_linked";
  const request = await deps.loadRequest(requestId, userId);
  const channelId = payload.channel?.id ?? payload.container?.channel_id;
  if (
    request?.user_id !== userId ||
    request.slack_installation_id !== installation.id ||
    request.payload.teamId !== teamId ||
    request.payload.slackUserId !== slackUserId ||
    (channelId && request.payload.channelId !== channelId) ||
    (payload.view && payload.view.private_metadata !== request.id)
  )
    return "not_owner";
  if (!channelId && !payload.view) return "invalid";
  const baseModalInput = {
    id: request.id,
    target: request.target,
    appUrl: deps.appUrl(),
  };
  if (action?.action_id === CONNECTION_OPEN_ACTION) {
    if (!payload.trigger_id) return "invalid";
    // Slack trigger IDs expire quickly. Open before scope discovery or any
    // provider request, then fill in the current connector state.
    const opened = await deps.openView(botToken, {
      trigger_id: payload.trigger_id,
      view: buildConnectionRecoveryModal({
        ...baseModalInput,
        loading: true,
        status: "Loading connection…",
      }),
    });
    if (opened.view?.id)
      await deps.updateView(botToken, {
        view_id: opened.view.id,
        view: buildConnectionRecoveryModal({
          ...baseModalInput,
          ...(await deps.describe(request)),
          completed: Boolean(request.dispatched_at),
          ...(request.dispatched_at
            ? {
                status:
                  "This request has already been continued. Follow its progress in the original thread.",
              }
            : {}),
        }),
      });
    return "opened";
  }
  const modalInput = { ...baseModalInput, ...(await deps.describe(request)) };

  let status =
    "This request has already been continued. Follow its progress in the original thread.";
  let outcome = "already_dispatched";
  if (!request.dispatched_at) {
    try {
      if (action?.action_id === CONNECTION_RESTORE_ACTION) {
        await deps.restoreRepository(request);
        Object.assign(modalInput, await deps.describe(request));
      }
      if (action?.action_id === CONNECTION_SCOPE_ACTION) {
        await deps.repairScope(request);
        Object.assign(modalInput, await deps.describe(request));
      }
      const checked = await deps.checkAccess(request);
      status = checked.message;
      outcome = "needs_authorization";
      if (checked.ready) {
        // If a delivery fails after Trigger accepts it, the next click reuses
        // this request's idempotency key rather than starting a second turn.
        await deps.dispatch(
          buildConnectionResumePayload({
            id: request.id,
            payload: request.payload,
            resumeText: request.resume_text,
            target: request.target,
            repoId: request.repo_id,
          })
        );
        await deps.markDispatched(request.id, userId);
        status =
          "Access checked. Mogplex is continuing your saved request in the original thread.";
        outcome = "dispatched";
      }
    } catch (error) {
      console.error("[slack] connection recovery failed", {
        requestId: request.id,
        provider: request.target.provider,
        actionId: action?.action_id,
        error:
          error instanceof Error ? error.message : "Unknown recovery error",
      });
      status =
        "Could not finish checking this connection. Try again. Your saved request is still available.";
      outcome = "retry";
    }
  }
  await (payload.view?.id
    ? deps.updateView(botToken, {
        view_id: payload.view.id,
        view: buildConnectionRecoveryModal({
          ...modalInput,
          status,
          completed:
            outcome === "dispatched" || outcome === "already_dispatched",
        }),
      })
    : deps.postEphemeral(botToken, {
        channel: request.payload.channelId,
        user: slackUserId,
        thread_ts: request.payload.threadTs,
        text: status,
      }));
  return outcome;
}
