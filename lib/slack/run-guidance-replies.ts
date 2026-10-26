import { buildAppUrl } from "@/lib/app-url";
import { getSlackBotToken, postSlackMessage } from "./client";
import { SLACK_MESSAGE_TEXT_MAX_CHARS } from "./format";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn";
import {
  loadPendingGuidanceReplies,
  markGuidanceReplyPosted,
} from "./run-guidance-store";

// Slack errors that fail the same way on every retry. The row is marked so
// one unpostable answer is not retried on every later delivery. Channel
// access errors stay retryable: re-inviting the bot fixes them.
const PERMANENT_POST_ERRORS = new Set([
  "is_archived",
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
type ReplyGroup = PendingReply & { ids: string[] };

/**
 * Guidance delivered in one step shares the agent's answer. Group rows by
 * thread and text so the thread gets that answer once.
 */
function groupReplies(replies: PendingReply[]): ReplyGroup[] {
  const groups = new Map<string, ReplyGroup>();
  for (const reply of replies) {
    const key = JSON.stringify([
      reply.channel_id,
      reply.thread_ts,
      reply.reply_text,
    ]);
    const group = groups.get(key);
    if (group) group.ids.push(reply.id);
    else groups.set(key, { ...reply, ids: [reply.id] });
  }
  return [...groups.values()];
}

/** Post one answer and record it on every row it answers. */
async function postOneReply(
  deps: ReplyDeps,
  token: string,
  run: { id: string; user_id: string },
  group: ReplyGroup
): Promise<boolean> {
  const mark = (messageTs: string) =>
    Promise.all(
      group.ids.map((id) =>
        deps.markPosted({ id, userId: run.user_id, messageTs })
      )
    );
  try {
    const text = guidanceReplyText(group.reply_text, run.id);
    if (!text.trim()) {
      await mark("skipped:empty");
      return false;
    }
    const result = await deps.post(token, {
      channel: group.channel_id,
      thread_ts: group.thread_ts,
      text,
    });
    await mark(result.ts);
    return true;
  } catch (error) {
    console.warn("[slack-guidance] reply not posted", run.id, group.ids, error);
    const code = permanentFailure(error);
    if (code) await mark(`failed:${code}`).catch(() => undefined);
    return false;
  }
}

/**
 * Answer guidance in the Slack thread it came from. Called only by the
 * serialized per-run delivery task. Delivery is at least once: if Slack
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
    for (const group of groupReplies(replies))
      if (await postOneReply(deps, token, run, group)) posted += 1;
    return posted;
  } catch (error) {
    console.warn("[slack-guidance] replies unavailable", run.id, error);
    return 0;
  }
}
