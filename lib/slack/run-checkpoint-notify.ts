import { buildAppUrl } from "@/lib/app-url";
import {
  buildTextSectionBlocks,
  readSlackRunControlsMetadata,
} from "@/lib/slack/run-controls";
import type { HarnessCheckpoint } from "@/lib/harness/checkpoint";
import type { PostSlackMessageInput } from "@/lib/slack/client";

type SlackNotifiableRun = {
  id: string;
  metadata: unknown;
};

type SlackRunCheckpointNotifyDeps = {
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  postSlackMessage: (
    botToken: string,
    input: PostSlackMessageInput
  ) => Promise<unknown>;
};

async function loadSlackRunCheckpointNotifyDeps(): Promise<SlackRunCheckpointNotifyDeps> {
  const { getSlackBotToken, postSlackMessage } =
    await import("@/lib/slack/client");
  return { getSlackBotToken, postSlackMessage };
}

/** The user-facing checkpoint message: what happened, where to look, how to steer. */
export function buildRunCheckpointText(input: {
  runId: string;
  runUrl: string;
  checkpoint: HarnessCheckpoint;
}): string {
  const lines = ["⏸️ *Paused for your review.*"];
  if (input.checkpoint.summary) {
    lines.push("", input.checkpoint.summary);
  }
  if (input.checkpoint.previewUrl) {
    lines.push("", `*Preview:* ${input.checkpoint.previewUrl}`);
  }
  lines.push(
    "",
    "Reply in this thread to steer, or say *ship it* to open the pull request.",
    `<${input.runUrl}|View run>`
  );
  return lines.join("\n");
}

/**
 * If `run` was started from Slack, post a thread reply announcing that the run
 * paused at a checkpoint: the agent's summary, the dev-server preview URL, and
 * an invitation to steer or approve. The originating message keeps its "Cancel
 * run" button so the user can still stop the paused run.
 *
 * No Slack metadata or bot token is a no-op; the caller wraps this best-effort
 * so a Slack failure never changes the run's status.
 *
 * The Slack client is imported lazily so non-Slack callers don't eagerly pull
 * in the Supabase-backed `lib/slack/client` at module load.
 */
export async function notifySlackRunCheckpoint(
  run: SlackNotifiableRun,
  checkpoint: HarnessCheckpoint,
  deps?: SlackRunCheckpointNotifyDeps
): Promise<void> {
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return;
  const slackDeps = deps ?? (await loadSlackRunCheckpointNotifyDeps());
  const botToken = await slackDeps.getSlackBotToken(slack.teamId);
  if (!botToken) return;
  const runUrl = buildAppUrl(`/runs/${run.id}`).toString();
  const text = buildRunCheckpointText({ runId: run.id, runUrl, checkpoint });
  const blocks = buildTextSectionBlocks(text);
  if (!blocks) {
    throw new Error("Checkpoint Slack text unexpectedly empty");
  }
  await slackDeps.postSlackMessage(botToken, {
    channel: slack.channelId,
    thread_ts: slack.messageTs,
    text,
    blocks,
  });
}
