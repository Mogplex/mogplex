import { normalizeSlackRunImageAttachmentsMetadata } from "@/lib/slack/run-attachments";
import { queueSlackRunDelivery } from "@/lib/slack/run-delivery-queue";
import { postOrReuseSlackMessage } from "./messaging";
import type {
  SlackEventTaskDeps,
  SlackEventTaskPayload,
  SlackEventTaskResult,
} from "./types";
import type { SlackInstallationRow } from "@/lib/slack/installations";

/** A mention in an active run thread must not launch a matching automation. */
export async function resolveGuidanceBeforeWorkflow(
  payload: SlackEventTaskPayload,
  installation: SlackInstallationRow,
  deps: Pick<
    SlackEventTaskDeps,
    "getBotToken" | "resolveSlackAttribution" | "findGuidanceRuns"
  >
) {
  if (
    payload.eventType !== "app_mention" ||
    payload.threadTs === payload.messageTs ||
    payload.slackUserId === installation.bot_user_id
  )
    return null;
  const botToken = await deps.getBotToken(payload.teamId);
  if (!botToken) return null;
  const attribution = await deps.resolveSlackAttribution(
    installation,
    payload.slackUserId,
    botToken
  );
  if (!attribution.mogplexUserId) return null;
  const runs = await deps.findGuidanceRuns({
    userId: attribution.mogplexUserId,
    teamId: payload.teamId,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    slackUserId: payload.slackUserId,
    eventId: payload.eventId,
  });
  return runs.length > 0 ? { runs, attribution, botToken } : null;
}

export async function handleSlackRunGuidance(
  input: {
    deps: SlackEventTaskDeps;
    payload: SlackEventTaskPayload;
    installation: SlackInstallationRow;
    botToken: string;
    userId: string;
    userText: string;
  },
  queue = input.deps.queueRunDelivery ?? queueSlackRunDelivery
): Promise<SlackEventTaskResult | null> {
  const { deps, payload, installation, botToken, userId, userText } = input;
  // Top-level messages remain new conversational turns. The run card explicitly
  // invites a thread reply so unrelated DM requests never steer a running task.
  if (payload.threadTs === payload.messageTs) return null;
  const thread = {
    userId,
    teamId: payload.teamId,
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    slackUserId: payload.slackUserId,
    eventId: payload.eventId,
  };
  const reply = async (text: string) =>
    postOrReuseSlackMessage({
      deps,
      botToken,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      postThreadTs: payload.threadTs,
      eventId: payload.eventId,
      metadataKey: "slackRunGuidanceReceipt",
      text,
    });
  let runs;
  try {
    runs = await deps.findGuidanceRuns(thread);
  } catch {
    await reply(
      "I couldn’t check the active run for this thread. Your guidance has not been sent, and no new run was started. Please try again."
    );
    return { outcome: "run_guidance_unavailable", mogplexUserId: userId };
  }
  if (runs.length === 0) return null;
  if (runs.length > 1) {
    await reply(
      "More than one run is active in this thread. I haven’t sent your guidance or started another run. Open the relevant run in Mogplex to continue."
    );
    return { outcome: "run_guidance_unavailable", mogplexUserId: userId };
  }
  const run = runs[0];
  const allowed = installation.allowed_slack_user_ids;
  if (Array.isArray(allowed) && !allowed.includes(payload.slackUserId)) {
    await reply(
      "Your workspace does not currently allow you to direct repository runs. No guidance was sent."
    );
    return {
      outcome: "repo_agent_user_not_allowed",
      mogplexUserId: userId,
      runId: run.id,
    };
  }
  if (
    run.status === "awaiting_input" ||
    run.harness !== "mogplex" ||
    run.metadata.slack_guidance_enabled !== true
  ) {
    await reply(
      "This run cannot accept live guidance from Slack. Your message has not been applied, and no new run was started. Open the run in Mogplex to review its current state."
    );
    return {
      outcome: "run_guidance_unavailable",
      mogplexUserId: userId,
      runId: run.id,
    };
  }
  const attachments = normalizeSlackRunImageAttachmentsMetadata({
    teamId: payload.teamId,
    files: payload.attachments ?? [],
    droppedCount: payload.attachmentDroppedCount,
  });
  let receipt;
  try {
    receipt = await deps.submitGuidance({
      ...thread,
      runId: run.id,
      aiCallId: run.ai_call_id,
      eventId: payload.eventId,
      messageTs: payload.messageTs,
      body: userText,
      attachments,
    });
  } catch {
    await reply(
      "I couldn’t confirm that your guidance was saved. No new run was started. Check the run card before sending the update again."
    );
    return {
      outcome: "run_guidance_unavailable",
      mogplexUserId: userId,
      runId: run.id,
    };
  }
  if (receipt) {
    try {
      await queue({ runId: run.id, userId });
    } catch {
      console.warn("[slack-guidance] card update pending", run.id);
    }
  }
  if (!receipt || receipt.status === "not_applied") {
    await reply(
      "The run stopped before delivery of this update could be confirmed. Review the result before starting a follow-up; no new run was started."
    );
    return {
      outcome: "run_guidance_not_applied",
      mogplexUserId: userId,
      runId: run.id,
    };
  }
  await reply(
    receipt.status === "delivered"
      ? "This guidance was already supplied to the agent. The run card shows its current progress."
      : "Received. Your guidance is saved for the agent’s next step; the current command may need to finish first. The run card will confirm when it has been supplied."
  );
  return {
    outcome: "run_guidance_received",
    mogplexUserId: userId,
    runId: run.id,
  };
}
