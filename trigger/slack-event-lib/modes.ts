import type {
  SlackChannelLinkRow,
  SlackInstallationRow,
} from "@/lib/slack/installations";
import type {
  ConversationRow,
  SlackAttribution,
  SlackChannelLinkState,
  SlackEventTaskDeps,
  SlackEventTaskPayload,
  SlackEventTaskResult,
  SlackThreadContext,
} from "./types";
import { persistConversationTurn } from "./conversation";
import {
  prepareSlackAttachments,
  prepareSlackRepoAgentAttachments,
  buildSlackRepoAgentPrompt,
  buildSlackUserMessage,
} from "./attachments";
import {
  createDebouncedSlackUpdater,
  finalizeSlackUpdaterBestEffort,
  postOrReuseSlackMessage,
  saveSlackTerminalState,
} from "./messaging";
import {
  createSlackAgentProgressHandler,
  SLACK_INITIAL_PROGRESS_TEXT,
} from "./progress";
import {
  getSlackReplyThreadTs,
  resolveSlackConversationLinkState,
  requiresExistingSlackConversation,
} from "./channel-state";
import {
  buildSlackConversationalSystemSuffix,
  fitSlackMessageText,
  formatSlackConversationalReply,
} from "./system";
import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import { launchSlackRepoAgentRun } from "./repo-agent-launch";
import {
  createSlackStartRepoAgentRunTool,
  SLACK_START_REPO_AGENT_RUN_TOOL_NAME,
} from "./repo-agent-tool";
import {
  buildSlackThreadContext,
  getRunChatAgentMessageText,
} from "./thread-context";
import { getSlackConversationThreadTs } from "@/lib/slack/conversation-scope";

// Trigger hard-stops this task at 15 minutes. Abort the model first so the
// normal catch path still has time to replace the Slack placeholder.
export const SLACK_CONVERSATIONAL_AGENT_TIMEOUT_MS = 13 * 60 * 1_000;

async function buildConversationalAgentInput(input: {
  deps: SlackEventTaskDeps;
  mogplexUserId: string;
  conversation: ConversationRow;
  slackThreadContext: SlackThreadContext;
  userMessage: ReturnType<typeof buildSlackUserMessage>["agent"];
  userText: string;
}) {
  const messages = [
    ...input.conversation.messages,
    ...(input.slackThreadContext.contextMessage
      ? [input.slackThreadContext.contextMessage]
      : []),
    input.userMessage,
  ];
  // Newest text first so the most recently named repository wins when a
  // long-lived conversation (a DM channel, say) mentions more than one.
  const priorUserTexts = input.conversation.messages
    .filter((message) => message.role === "user")
    .map(getRunChatAgentMessageText)
    .filter(Boolean);
  const repoContext = await input.deps.resolveRepoContext({
    mogplexUserId: input.mogplexUserId,
    texts: [
      input.userText,
      ...[...input.slackThreadContext.texts].reverse(),
      ...priorUserTexts.reverse(),
    ],
  });

  return { messages, repoContext };
}

async function loadConversationalConversation(input: {
  deps: SlackEventTaskDeps;
  installation: SlackInstallationRow;
  payload: SlackEventTaskPayload;
  mogplexUserId: string;
  boundConversation?: ConversationRow;
}) {
  if (input.boundConversation) return input.boundConversation;
  return input.deps.loadOrCreateConversation({
    installation: input.installation,
    channelId: input.payload.channelId,
    threadTs: getSlackConversationThreadTs(input.payload),
    mogplexUserId: input.mogplexUserId,
    requireExisting: requiresExistingSlackConversation(input.payload),
  });
}

function formatFinalSlackText(input: {
  finalText: string;
  repoName?: string | null;
  userText: string;
}) {
  const sanitized = sanitizeAgentUserFacingText(input.finalText, {
    repoName: input.repoName,
    userRequestText: input.userText,
  });
  return formatSlackConversationalReply(sanitized || "_(no response)_");
}

