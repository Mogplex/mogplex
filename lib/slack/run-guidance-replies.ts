import { buildAppUrl } from "@/lib/app-url";
import { getSlackBotToken, postSlackMessage } from "./client";
import { SLACK_MESSAGE_TEXT_MAX_CHARS } from "./format";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn";
import {
  loadPendingGuidanceReplies,
  markGuidanceReplyPosted,
} from "./run-guidance-store";

// Slack errors that fail the same way on every retry. The row is marked so
// one unpostable answer is not retried on every later delivery.
const PERMANENT_POST_ERRORS = new Set([
  "channel_not_found",
  "is_archived",
  "not_in_channel",
  "no_text",
  "msg_too_long",
  "thread_not_found",
]);
const SLACK_ERROR_CODE = /failed: (\w+)/;

const defaultDeps = {
  loadReplies: loadPendingGuidanceReplies,
  getToken: getSlackBotToken,
  post: postSlackMessage,
  markPosted: markGuidanceReplyPosted,
};

/** Agent Markdown as Slack text, trimmed by code point with a closed fence. */
export function guidanceReplyText(reply: string, runId: string) {
  const text = markdownToMrkdwn(reply.trim());
  const characters = Array.from(text);
  if (characters.length <= SLACK_MESSAGE_TEXT_MAX_CHARS) return text;
  const runUrl = buildAppUrl(`/runs/${runId}`).toString();
  const link = `<${runUrl}|Read the full reply>`;
  // Room for the ellipsis, a closing fence and the link line.
  const budget = SLACK_MESSAGE_TEXT_MAX_CHARS - Array.from(link).length - 8;
  let kept = characters.slice(0, budget).join("").trimEnd();
  if ((kept.match(/```/g) ?? []).length % 2 === 1) kept += "\n```";
  return `${kept}…\n${link}`;
}

function permanentFailure(error: unknown) {
  const code =
    error instanceof Error ? SLACK_ERROR_CODE.exec(error.message)?.[1] : null;
  return code && PERMANENT_POST_ERRORS.has(code) ? code : null;
}

type ReplyDeps = typeof defaultDeps;
type PendingReply = Awaited<ReturnType<ReplyDeps["loadReplies"]>>[number];

/** Post one answer and record it; a permanent Slack error is recorded too. */
async function postOneReply(
  deps: ReplyDeps,
  token: string,
  run: { id: string; user_id: string },
  reply: PendingReply
): Promise<boolean> {
  const text = guidanceReplyText(reply.reply_text, run.id);
  const mark = (messageTs: string) =>
    deps.markPosted({ id: reply.id, userId: run.user_id, messageTs });
  try {
    if (!text.trim()) {
      await mark("skipped:empty");
      return false;
    }
    const result = await deps.post(token, {
      channel: reply.channel_id,
      thread_ts: reply.thread_ts,
      text,
    });
    await mark(result.ts);
    return true;
  } catch (error) {
    console.warn("[slack-guidance] reply not posted", run.id, reply.id, error);
    const code = permanentFailure(error);
    if (code) await mark(`failed:${code}`).catch(() => undefined);
    return false;
  }
}

/**
 * Answer each guidance message in the Slack thread it came from. Called only by
 * the serialized per-run delivery task. Delivery is at least once: if Slack
 * accepts a post but recording it fails, a later delivery posts it again.
 * Failures are logged and never thrown, so the run card always updates.
 */
export async function postGuidanceReplies(
  run: { id: string; user_id: string },
  teamId: string,
  overrides: Partial<ReplyDeps> = {}
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  try {
    const replies = await deps.loadReplies(run);
    if (replies.length === 0) return 0;
    const token = await deps.getToken(teamId);
    if (!token) {
      console.warn("[slack-guidance] reply waiting for a bot token", run.id);
      return 0;
    }
    let posted = 0;
    for (const reply of replies)
      if (await postOneReply(deps, token, run, reply)) posted += 1;
    return posted;
  } catch (error) {
    console.warn("[slack-guidance] replies unavailable", run.id, error);
    return 0;
  }
}
