import { metadata, task } from "@trigger.dev/sdk/v3";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import {
  createSlackUserLinkToken,
  getSlackChannelLink,
  getSlackInstallationByTeamId,
} from "@/lib/slack/installations";
import {
  getSlackBotToken,
  postSlackEphemeral,
  postSlackMessage,
  stripSlackMention,
  updateSlackMessage,
} from "@/lib/slack/client";
import { runChatAgent } from "@/lib/agents/run-chat-agent";
import { buildAppUrl } from "@/lib/app-url";
import { dispatchSlackMentionWorkflows } from "@/lib/flows/trigger-dispatch";
import {
  type SlackEventTaskDeps,
  type SlackEventTaskPayload,
  type SlackEventTaskResult,
  defaultResolveSlackAttribution,
  defaultReserveSlackRepoAgentMonthlyRun,
  defaultReleaseSlackRepoAgentMonthlyRun,
  loadBoundConversation,
  defaultLoadOrCreateConversation,
  defaultPersistConversation,
  defaultStartRepoAgentRun,
  defaultBuildRunUrl,
  hasSlackUserInput,
  loadBoundSlackGroupConversation,
  resolveRepoAgentChannelLink,
  resolveSlackChannelLinkState,
  sendSlackAccountLinkNotice,
  runConversationalMode,
  runRepoAgentMode,
} from "./slack-event-lib";

export const SLACK_EVENT_TASK_MAX_DURATION_SECONDS = 60 * 15;

// Re-export constants for tests
export {
  SLACK_IMAGE_ATTACHMENT_FETCH_TIMEOUT_MS,
  SLACK_IMAGE_ATTACHMENT_MAX_BYTES,
  SLACK_IMAGE_ATTACHMENT_MAX_COUNT,
} from "@/lib/slack/run-attachments";

// Re-export types for external consumers
export type {
  SlackEventAttachment,
  SlackEventAttachmentNotice,
  SlackEventTaskPayload,
  SlackEventTaskResult,
  SlackAttribution,
  SlackRepoAgentRunContext,
  StartRepoAgentRunInput,
  StartRepoAgentRunResult,
  SlackEventTaskDeps,
} from "./slack-event-lib/types";

// Re-export tested functions
export { buildSlackToolExecutionIdempotencyKey } from "./slack-event-lib/modes";
export { createDebouncedSlackUpdater } from "./slack-event-lib/messaging";
export { SlackConversationPersistConflictError } from "./slack-event-lib/conversation";
export { formatSlackConversationalReply } from "./slack-event-lib/system";

const defaultDeps: SlackEventTaskDeps = {
  getInstallation: (teamId) => getSlackInstallationByTeamId(teamId),
  getBotToken: (teamId) => getSlackBotToken(teamId),
  resolveSlackAttribution: defaultResolveSlackAttribution,
  getChannelLink: getSlackChannelLink,
  reserveSlackRepoAgentMonthlyRun: defaultReserveSlackRepoAgentMonthlyRun,
  releaseSlackRepoAgentMonthlyRun: defaultReleaseSlackRepoAgentMonthlyRun,
  now: () => new Date(),
  loadBoundConversation,
  loadOrCreateConversation: defaultLoadOrCreateConversation,
  persistConversation: defaultPersistConversation,
  runAgent: runChatAgent,
  fetchAttachment: ({ botToken, url, signal }) =>
    fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      redirect: "error",
      signal,
    }),
  startRepoAgentRun: defaultStartRepoAgentRun,
  buildRunUrl: defaultBuildRunUrl,
  postMessage: postSlackMessage,
  postEphemeral: postSlackEphemeral,
  updateMessage: updateSlackMessage,
  createUserLinkToken: createSlackUserLinkToken,
  buildSlackLinkUrl: (token) =>
    buildAppUrl(`/slack/link?token=${encodeURIComponent(token)}`).toString(),
};

