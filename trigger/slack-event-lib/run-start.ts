import { startMogplexApiRun } from "@/lib/mogplex-api/runs";
import { buildAppUrl } from "@/lib/app-url";
import { SLACK_RUN_CONTROLS_METADATA_KEY } from "@/lib/slack/run-controls";
import { SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY } from "@/lib/slack/run-attachments";
import type { StartRepoAgentRunInput, StartRepoAgentRunResult } from "./types";
import { getSlackHarnessPreference } from "@/lib/slack/harness-preferences";
import { queueSlackRunDelivery } from "@/lib/slack/run-delivery-queue";

export async function defaultStartRepoAgentRun(
  input: StartRepoAgentRunInput,
  startRun = startMogplexApiRun,
  getHarnessPreference = getSlackHarnessPreference,
  queueDelivery = queueSlackRunDelivery
): Promise<StartRepoAgentRunResult> {
  const extraMetadata: Record<string, unknown> = {
    slack_task_title: input.taskTitle ?? input.prompt.split("\n")[0],
    slack: input.slackContext,
    slack_team_id: input.slackContext.teamId,
    slack_installation_id: input.slackContext.installationId,
    slack_mode: input.slackContext.mode,
    slack_user_id: input.slackContext.slackUserId,
    slack_attribution_mode: input.slackContext.attributionMode,
  };
  if (input.slackMessage) {
    extraMetadata[SLACK_RUN_CONTROLS_METADATA_KEY] = input.slackMessage;
    extraMetadata.slack_thread_ts =
      input.slackMessage.threadTs ?? input.slackMessage.messageTs;
  }
  if (input.slackAttachments?.length) {
    extraMetadata[SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY] = {
      teamId: input.slackContext.teamId,
      files: input.slackAttachments,
      ...(input.slackAttachmentDroppedCount
        ? { droppedCount: input.slackAttachmentDroppedCount }
        : {}),
    };
  }

  const harness =
    (await getHarnessPreference({
      installationId: input.slackContext.installationId,
      channelId: input.slackContext.channelId,
      slackUserId: input.slackContext.slackUserId,
    })) ?? "mogplex";
  const result = await startRun({
    user: {
      userId: input.mogplexUserId,
      keyId: "slack-bot",
      scopes: ["runs:write"],
    },
    idempotencyKey: input.idempotencyKey,
    body: {
      repoId: input.repoId,
      prompt: input.prompt,
      harness,
      createBranch: true,
    },
    origin: "slack",
    extraMetadata: {
      ...extraMetadata,
      slack_guidance_enabled:
        harness === "mogplex" && Boolean(input.slackMessage),
    },
  });
  try {
    await queueDelivery({
      runId: result.run.runId,
      userId: input.mogplexUserId,
    });
  } catch {
    // The run is already accepted. A notification failure must not be reported
    // as a failed launch or encourage a duplicate task; later progress retries.
    console.warn(
      "[slack-run-start] initial status delivery unavailable",
      result.run.runId
    );
  }
  return { runId: result.run.runId, statusCardManaged: true };
}

export function defaultBuildRunUrl(runId: string): string {
  return buildAppUrl(`/runs/${runId}`).toString();
}
