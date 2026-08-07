import type {
  SlackChannelLinkRow,
  SlackInstallationRow,
} from "@/lib/slack/installations";
import { windowMessages } from "@/lib/agents/message-window";
import {
  buildCancelRunActionsBlock,
  buildRepoAgentRunStartedText,
} from "@/lib/slack/run-controls";
import type {
  ConversationRow,
  SlackAttribution,
  SlackChannelLinkState,
  SlackEventTaskDeps,
  SlackEventTaskPayload,
  SlackEventTaskResult,
  StartRepoAgentRunResult,
} from "./types";
import { persistConversationTurn } from "./conversation";
import {
  prepareSlackAttachments,
  prepareSlackRepoAgentAttachments,
  buildSlackRepoAgentPrompt,
  buildSlackUserMessage,
} from "./attachments";
import {
  postOrReuseSlackMessage,
  updateMessageBestEffort,
  postMessageBestEffort,
} from "./messaging";
import {
  getSlackReplyThreadTs,
  resolveSlackConversationLinkState,
  requiresExistingSlackConversation,
} from "./channel-state";
import {
  buildSlackConversationalSystemSuffix,
  formatSlackConversationalReply,
} from "./system";
import { evaluateSlackRepoAgentPolicy } from "./policy";
import { releaseSlackRepoAgentQuotaReservationBestEffort } from "./quota";

/** A blank/empty Slack message is rejected - always send something. */
const PLACEHOLDER_TEXT = "_Thinking..._";

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

  const conversation =
    boundConversation ??
    (await deps.loadOrCreateConversation({
      installation,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      mogplexUserId,
      requireExisting: requiresExistingSlackConversation(payload),
    }));
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
  const attachments = await prepareSlackAttachments({
    deps,
    botToken,
    payload,
  });

  const placeholder = await postOrReuseSlackMessage({
    deps,
    botToken,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    postThreadTs,
    eventId: payload.eventId,
    metadataKey: "slackConversationalPlaceholder",
    text: PLACEHOLDER_TEXT,
  });

  // Window the thread history before sending it to the agent - a long Slack
  // thread would otherwise grow the prompt unbounded. Full history is still
  // persisted by `persistConversationTurn` below.
  const userMessage = buildSlackUserMessage({
    text: userText,
    attachments,
  });
  const messages = windowMessages([
    ...conversation.messages,
    userMessage.agent,
  ]);

  let agentResult: Awaited<ReturnType<typeof deps.runAgent>>;
  try {
    agentResult = await deps.runAgent({
      userId: mogplexUserId,
      messages,
      conversationId: conversation.id,
      // Each Slack event runs exactly one conversational agent pass. Reusing
      // this scope for another pass would intentionally replay matching calls.
      toolExecutionIdempotencyKey:
        buildSlackToolExecutionIdempotencyKey(payload),
      systemSuffix: buildSlackConversationalSystemSuffix({
        channelLinkState: resolvedChannelLinkState,
        attribution,
      }),
    });
  } catch (error) {
    console.error("[slack-event] conversational agent failed", {
      teamId: payload.teamId,
      eventId: payload.eventId,
      error,
    });
    await updateMessageBestEffort(
      deps,
      botToken,
      {
        channel: payload.channelId,
        ts: placeholder.ts,
        text: ":warning: Mogplex hit an error while responding. Try again from Slack or open Mogplex for details.",
      },
      "agent error placeholder update"
    );
    throw error;
  }

  const finalText = formatSlackConversationalReply(
    agentResult.finalText || "_(no response)_"
  );

  await deps.updateMessage(botToken, {
    channel: payload.channelId,
    ts: placeholder.ts,
    text: finalText,
  });

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

  const policy = await evaluateSlackRepoAgentPolicy({
    deps,
    eventId: payload.eventId,
    installation,
    slackUserId: payload.slackUserId,
  });
  if (!policy.allowed) {
    // Repo-agent policy denials originate from app_mention events, so keep the
    // notice grouped under the Slack thread that invoked the agent.
    await deps.postMessage(botToken, {
      channel: payload.channelId,
      thread_ts: payload.threadTs,
      text: policy.message,
    });
    return {
      outcome: policy.outcome,
      mogplexUserId,
    };
  }

  const attachments = prepareSlackRepoAgentAttachments(payload);
  const prompt = buildSlackRepoAgentPrompt({
    text: userText,
    attachments,
  });
  if (!prompt.trim()) {
    return { outcome: "skipped_empty_text", mogplexUserId };
  }

  let placeholder: { channel: string; ts: string } | null = null;
  let runStart: StartRepoAgentRunResult;
  try {
    const postedPlaceholder = await postOrReuseSlackMessage({
      deps,
      botToken,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      postThreadTs: payload.threadTs,
      eventId: payload.eventId,
      metadataKey: "slackRepoAgentPlaceholder",
      text: ":robot_face: Starting repo agent run...",
    });
    placeholder = postedPlaceholder;

    runStart = await deps.startRepoAgentRun({
      mogplexUserId,
      repoId: channelLink.repo_id,
      prompt,
      // Slack `event_id` is unique per delivery - reuse so retries dedupe.
      idempotencyKey: `slack:${payload.eventId}`,
      slackContext: {
        mode: "repo_agent",
        teamId: payload.teamId,
        installationId: installation.id,
        channelId: payload.channelId,
        slackUserId: payload.slackUserId,
        slackEmail: attribution.slackEmail,
        attributionMode: attribution.mode,
      },
      slackMessage: {
        teamId: payload.teamId,
        channelId: payload.channelId,
        messageTs: postedPlaceholder.ts,
      },
      slackAttachments: attachments.files,
      slackAttachmentDroppedCount: attachments.droppedCount,
    });
  } catch (error) {
    console.error("[slack-event] repo-agent start failed", {
      teamId: payload.teamId,
      eventId: payload.eventId,
      error,
    });
    const message =
      ":warning: Couldn't start the run. Open Mogplex for details or try again.";
    if (policy.quotaReservation) {
      // Release before notifying; both steps are best-effort and swallow failures.
      await releaseSlackRepoAgentQuotaReservationBestEffort(
        deps,
        policy.quotaReservation
      );
    }
    await (placeholder
      ? updateMessageBestEffort(
          deps,
          botToken,
          {
            channel: payload.channelId,
            ts: placeholder.ts,
            text: message,
          },
          "repo-agent error placeholder update"
        )
      : postMessageBestEffort(
          deps,
          botToken,
          {
            channel: payload.channelId,
            thread_ts: payload.threadTs,
            text: message,
          },
          "repo-agent error notice"
        ));
    throw error;
  }

  if (!placeholder) {
    throw new Error("Slack repo-agent placeholder was not created");
  }

  const runUrl = deps.buildRunUrl(runStart.runId);
  const startedText = buildRepoAgentRunStartedText(runStart.runId, runUrl);
  await deps.updateMessage(botToken, {
    channel: payload.channelId,
    ts: placeholder.ts,
    text: startedText,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: startedText } },
      // This block is stripped either reactively (the interactivity handler,
      // when the button is clicked on a finished run / once a cancel is in
      // flight - see `removeCancelButton` in lib/slack/interactivity.ts) or
      // proactively by the run-completion hook in lib/mogplex-api/run-execution.ts.
      buildCancelRunActionsBlock(runStart.runId),
    ],
  });

  return {
    outcome: "repo_agent_run_started",
    mogplexUserId,
    runId: runStart.runId,
    attachments_attached: attachments.attachedCount,
    attachments_dropped: attachments.droppedCount,
  };
}