export async function runSlackEventTask(
  payload: SlackEventTaskPayload,
  overrides: Partial<SlackEventTaskDeps> = {}
): Promise<SlackEventTaskResult> {
  const deps: SlackEventTaskDeps = { ...defaultDeps, ...overrides };

  const installation = await deps.getInstallation(payload.teamId);
  if (!installation) return { outcome: "unknown_workspace" };

  // Defense in depth: webhook already drops bot-authored events, but a future
  // event type might slip through. Never let the bot reply to itself.
  if (payload.slackUserId === installation.bot_user_id) {
    return { outcome: "ignored_self_message" };
  }

  const userText = stripSlackMention(payload.text ?? "");
  if (!hasSlackUserInput(payload, userText)) {
    return { outcome: "skipped_empty_text" };
  }

  const boundGroupConversation = await loadBoundSlackGroupConversation({
    deps,
    installation,
    payload,
  });
  if (boundGroupConversation === null) {
    return { outcome: "ignored_uninvoked_group_message" };
  }

  const botToken = await deps.getBotToken(payload.teamId);
  if (!botToken) return { outcome: "unknown_workspace" };

  const attribution = await deps.resolveSlackAttribution(
    installation,
    payload.slackUserId,
    botToken
  );
  const mogplexUserId = attribution.mogplexUserId;
  if (!mogplexUserId) {
    await sendSlackAccountLinkNotice({
      deps,
      installation,
      botToken,
      payload,
      attribution,
    });
    return {
      outcome: "ignored_no_mogplex_user",
      mogplexUserId: null,
    };
  }

  const channelLink = await resolveRepoAgentChannelLink({
    deps,
    installation,
    payload,
    userText,
  });
  const channelLinkState = resolveSlackChannelLinkState({
    payload,
    userText,
    channelLink,
  });
  if (channelLink) {
    return runRepoAgentMode({
      deps,
      payload,
      botToken,
      mogplexUserId,
      attribution,
      installation,
      channelLink,
      userText,
    });
  }

  return runConversationalMode({
    deps,
    payload,
    installation,
    botToken,
    mogplexUserId,
    attribution,
    userText,
    channelLinkState,
    boundConversation: boundGroupConversation,
  });
}

export const handleSlackEventTask = task({
  id: TRIGGER_TASK_IDS.slackEventHandler,
  maxDuration: SLACK_EVENT_TASK_MAX_DURATION_SECONDS,
  retry: { maxAttempts: 2 },
  run: async (payload: SlackEventTaskPayload) => {
    metadata.set("teamId", payload.teamId);
    metadata.set("eventId", payload.eventId);
    metadata.set("eventType", payload.eventType);
    metadata.set("channelType", payload.channelType);
    const workflowInstallation = await getSlackInstallationByTeamId(
      payload.teamId
    );
    const allowedSlackUsers = workflowInstallation?.allowed_slack_user_ids;
    const canDispatchWorkflow =
      !Array.isArray(allowedSlackUsers) ||
      allowedSlackUsers.includes(payload.slackUserId);
    if (
      payload.eventType === "app_mention" &&
      canDispatchWorkflow &&
      workflowInstallation
    ) {
      const workflowResults = await dispatchSlackMentionWorkflows({
        userId: workflowInstallation.installed_by_user_id,
        teamId: payload.teamId,
        channelId: payload.channelId,
        eventId: payload.eventId,
        slackUserId: payload.slackUserId,
        text: stripSlackMention(payload.text ?? ""),
        messageTs: payload.messageTs,
        threadTs: payload.threadTs,
      });
      const matched = workflowResults.filter((result) => result.matched);
      const runIds = matched.flatMap((result) =>
        result.jobRunId ? [result.jobRunId] : []
      );
      if (matched.length > 0) {
        metadata.set("workflowCount", matched.length);
        metadata.set("workflowRunIds", runIds);
        return {
          outcome:
            runIds.length > 0
              ? ("workflow_runs_started" as const)
              : ("workflow_mention_handled" as const),
          mogplexUserId: workflowInstallation.installed_by_user_id,
          runIds,
        };
      }
    }
    return runSlackEventTask(payload, {
      getInstallation: async () => workflowInstallation,
    });
  },
});
