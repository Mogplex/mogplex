import { startMogplexApiRun } from "@/lib/mogplex-api/runs";
import { buildAppUrl } from "@/lib/app-url";
import { SLACK_RUN_CONTROLS_METADATA_KEY } from "@/lib/slack/run-controls";
import { SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY } from "@/lib/slack/run-attachments";
import type { StartRepoAgentRunInput, StartRepoAgentRunResult } from "./types";
import {
  getSlackAgentPreference,
  getSlackHarnessPreference,
} from "@/lib/slack/harness-preferences";
import { queueSlackRunDelivery } from "@/lib/slack/run-delivery-queue";
import { getSlackModelPreference } from "@/lib/slack/model-preferences";

export async function defaultStartRepoAgentRun(
  input: StartRepoAgentRunInput,
  startRun = startMogplexApiRun,
  getHarnessPreference = getSlackHarnessPreference,
  queueDelivery = queueSlackRunDelivery,
  getAgentPreference = getSlackAgentPreference,
  getModelPreference: (
    scope: Parameters<typeof getSlackModelPreference>[0]
  ) => Promise<{ model_id: string } | null> = getSlackModelPreference
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

  const preferenceScope = {
    installationId: input.slackContext.installationId,
    channelId: input.slackContext.channelId,
    slackUserId: input.slackContext.slackUserId,
  };
  const [savedHarness, agentId, modelPreference] = await Promise.all([
    getHarnessPreference(preferenceScope),
    getAgentPreference(preferenceScope),
    getModelPreference(preferenceScope),
  ]);
  const harness = savedHarness ?? "mogplex";
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
      ...(agentId ? { agentId } : {}),
      ...(input.branch
        ? {
            workingBranch: input.branch.working,
            baseBranch: input.branch.base,
            createBranch: false,
          }
        : { createBranch: true }),
    },
    origin: "slack",
    extraMetadata: {
      ...extraMetadata,
      ...(harness === "mogplex" && modelPreference
        ? { slack_model_id: modelPreference.model_id }
        : {}),
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
