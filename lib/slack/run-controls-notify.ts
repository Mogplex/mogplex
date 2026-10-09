import {
  readSlackRunControlsMetadata,
  type SlackRunControlsMetadata,
} from "@/lib/slack/run-controls";
import type { MogplexApiRunStatus } from "@/lib/mogplex-api/runs";
import type {
  PostSlackMessageInput,
  SlackThreadMessage,
  UpdateSlackMessageInput,
} from "@/lib/slack/client";
import {
  buildRunFinishedAnnouncement,
  isRunOutcomeLine,
} from "./run-result-announcement";
import type { RunGuidance } from "./run-guidance-store";
import { buildRunResultMessage } from "./run-result-presentation";
import {
  emptyRunResultEvidence,
  loadRunResultEvidence,
  type RunResultContext,
  type RunResultEvidence,
} from "./run-result-evidence";

type SlackNotifiableRun = RunResultContext;

type SlackRunControlsNotifyDeps = {
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  updateSlackMessage: (
    botToken: string,
    input: UpdateSlackMessageInput
  ) => Promise<unknown>;
  postSlackMessage?: (
    botToken: string,
    input: PostSlackMessageInput
  ) => Promise<unknown>;
  /** Fetch thread replies to check for duplicate announcements. */
  getThreadMessages?: (
    botToken: string,
    input: {
      channel: string;
      threadTs: string;
      oldest?: string;
      limit?: number;
    }
  ) => Promise<SlackThreadMessage[]>;
  /** Fetch channel messages for top-level duplicate-announcement checks. */
  getChannelMessages?: (
    botToken: string,
    input: { channel: string; oldest?: string; limit?: number }
  ) => Promise<SlackThreadMessage[]>;
  /** The agent's own streamed output for the run, oldest first, or null. */
  loadRunOutput?: (run: SlackNotifiableRun) => Promise<string | null>;
  loadGuidance?: (run: SlackNotifiableRun) => Promise<RunGuidance[]>;
  loadEvidence?: (run: SlackNotifiableRun) => Promise<RunResultEvidence>;
};

// Assistant output is persisted as one event per streamed chunk. The Slack
// summary only needs the closing stretch, so read the newest rows and reverse.
const RUN_OUTPUT_EVENT_LIMIT = 400;

async function loadSlackRunControlsNotifyDeps(): Promise<SlackRunControlsNotifyDeps> {
  const {
    getSlackBotToken,
    getSlackChannelMessages,
    getSlackThreadMessages,
    postSlackMessage,
    updateSlackMessage,
  } = await import("@/lib/slack/client");
  return {
    getSlackBotToken,
    updateSlackMessage,
    postSlackMessage,
    getThreadMessages: getSlackThreadMessages,
    getChannelMessages: getSlackChannelMessages,
    loadRunOutput,
    loadEvidence: loadRunResultEvidence,
    loadGuidance: async (run) => {
      const metadata =
        run.metadata && typeof run.metadata === "object"
          ? (run.metadata as Record<string, unknown>)
          : {};
      if (
        metadata.slack_guidance_enabled !== true ||
        !run.user_id ||
        !run.ai_call_id
      )
        return [];
      const { loadRunGuidanceReceipts } = await import("./run-guidance-store");
      return loadRunGuidanceReceipts({
        id: run.id,
        user_id: run.user_id,
        ai_call_id: run.ai_call_id,
      });
    },
  };
}

export async function loadRunOutput(
  run: SlackNotifiableRun
): Promise<string | null> {
  if (!run.ai_call_id || !run.user_id) return null;
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data: final, error: finalError } = await supabaseAdmin
    .from("ai_call_events")
    .select("message")
    .eq("ai_call_id", run.ai_call_id)
    .eq("user_id", run.user_id)
    .eq("event_type", "log")
    .eq("payload->>kind", "assistant_final")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (finalError) throw new Error("Failed to load final run report");
  if (typeof final?.message === "string" && final.message.trim())
    return final.message;
  // Older and interrupted runs may only have streamed telemetry.
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
 * Check if an announcement for this run already exists. A retry after a failed
 * markDelivered would otherwise post a duplicate announcement. The check looks
 * for bot messages containing the announcement's distinctive outcome line
 * (e.g., "Run finished", "Run failed"), excluding the run's own message which
 * also contains the run view link but is not an announcement.
 *
 * For threaded runs (threadTs present), scans thread replies. For top-level
 * runs (no threadTs), scans channel history after the run message.
 */
