import { startMogplexApiRun } from "@/lib/mogplex-api/runs";
import { buildAppUrl } from "@/lib/app-url";
import { SLACK_RUN_CONTROLS_METADATA_KEY } from "@/lib/slack/run-controls";
import { SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY } from "@/lib/slack/run-attachments";
import type { StartRepoAgentRunInput, StartRepoAgentRunResult } from "./types";

export async function defaultStartRepoAgentRun(
  input: StartRepoAgentRunInput,
  startRun = startMogplexApiRun
): Promise<StartRepoAgentRunResult> {
  const extraMetadata: Record<string, unknown> = {
    slack: input.slackContext,
    slack_team_id: input.slackContext.teamId,
    slack_installation_id: input.slackContext.installationId,
    slack_mode: input.slackContext.mode,
    slack_user_id: input.slackContext.slackUserId,
    slack_attribution_mode: input.slackContext.attributionMode,
  };
  if (input.slackMessage) {
    extraMetadata[SLACK_RUN_CONTROLS_METADATA_KEY] = input.slackMessage;
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
      harness: "mogplex",
      createBranch: true,
    },
    origin: "slack",
    extraMetadata,
  });
  return { runId: result.run.runId };
}

export function defaultBuildRunUrl(runId: string): string {
  return buildAppUrl(`/runs/${runId}`).toString();
}
