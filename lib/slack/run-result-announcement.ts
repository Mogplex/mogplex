import { buildAppUrl } from "@/lib/app-url";
import { escapeMrkdwn } from "./markdown-to-mrkdwn";
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

function requesterMention(run: RunResultContext, channelId: string) {
  // Everything in a DM notifies; in a channel, only a mention is sure to.
  if (channelId.startsWith("D")) return "";
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
