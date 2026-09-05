import type { ExternalAgentRunRow, MogplexApiRunStatus } from "./runs-types";
import { readSlackRunControlsMetadata } from "@/lib/slack/run-controls";
import { queueTerminalSlackRun } from "@/lib/slack/run-delivery-queue";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type NotificationDeps = {
  send: (
    run: ExternalAgentRunRow,
    status: MogplexApiRunStatus
  ) => Promise<boolean>;
  markDelivered: (
    run: ExternalAgentRunRow,
    status: MogplexApiRunStatus,
    key: string
  ) => Promise<void>;
};

export async function markTerminalSlackDelivery(
  run: ExternalAgentRunRow,
  status: MogplexApiRunStatus,
  key: string,
  client: Pick<SupabaseClient, "from"> = supabaseAdmin
): Promise<void> {
  const { error } = await client
    .from("external_agent_runs")
    .update({ slack_terminal_notification_key: key })
    .eq("id", run.id)
    .eq("user_id", run.user_id)
    .eq("ai_call_id", run.ai_call_id)
    .eq("status", status)
    .in("status", ["success", "failed", "cancelled"])
    .select("id")
    .maybeSingle();
  if (error)
    throw new Error(
      `Failed to record terminal Slack delivery: ${error.message}`
    );
}

const defaultDeps: NotificationDeps = {
  send: queueTerminalSlackRun,
  markDelivered: markTerminalSlackDelivery,
};

export function terminalSlackDeliveryKey(
  run: ExternalAgentRunRow,
  status: MogplexApiRunStatus
): string | null {
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return null;
  return JSON.stringify([
    run.ai_call_id,
    status,
    slack.teamId,
    slack.channelId,
    slack.messageTs,
    // A guidance receipt can settle after the first terminal delivery. Keep
    // legacy zero-revision keys compatible while allowing that final receipt.
    ...(run.slack_progress_revision ? [run.slack_progress_revision] : []),
  ]);
}

export async function notifyTerminalSlackRunOnce(
  run: ExternalAgentRunRow,
  status: MogplexApiRunStatus,
  overrides: Partial<NotificationDeps> = {}
): Promise<void> {
  if (status !== "success" && status !== "failed" && status !== "cancelled")
    return;
  const key = terminalSlackDeliveryKey(run, status);
  if (!key) return;
  if (run.slack_terminal_notification_key === key) return;
  const deps = { ...defaultDeps, ...overrides };
  // A missing bot token is not a delivered edit. Leave it pending so a later
  // authenticated read can recover after the integration is reconnected.
  if (await deps.send(run, status)) await deps.markDelivered(run, status, key);
}