export function buildSlackToolExecutionIdempotencyKey(
  payload: Pick<SlackEventTaskPayload, "teamId" | "eventId">
): string | null {
  const teamId =
    typeof payload.teamId === "string" ? payload.teamId.trim() : "";
  const eventId =
    typeof payload.eventId === "string" ? payload.eventId.trim() : "";
  return teamId && eventId ? `slack:${teamId}:${eventId}` : null;
}

export async function runConversationalMode(input: {
  deps: SlackEventTaskDeps;
  payload: SlackEventTaskPayload;
  installation: SlackInstallationRow;
  botToken: string;
  mogplexUserId: string;
  attribution: SlackAttribution;
  userText: string;
  channelLinkState: SlackChannelLinkState;
  boundConversation?: ConversationRow;
}): Promise<SlackEventTaskResult> {
  const {
    deps,
    payload,
    installation,
    botToken,
    mogplexUserId,
    attribution,
    userText,
    channelLinkState,
    boundConversation,
  } = input;

  const conversation = await loadConversationalConversation({
    deps,
    installation,
    payload,
    mogplexUserId,
    boundConversation,
  });
  if (!conversation) {
    return {
      outcome: "ignored_unbound_thread_message",
      mogplexUserId,
    };
  }
  const resolvedChannelLinkState = resolveSlackConversationLinkState({
    payload,
    channelLinkState,
  });
  const postThreadTs = getSlackReplyThreadTs(payload);
  const placeholder = await postOrReuseSlackMessage({
    deps,
    botToken,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    postThreadTs,
    eventId: payload.eventId,
    metadataKey: "slackConversationalPlaceholder",
    text: SLACK_INITIAL_PROGRESS_TEXT,
  });
  const progressUpdater = createDebouncedSlackUpdater({
    botToken,
    channel: payload.channelId,
    ts: placeholder.ts,
    updateMessage: deps.updateMessage,
    now: () => deps.now().getTime(),
  });

  let completed: {
    agentResult: Awaited<ReturnType<typeof deps.runAgent>>;
    launchedRunId: string | null;
    attachments: Awaited<ReturnType<typeof prepareSlackAttachments>>;
    userMessage: ReturnType<typeof buildSlackUserMessage>;
    repoName: string | null;
  };
  try {
    const [attachments, slackThreadContext] = await Promise.all([
      prepareSlackAttachments({ deps, botToken, payload }),
      buildSlackThreadContext({
        deps,
        botToken,
        payload,
        conversationMessages: conversation.messages,
      }),
    ]);

    // Hand the agent the full thread history: the runner compacts oversized
    // histories into a checkpoint handoff (and falls back to windowing when a
    // history is small or compaction fails), so reuse of persisted checkpoints
    // needs the stable full prefix. Full history is still persisted by
    // `persistConversationTurn` below.
    const userMessage = buildSlackUserMessage({
      text: userText,
      attachments,
    });
    const agentInput = await buildConversationalAgentInput({
      deps,
      mogplexUserId,
      conversation,
      slackThreadContext,
      userMessage: userMessage.agent,
      userText,
    });
    const repoAgentRun = createSlackStartRepoAgentRunTool({
      deps,
      payload,
      botToken,
      mogplexUserId,
      attribution,
      installation,
      repoContext: agentInput.repoContext,
      userText,
    });
    const selectedModel = await deps.resolveModelPreference?.({
      installationId: installation.id,
      channelId: payload.channelId,
      slackUserId: payload.slackUserId,
      mogplexUserId,
      teamId: agentInput.repoContext?.teamId ?? null,
      conversationModel: conversation.model,
      needsVision: attachments.contentParts.length > 0,
    });
    const agentResult = await deps.runAgent({
      userId: mogplexUserId,
      model: selectedModel ?? conversation.model,
      messages: agentInput.messages,
      latestUserText: userText,
      conversationId: conversation.id,
      repoId: agentInput.repoContext?.repoId,
      repoFullName: agentInput.repoContext?.repoFullName,
      repoOwner: agentInput.repoContext?.repoOwner,
      repoName: agentInput.repoContext?.repoName,
      repoBaseBranch: agentInput.repoContext?.repoBaseBranch,
      teamId: agentInput.repoContext?.teamId,
      // Each Slack event runs exactly one conversational agent pass. Reusing
      // this scope for another pass would intentionally replay matching calls.
      toolExecutionIdempotencyKey:
        buildSlackToolExecutionIdempotencyKey(payload),
      additionalTools: {
        [SLACK_START_REPO_AGENT_RUN_TOOL_NAME]: repoAgentRun.tool,
      },
      systemSuffix: buildSlackConversationalSystemSuffix({
        channelLinkState: resolvedChannelLinkState,
        attribution,
      }),
      abortSignal: AbortSignal.timeout(SLACK_CONVERSATIONAL_AGENT_TIMEOUT_MS),
      onProgress: createSlackAgentProgressHandler(progressUpdater, {
        repoName: agentInput.repoContext?.repoName ?? null,
        userText,
      }),
    });
    completed = {
      agentResult,
      launchedRunId: repoAgentRun.getLaunchedRunId(),
      attachments,
      userMessage,
      repoName: agentInput.repoContext?.repoName ?? null,
    };
  } catch (error) {
    console.error("[slack-event] conversational agent failed", {
      teamId: payload.teamId,
      eventId: payload.eventId,
      error,
    });
    const terminalFailureDelivered = await finalizeSlackUpdaterBestEffort(
      progressUpdater,
      ":warning: Mogplex hit an error while responding. Try again from Slack or open Mogplex for details.",
      "agent error placeholder update"
    );
    if (terminalFailureDelivered) {
      await saveSlackTerminalState("failed");
    }
    throw error;
  }

  const { agentResult, launchedRunId, attachments, userMessage, repoName } =
    completed;

  const finalText = formatFinalSlackText({
    finalText: agentResult.finalText,
    repoName,
    userText,
  });
  const slackFinalText = fitSlackMessageText(finalText);

  await progressUpdater.finalize(slackFinalText);
  await saveSlackTerminalState("delivered");

  await persistConversationTurn({
    deps,
    conversation,
    turnMessages: [
      { role: "user", content: userMessage.persistedText },
      { role: "assistant", content: finalText },
    ],
  });

  return {
    outcome: "conversational_reply",
    conversationId: conversation.id,
    mogplexUserId,
    attachments_attached: attachments.attachedCount,
    attachments_dropped: attachments.droppedCount,
    ...(launchedRunId ? { runId: launchedRunId } : {}),
  };
}

