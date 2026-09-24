import { z } from "zod";
import { cancelMogplexApiRun } from "@/lib/mogplex-api/run-control";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import { supabaseAdmin } from "@/lib/supabase/admin";

type CancelScope = {
  userId: string;
  teamId: string;
  channelId: string;
  slackUserId: string;
  threadTs?: string;
  runId?: string;
};

/** Thread context is strict: never fall back to another run in the channel. */
export async function listSlackCancelableRuns(
  input: CancelScope,
  client: Pick<typeof supabaseAdmin, "from"> = supabaseAdmin
): Promise<Pick<ExternalAgentRunRow, "id" | "status">[]> {
  const base = () => {
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
    return query.order("created_at", { ascending: false });
  };
  const results = input.threadTs
    ? await Promise.all([
        base().eq("metadata->>slack_thread_ts", input.threadTs),
        base().contains("metadata", {
          slackRunControls: { messageTs: input.threadTs },
        }),
      ])
    : [await base()];
  if (results.some(({ error }) => error))
    throw new Error("Failed to load Slack cancellation targets", {
      cause: results.find(({ error }) => error)?.error,
    });
  return [
    ...new Map(
      results.flatMap(({ data }) => data ?? []).map((row) => [row.id, row])
    ).values(),
  ];
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
  const location = scope.threadTs ? "thread" : "channel";
  const command = scope.threadTs ? "mogplex-cancel" : "/mogplex-cancel";
  if (argument && !z.string().uuid().safeParse(argument).success) {
    return `Usage: \`${command} [run-id]\`. Omit the ID to cancel your active run in this ${location}.`;
  }
  let runs: Awaited<ReturnType<SlackCancelCommandDeps["listCancelableRuns"]>>;
  try {
    runs = await deps.listCancelableRuns({
      ...scope,
      ...(argument ? { runId: argument } : {}),
    });
  } catch (error) {
    console.error("[slack-command] run lookup failed", error);
    return `Run lookup failed, so no cancellation was sent. Retry \`${command}\` or check \`/mogplex status\`.`;
  }
  if (runs.length === 0) {
    return argument
      ? `That run was not found among your Slack runs in this ${location}. Use \`/mogplex status\` to find your run.`
      : `You have no active Mogplex runs in this ${location}.`;
  }
  if (runs.length > 1) {
    return `You have multiple active runs in this ${location}. Choose one with \`${command} <run-id>\`:\n${runs.map((run) => `• \`${run.id}\` (${run.status})`).join("\n")}`;
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
    return `Cancellation failed for run \`${run.id}\`. Use \`/mogplex status\` to check its state and retry \`${command} ${run.id}\`.`;
  }
}
