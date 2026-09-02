import type { SlackInstallationRow } from "@/lib/slack/installations";
import {
  buildCancelRunActionsBlock,
  buildRepoAgentRunStartedText,
} from "@/lib/slack/run-controls";
import type {
  PreparedSlackRepoAgentAttachments,
  SlackAttribution,
  SlackEventTaskDeps,
  SlackEventTaskPayload,
  SlackEventTaskResult,
  StartRepoAgentRunResult,
} from "./types";
import {
  postOrReuseSlackMessage,
  updateMessageBestEffort,
  postMessageBestEffort,
} from "./messaging";
import { evaluateSlackRepoAgentPolicy } from "./policy";
import { releaseSlackRepoAgentQuotaReservationBestEffort } from "./quota";

export type SlackRepoAgentLaunchResult =
  | {
      ok: true;
      runId: string;
      runUrl: string;
      placeholder: { channel: string; ts: string };
    }
  | {
      ok: false;
      kind: "policy_denied";
      outcome: SlackEventTaskResult["outcome"];
      message: string;
    }
  | {
      ok: false;
      kind: "start_failed";
      error: unknown;
      terminalFailureDelivered: boolean;
    };

/**
 * Start a full repo-agent run from a Slack event: enforce the workspace's
 * repo-agent policy, post the run status message (with its "Cancel run"
 * button), and hand the prompt to the Mogplex runs API. Shared by linked
 * channel mentions and the conversational `start_repo_agent_run` tool so both
 * entry points behave identically.
 */
export async function launchSlackRepoAgentRun(input: {
  deps: SlackEventTaskDeps;
  payload: SlackEventTaskPayload;
  botToken: string;
  mogplexUserId: string;
  attribution: SlackAttribution;
  installation: SlackInstallationRow;
  repoId: string;
  prompt: string;
  attachments: PreparedSlackRepoAgentAttachments;
  /** Slack `thread_ts` for every message this launch posts. Omit for DMs. */
  postThreadTs: string | undefined;
}): Promise<SlackRepoAgentLaunchResult> {
  const {
    deps,
    payload,
    botToken,
    mogplexUserId,
    attribution,
    installation,
    attachments,
    postThreadTs,
  } = input;

  const policy = await evaluateSlackRepoAgentPolicy({
    deps,
    eventId: payload.eventId,
    installation,
    slackUserId: payload.slackUserId,
  });
  if (!policy.allowed) {
    await deps.postMessage(botToken, {
      channel: payload.channelId,
      thread_ts: postThreadTs,
      text: policy.message,
    });
    return {
      ok: false,
      kind: "policy_denied",
      outcome: policy.outcome,
      message: policy.message,
    };
  }

  let placeholder: { channel: string; ts: string } | null = null;
  let runStart: StartRepoAgentRunResult;
  try {
    placeholder = await postOrReuseSlackMessage({
      deps,
      botToken,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      postThreadTs,
      eventId: payload.eventId,
      metadataKey: "slackRepoAgentPlaceholder",
      text: ":robot_face: Starting repo agent run...",
    });

    runStart = await deps.startRepoAgentRun({
      mogplexUserId,
      repoId: input.repoId,
      prompt: input.prompt,
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
        messageTs: placeholder.ts,
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
    const terminalFailureDelivered = await (placeholder
      ? updateMessageBestEffort(
          deps,
          botToken,
          { channel: payload.channelId, ts: placeholder.ts, text: message },
          "repo-agent error placeholder update"
        )
      : postMessageBestEffort(
          deps,
          botToken,
          {
            channel: payload.channelId,
            thread_ts: postThreadTs,
            text: message,
          },
          "repo-agent error notice"
        ));
    return { ok: false, kind: "start_failed", error, terminalFailureDelivered };
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

  return { ok: true, runId: runStart.runId, runUrl, placeholder };
}