export async function runRepoAgentMode(input: {
  deps: SlackEventTaskDeps;
  payload: SlackEventTaskPayload;
  botToken: string;
  mogplexUserId: string;
  attribution: SlackAttribution;
  installation: SlackInstallationRow;
  channelLink: SlackChannelLinkRow;
  userText: string;
}): Promise<SlackEventTaskResult> {
  const {
    deps,
    payload,
    botToken,
    mogplexUserId,
    attribution,
    installation,
    channelLink,
    userText,
  } = input;

  const attachments = prepareSlackRepoAgentAttachments(payload);
  const prompt = buildSlackRepoAgentPrompt({
    text: userText,
    attachments,
  });
  if (!prompt.trim()) {
    return { outcome: "skipped_empty_text", mogplexUserId };
  }

  const launch = await launchSlackRepoAgentRun({
    deps,
    payload,
    botToken,
    mogplexUserId,
    attribution,
    installation,
    repoId: channelLink.repo_id,
    prompt,
    attachments,
    // Repo-agent mentions come from channel threads, so keep every message
    // grouped under the Slack thread that invoked the agent.
    postThreadTs: payload.threadTs,
  });
  if (!launch.ok) {
    if (launch.kind === "policy_denied") {
      return { outcome: launch.outcome, mogplexUserId };
    }
    if (launch.terminalFailureDelivered) {
      await saveSlackTerminalState("failed");
    }
    throw launch.error;
  }
  await saveSlackTerminalState("delivered");

  return {
    outcome: "repo_agent_run_started",
    mogplexUserId,
    runId: launch.runId,
    attachments_attached: attachments.attachedCount,
    attachments_dropped: attachments.droppedCount,
  };
}
