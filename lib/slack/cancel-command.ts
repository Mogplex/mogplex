import { z } from "zod";
import { cancelMogplexApiRun } from "@/lib/mogplex-api/run-control";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import { supabaseAdmin } from "@/lib/supabase/admin";

type CancelScope = {
  userId: string;
  teamId: string;
  channelId: string;
  slackUserId: string;
  runId?: string;
};

/** Default cancellation stays inside the caller's current Slack channel. */
export async function listSlackCancelableRuns(
  input: CancelScope,
  client: Pick<typeof supabaseAdmin, "from"> = supabaseAdmin
): Promise<Pick<ExternalAgentRunRow, "id" | "status">[]> {
  let query = client
    .from("external_agent_runs")
    .select("id, status")
    .eq("user_id", input.userId)
    .contains("metadata", {
      slackRunControls: { teamId: input.teamId, channelId: input.channelId },
      slack_user_id: input.slackUserId,
    });
  query = input.runId
    ? query.eq("id", input.runId)
    : query.in("status", ["pending", "streaming", "awaiting_input"]);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error)
    throw new Error("Failed to load Slack cancellation targets", {
      cause: error,
    });
  return data ?? [];
}

export type SlackCancelCommandDeps = {
  listCancelableRuns: typeof listSlackCancelableRuns;
  cancelRun: typeof cancelMogplexApiRun;
};

export const defaultSlackCancelCommandDeps: SlackCancelCommandDeps = {
  listCancelableRuns: listSlackCancelableRuns,
  cancelRun: cancelMogplexApiRun,
};

export async function slackCancelCommandText(
  scope: Omit<CancelScope, "runId">,
  argument: string,
  deps: SlackCancelCommandDeps
): Promise<string> {
  if (argument && !z.string().uuid().safeParse(argument).success) {
    return "Usage: `/mogplex-cancel [run-id]` or `/mogplex cancel [run-id]`. Omit the ID to cancel your active run in this channel.";
  }
  let runs: Awaited<ReturnType<SlackCancelCommandDeps["listCancelableRuns"]>>;
  try {
    runs = await deps.listCancelableRuns({
      ...scope,
      ...(argument ? { runId: argument } : {}),
    });
  } catch (error) {
    console.error("[slack-command] run lookup failed", error);
    return "Run lookup failed, so no cancellation was sent. Retry `/mogplex-cancel` or check `/mogplex status`.";
  }
  if (runs.length === 0) {
    return argument
      ? "That run was not found among your Slack runs in this channel. Use `/mogplex status` to find your run."
      : "You have no active Mogplex runs in this channel.";
  }
  if (runs.length > 1) {
    return `You have multiple active runs in this channel. Choose one with \`/mogplex-cancel <run-id>\`:\n${runs.map((run) => `• \`${run.id}\` (${run.status})`).join("\n")}`;
  }
  const run = runs[0];
  try {
    const result = await deps.cancelRun({
      userId: scope.userId,
      runId: run.id,
    });
    if (!result)
      return "That run is no longer available. Use `/mogplex status` to check its state.";
    if (result.alreadyTerminal)
      return `Run \`${run.id}\` already finished (status: ${result.status}).`;
    return `Cancellation requested for run \`${run.id}\` (status: ${result.status}). Your saved work is preserved.`;
  } catch (error) {
    console.error("[slack-command] cancellation failed", {
      runId: run.id,
      error,
    });
    return `Cancellation failed for run \`${run.id}\`. Use \`/mogplex status\` to check its state and retry \`/mogplex-cancel ${run.id}\`.`;
  }
}
