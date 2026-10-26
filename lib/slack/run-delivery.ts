import { loadRunById } from "@/lib/mogplex-api/runs-db";
import { setTimeout as delay } from "node:timers/promises";
import {
  markTerminalSlackDelivery,
  terminalSlackDeliveryKey,
} from "@/lib/mogplex-api/run-terminal-notification";
import { stripSlackRunControlsForTerminalRun } from "./run-controls-notify";
import { getSlackBotToken, updateSlackMessage } from "./client";
import { readSlackRunControlsMetadata } from "./run-controls";
import { buildRunProgressMessage } from "./run-progress-presentation";
import { createRunProgressState } from "./run-progress-state";
import {
  readRunProgressSnapshot,
  markRunProgressDelivered,
} from "./run-progress-store";
import type { RunDeliveryPayload } from "./run-delivery-queue";
import { loadRunGuidanceReceipts } from "./run-guidance-store";
import { postGuidanceReplies } from "./run-guidance-replies";

const defaultDeps = {
  loadRun: loadRunById,
  getToken: getSlackBotToken,
  updateMessage: updateSlackMessage,
  sendTerminal: stripSlackRunControlsForTerminalRun,
  markDelivered: markTerminalSlackDelivery,
  markProgressDelivered: markRunProgressDelivered,
  loadGuidance: loadRunGuidanceReceipts,
  postReplies: postGuidanceReplies,
  now: Date.now,
  wait: async (milliseconds: number) => {
    await delay(milliseconds);
  },
};

/** Called exclusively by the serialized delivery task, including terminal edits. */
export async function deliverSlackRunUpdate(
  input: RunDeliveryPayload,
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  let run = await deps.loadRun(input.userId, input.runId);
  if (!run) return { delivered: false };
  const lastDeliveredAt = run.slack_progress_delivered_at
    ? Date.parse(run.slack_progress_delivered_at)
    : -Infinity;
  const remaining = 2500 - (deps.now() - lastDeliveredAt);
  if (remaining > 0) {
    // One wait for this actual delivery, not a loop or a liveness check.
    await deps.wait(remaining);
    run = await deps.loadRun(input.userId, input.runId);
    if (!run) return { delivered: false };
  }
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return { delivered: false };
  // Answers to guidance go out first: the terminal card may already be final.
  await deps.postReplies(run, slack.teamId);
  if (["success", "failed", "cancelled"].includes(run.status)) {
    const key = terminalSlackDeliveryKey(run, run.status);
    if (!key) return { delivered: false };
    if (run.slack_terminal_notification_key === key) return { delivered: true };
    // Only the first terminal delivery announces; a later one refreshes the
    // message for a guidance receipt that settled after the run ended.
    const announce = !run.slack_terminal_notification_key;
    if (!(await deps.sendTerminal(run, run.status, undefined, { announce })))
      throw new Error("Slack delivery unavailable");
    await deps.markDelivered(run, run.status, key);
    return { delivered: true };
  }
  const token = await deps.getToken(slack.teamId);
  if (!token) throw new Error("Slack delivery unavailable");
  const key = JSON.stringify([
    run.ai_call_id,
    run.status,
    run.slack_progress_revision ?? 0,
    slack.teamId,
    slack.channelId,
    slack.messageTs,
  ]);
  if (run.slack_progress_delivered_key === key) return { delivered: true };
  const state =
    readRunProgressSnapshot(run.slack_progress) ??
    createRunProgressState(Date.parse(run.created_at));
  if (run.status === "pending" && !state.summary) {
    state.phase = "Queued";
    state.summary =
      "Your task is accepted. Waiting for the coding worker to start.";
  } else if (run.status === "awaiting_input") {
    const plan = run.metadata.checkpoint_kind === "plan";
    state.phase = plan
      ? "Waiting for plan approval"
      : "Waiting for your review";
    state.summary = plan
      ? "The agent proposed a plan and has not changed any files. See the plan in this thread."
      : "The run has paused at a review checkpoint. See the checkpoint message in this thread.";
    state.next = plan
      ? "Approve the plan or reply with changes."
      : "Review the work, then ship it or reply with changes.";
    state.tasks.clear();
  }
  await deps.updateMessage(token, {
    channel: slack.channelId,
    ts: slack.messageTs,
    ...buildRunProgressMessage(
      run,
      state,
      run.metadata.slack_guidance_enabled === true
        ? await deps.loadGuidance(run)
        : []
    ),
  });
  await deps.markProgressDelivered(run, key);
  return { delivered: true };
}
