import { buildAppUrl } from "@/lib/app-url";
import {
  buildRepoAgentRunFinishedText,
  buildTextSectionBlocks,
  readSlackRunControlsMetadata,
} from "@/lib/slack/run-controls";
import { buildRepoAgentRunResultText } from "@/lib/slack/run-output-summary";
import type { MogplexApiRunStatus } from "@/lib/mogplex-api/runs";
import type { UpdateSlackMessageInput } from "@/lib/slack/client";

type SlackNotifiableRun = {
  id: string;
  metadata: unknown;
  ai_call_id?: string | null;
  user_id?: string | null;
};

type SlackRunControlsNotifyDeps = {
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  updateSlackMessage: (
    botToken: string,
    input: UpdateSlackMessageInput
  ) => Promise<unknown>;
  /** The agent's own streamed output for the run, oldest first, or null. */
  loadRunOutput?: (run: SlackNotifiableRun) => Promise<string | null>;
};

// Assistant output is persisted as one event per streamed chunk. The Slack
// summary only needs the closing stretch, so read the newest rows and reverse.
const RUN_OUTPUT_EVENT_LIMIT = 400;

async function loadSlackRunControlsNotifyDeps(): Promise<SlackRunControlsNotifyDeps> {
  const { getSlackBotToken, updateSlackMessage } =
    await import("@/lib/slack/client");
  return { getSlackBotToken, updateSlackMessage, loadRunOutput };
}

async function loadRunOutput(run: SlackNotifiableRun): Promise<string | null> {
  if (!run.ai_call_id || !run.user_id) return null;
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("ai_call_events")
    .select("message, created_at, id")
    .eq("ai_call_id", run.ai_call_id)
    .eq("user_id", run.user_id)
    .eq("event_type", "log")
    .eq("payload->>kind", "assistant_delta")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RUN_OUTPUT_EVENT_LIMIT);
  if (error) {
    throw new Error(`Failed to load run output for Slack: ${error.message}`);
  }
  const text = (data ?? [])
    .reverse()
    .map((row) => (typeof row.message === "string" ? row.message : ""))
    .join("");
  return text.trim() ? text : null;
}

async function loadRunOutputBestEffort(
  run: SlackNotifiableRun,
  deps: SlackRunControlsNotifyDeps
) {
  if (!deps.loadRunOutput) return null;
  try {
    return await deps.loadRunOutput(run);
  } catch (error) {
    console.warn("[slack-run-controls] run output unavailable", run.id, error);
    return null;
  }
}

/**
 * If `run` was started from Slack (its `metadata` carries the run-controls
 * coordinates), rewrite the originating message to drop the "Cancel run" button
 * and reflect the terminal `status`, linking any pull request the agent opened
 * and quoting its closing output. No Slack metadata or bot token is a no-op;
 * Slack API failures are left for the caller's best-effort wrapper so each run
 * lifecycle can log the failure in its own context.
 *
 * The Slack client is imported lazily so callers (e.g. `cancelMogplexApiRun`)
 * don't eagerly pull in the Supabase-backed `lib/slack/client` at module load.
 */
export async function stripSlackRunControlsForTerminalRun(
  run: SlackNotifiableRun,
  status: MogplexApiRunStatus,
  deps?: SlackRunControlsNotifyDeps
): Promise<void> {
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return;
  const slackDeps = deps ?? (await loadSlackRunControlsNotifyDeps());
  const botToken = await slackDeps.getSlackBotToken(slack.teamId);
  if (!botToken) return;
  const runUrl = buildAppUrl(`/runs/${run.id}`).toString();
  const statusLine = buildRepoAgentRunFinishedText(run.id, runUrl, status);
  const text = buildRepoAgentRunResultText({
    statusLine,
    output:
      status === "success"
        ? await loadRunOutputBestEffort(run, slackDeps)
        : null,
  });
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