async function hasExistingAnnouncement(
  input: {
    run: SlackNotifiableRun;
    slack: SlackRunControlsMetadata;
    botToken: string;
  },
  deps: SlackRunControlsNotifyDeps
): Promise<boolean> {
  try {
    const runViewLink = `/runs/${input.run.id}?view=details`;
    const matchAnnouncement = (msg: SlackThreadMessage) =>
      msg.bot_id &&
      msg.ts !== input.slack.messageTs &&
      msg.text?.includes(runViewLink) &&
      isRunOutcomeLine(msg.text ?? "");

    if (input.slack.threadTs && deps.getThreadMessages) {
      // Threaded run: scan thread replies after the run message.
      const messages = await deps.getThreadMessages(input.botToken, {
        channel: input.slack.channelId,
        threadTs: input.slack.threadTs,
        oldest: input.slack.messageTs,
        limit: 200,
      });
      return messages.some(matchAnnouncement);
    }

    if (!input.slack.threadTs && deps.getChannelMessages) {
      // Top-level run: scan channel history after the run message.
      const messages = await deps.getChannelMessages(input.botToken, {
        channel: input.slack.channelId,
        oldest: input.slack.messageTs,
        limit: 200,
      });
      return messages.some(matchAnnouncement);
    }

    // No applicable fetcher available.
    return false;
  } catch (error) {
    // If we cannot check, proceed with the announcement to avoid never
    // announcing. Duplicate announcements are harmless; missing ones are not.
    console.warn(
      "[slack-run-controls] duplicate-announcement check failed",
      input.run.id,
      error
    );
    return false;
  }
}

async function announceRunEnd(
  input: {
    run: SlackNotifiableRun;
    status: MogplexApiRunStatus;
    evidence: RunResultEvidence;
    slack: SlackRunControlsMetadata;
    botToken: string;
  },
  deps: SlackRunControlsNotifyDeps
) {
  if (!deps.postSlackMessage) return;
  // Skip if an announcement for this run already exists (prevents duplicates
  // when markDelivered fails after a successful send and the delivery retries).
  if (await hasExistingAnnouncement(input, deps)) return;
  const { slack } = input;
  await deps.postSlackMessage(input.botToken, {
    channel: slack.channelId,
    ...(slack.threadTs ? { thread_ts: slack.threadTs } : {}),
    text: buildRunFinishedAnnouncement({
      run: input.run,
      status: input.status,
      evidence: input.evidence,
      channelId: slack.channelId,
    }),
  });
}

/**
 * If `run` was started from Slack (its `metadata` carries the run-controls
 * coordinates), rewrite the originating message to drop the "Cancel run" button
 * and reflect the terminal `status`, linking any pull request the agent opened
 * and quoting its closing output. No Slack metadata or bot token is a no-op;
 * Slack API failures are left for the caller's best-effort wrapper so each run
 * lifecycle can log the failure in its own context.
 *
 * With `announce`, a short reply beside the run message then says the run
 * ended: Slack does not notify anyone about an edited message.
 *
 * The Slack client is imported lazily so callers (e.g. `cancelMogplexApiRun`)
 * don't eagerly pull in the Supabase-backed `lib/slack/client` at module load.
 */
export async function stripSlackRunControlsForTerminalRun(
  run: SlackNotifiableRun,
  status: MogplexApiRunStatus,
  deps?: SlackRunControlsNotifyDeps,
  options: { announce?: boolean } = {}
): Promise<boolean> {
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return false;
  const slackDeps = deps ?? (await loadSlackRunControlsNotifyDeps());
  const botToken = await slackDeps.getSlackBotToken(slack.teamId);
  if (!botToken) return false;
  const [output, guidance, evidence] = await Promise.all([
    loadRunOutputBestEffort(run, slackDeps),
    slackDeps.loadGuidance?.(run) ?? [],
    slackDeps.loadEvidence?.(run).catch(() => emptyRunResultEvidence()) ??
      emptyRunResultEvidence(),
  ]);
  const message = buildRunResultMessage({
    run,
    status,
    output,
    guidance,
    evidence,
  });
  await slackDeps.updateSlackMessage(botToken, {
    channel: slack.channelId,
    ts: slack.messageTs,
    ...message,
  });
  if (options.announce) {
    await announceRunEnd({ run, status, evidence, slack, botToken }, slackDeps);
  }
  return true;
}
