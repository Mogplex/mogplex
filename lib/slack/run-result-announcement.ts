import { buildAppUrl } from "@/lib/app-url";
import { isDirectChannelType } from "./channel-types";
import { escapeMrkdwn } from "./markdown-to-mrkdwn";
import { readSlackRunControlsMetadata } from "./run-controls";
import { runProgressTitle } from "./run-progress-presentation";
import { progressText } from "./run-progress-state";
import { readRunProgressSnapshot } from "./run-progress-store";
import type {
  RunResultContext,
  RunResultEvidence,
} from "./run-result-evidence";

const SLACK_USER_ID = /^[UW][A-Z0-9]+$/;

const OUTCOMES: Record<string, string> = {
  success: "✅ Run finished",
  failed: "❌ Run failed",
  cancelled: "⏹️ Run cancelled",
};

/** Outcome verbs for pattern matching against announcement text. Includes
 * "ended" for forward-compatibility with the fallback outcome text. */
const OUTCOME_VERBS = ["finished", "failed", "cancelled", "ended"] as const;

/**
 * Test whether `text` looks like an announcement outcome line. Used by the
 * duplicate-announcement check in run-controls-notify.ts to stay in sync with
 * the OUTCOMES map above.
 */
export function isRunOutcomeLine(text: string): boolean {
  return OUTCOME_VERBS.some((verb) => text.includes(`Run ${verb}`));
}

/** Whether this is a direct conversation where replies notify everyone. */
function isDirectConversation(run: RunResultContext, channelId: string) {
  const slack = readSlackRunControlsMetadata(run.metadata);
  // Prefer the stored channel type when available.
  if (isDirectChannelType(slack?.channelType)) {
    return true;
  }
  if (slack?.channelType) {
    // Explicitly not a direct channel type.
    return false;
  }
  // Fallback for runs created before channelType was stored: D prefix = 1:1 DM.
  // This misses group DMs (mpim), but those older runs would have had the same
  // behavior, so the fallback keeps compatibility without changing expectations.
  return channelId.startsWith("D");
}

function requesterMention(run: RunResultContext, channelId: string) {
  // Everything in a DM notifies; in a channel, only a mention is sure to.
  if (isDirectConversation(run, channelId)) return "";
  const metadata =
    run.metadata && typeof run.metadata === "object"
      ? (run.metadata as Record<string, unknown>)
      : {};
  const userId = metadata.slack_user_id;
  return typeof userId === "string" && SLACK_USER_ID.test(userId)
    ? `<@${userId}> `
    : "";
}

function artifactLine(evidence: RunResultEvidence) {
  const pr = evidence.github.pullRequests[0];
  if (pr) {
    return `Pull request #${pr.number} (${pr.state}): ${escapeMrkdwn(pr.url)}`;
  }
  if (evidence.github.branch) {
    return `Pushed branch: ${escapeMrkdwn(evidence.github.branch.url)}`;
  }
  return evidence.github.checked
    ? "No pull request or pushed branch was found."
    : "GitHub could not be checked for a pull request or branch.";
}

/**
 * A short reply posted when a Slack-started run ends. Editing the run message
 * sends no notification, so this is what tells the requester the run is done
 * and where it landed. The full report stays on the run message.
 */
export function buildRunFinishedAnnouncement(input: {
  run: RunResultContext;
  status: string;
  evidence: RunResultEvidence;
  channelId: string;
}) {
  const { run, status, evidence } = input;
  const outcome = OUTCOMES[status] ?? `Run ended (${progressText(status, 40)})`;
  const title = escapeMrkdwn(
    runProgressTitle({
      id: run.id,
      metadata: run.metadata,
      prompt: run.prompt,
    })
  );
  const lines = [
    `${requesterMention(run, input.channelId)}*${outcome}:* ${title}`,
    artifactLine(evidence),
  ];
  const summary = readRunProgressSnapshot(run.slack_progress)?.summary;
  if (status !== "success" && summary) {
    lines.push(`Last update: ${escapeMrkdwn(progressText(summary, 240))}`);
  }
  const runUrl = buildAppUrl(`/runs/${run.id}?view=details`).toString();
  lines.push(`Full report is on the run message above · <${runUrl}|View run>`);
  return lines.join("\n");
}
