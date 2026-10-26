import { buildAppUrl } from "@/lib/app-url";
import { getSlackBotToken, postSlackMessage } from "./client";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn";
import {
  loadPendingGuidanceReplies,
  markGuidanceReplyPosted,
} from "./run-guidance-store";

// A thread reply stays readable; the run page keeps the agent's full text.
const REPLY_CHARACTERS = 3500;

const defaultDeps = {
  loadReplies: loadPendingGuidanceReplies,
  getToken: getSlackBotToken,
  post: postSlackMessage,
  markPosted: markGuidanceReplyPosted,
};

export function guidanceReplyText(reply: string, runId: string) {
  const text = markdownToMrkdwn(reply.trim());
  if (text.length <= REPLY_CHARACTERS) return text;
  const runUrl = buildAppUrl(`/runs/${runId}`).toString();
  return `${text.slice(0, REPLY_CHARACTERS).trimEnd()}…\n<${runUrl}|Read the full reply>`;
}

/**
 * Answer each guidance message in the Slack thread it came from. Called only by
 * the serialized per-run delivery task, so one reply is posted at a time.
 */
export async function postGuidanceReplies(
  run: { id: string; user_id: string },
  teamId: string,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  const replies = await deps.loadReplies(run);
  if (replies.length === 0) return 0;
  const token = await deps.getToken(teamId);
  if (!token) throw new Error("Slack delivery unavailable");
  for (const reply of replies) {
    const posted = await deps.post(token, {
      channel: reply.channel_id,
      thread_ts: reply.thread_ts,
      text: guidanceReplyText(reply.reply_text, run.id),
    });
    await deps.markPosted({
      id: reply.id,
      userId: run.user_id,
      messageTs: posted.ts,
    });
  }
  return replies.length;
}
