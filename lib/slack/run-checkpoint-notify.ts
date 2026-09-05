import { buildAppUrl } from "@/lib/app-url";
import {
  buildTextSectionBlocks,
  readSlackRunControlsMetadata,
} from "@/lib/slack/run-controls";
import type { HarnessCheckpoint } from "@/lib/harness/checkpoint";
import type { PostSlackMessageInput } from "@/lib/slack/client";
import { progressText } from "./run-progress-state";

type SlackNotifiableRun = {
  id: string;
  metadata: unknown;
  user_id?: string;
};

type SlackRunCheckpointNotifyDeps = {
  queueUpdate?: (input: { runId: string; userId: string }) => Promise<void>;
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  postSlackMessage: (
    botToken: string,
    input: PostSlackMessageInput
  ) => Promise<unknown>;
};

async function loadSlackRunCheckpointNotifyDeps(): Promise<SlackRunCheckpointNotifyDeps> {
  const { getSlackBotToken, postSlackMessage } =
    await import("@/lib/slack/client");
  const { queueSlackRunDelivery } = await import("./run-delivery-queue");
  return {
    getSlackBotToken,
    postSlackMessage,
    queueUpdate: queueSlackRunDelivery,
  };
}

/** The user-facing checkpoint message: what happened, where to look, how to steer. */
export function buildRunCheckpointText(input: {
  runId: string;
  runUrl: string;
  checkpoint: HarnessCheckpoint;
}): string {
  const lines = ["⏸️ *Paused for your review.*"];
  if (input.checkpoint.summary) {
    lines.push("", progressText(input.checkpoint.summary, 1000));
  }
  if (input.checkpoint.previewUrl) {
    const url = input.checkpoint.previewUrl;
    if (/^https:\/\/[^\s<>]+$/.test(url))
      lines.push("", `*Agent-reported preview:* ${url}`);
  }
  lines.push(
    "",
    "Review the work in Mogplex before continuing. Slack replies do not restart a paused run.",
    `<${input.runUrl}|View run>`
  );
  return lines.join("\n");
}

/**
 * If `run` was started from Slack, post a thread reply announcing that the run
 * paused at a checkpoint: the agent's summary, the dev-server preview URL, and
 * a link to inspect it. The serialized writer also updates the originating card
 * to remove its active-work state. A marker is not proof of saved files.
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
  if (run.user_id)
    await slackDeps.queueUpdate?.({ runId: run.id, userId: run.user_id });
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
    thread_ts:
      run.metadata &&
      typeof run.metadata === "object" &&
      typeof (run.metadata as Record<string, unknown>).slack_thread_ts ===
        "string"
        ? (run.metadata as Record<string, string>).slack_thread_ts
        : slack.messageTs,
    text,
    blocks,
  });
}
