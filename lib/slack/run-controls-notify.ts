import { buildAppUrl } from "@/lib/app-url";
import {
  buildRepoAgentRunFinishedText,
  buildTextSectionBlocks,
  readSlackRunControlsMetadata,
} from "@/lib/slack/run-controls";
import type { MogplexApiRunStatus } from "@/lib/mogplex-api/runs";
import type { UpdateSlackMessageInput } from "@/lib/slack/client";

type SlackRunControlsNotifyDeps = {
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  updateSlackMessage: (
    botToken: string,
    input: UpdateSlackMessageInput
  ) => Promise<unknown>;
};

async function loadSlackRunControlsNotifyDeps(): Promise<SlackRunControlsNotifyDeps> {
  const { getSlackBotToken, updateSlackMessage } =
    await import("@/lib/slack/client");
  return { getSlackBotToken, updateSlackMessage };
}

/**
 * If `run` was started from Slack (its `metadata` carries the run-controls
 * coordinates), rewrite the originating message to drop the "Cancel run" button
 * and reflect the terminal `status`. No Slack metadata or bot token is a no-op;
 * Slack API failures are left for the caller's best-effort wrapper so each run
 * lifecycle can log the failure in its own context.
 *
 * The Slack client is imported lazily so callers (e.g. `cancelMogplexApiRun`)
 * don't eagerly pull in the Supabase-backed `lib/slack/client` at module load.
 */
export async function stripSlackRunControlsForTerminalRun(
  run: { id: string; metadata: unknown },
  status: MogplexApiRunStatus,
  deps?: SlackRunControlsNotifyDeps
): Promise<void> {
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return;
  const slackDeps = deps ?? (await loadSlackRunControlsNotifyDeps());
  const botToken = await slackDeps.getSlackBotToken(slack.teamId);
  if (!botToken) return;
  const runUrl = buildAppUrl(`/runs/${run.id}`).toString();
  const text = buildRepoAgentRunFinishedText(run.id, runUrl, status);
  const blocks = buildTextSectionBlocks(text);
  if (!blocks) {
    throw new Error("Terminal Slack run-controls text unexpectedly empty");
  }
  await slackDeps.updateSlackMessage(botToken, {
    channel: slack.channelId,
    ts: slack.messageTs,
    text,
    blocks,
  });
}
