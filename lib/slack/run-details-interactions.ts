import { isUuid } from "@/lib/uuid";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import {
  getSlackBotToken,
  openSlackView,
  updateSlackView,
} from "@/lib/slack/client";
import { SLACK_RUN_DETAILS_ACTION_ID } from "@/lib/slack/command-actions";
import { resolveSlackCommandUserId } from "@/lib/slack/command-identity";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "@/lib/slack/installations";
import type { SlackBlockActionsPayload } from "@/lib/slack/interactivity";
import { readSlackRunControlsMetadata } from "./run-controls";
import type { RunGuidance } from "./run-guidance-store";
import {
  emptyRunResultEvidence,
  loadRunResultEvidence,
} from "./run-result-evidence";
import {
  buildRunResultDetails,
  buildRunResultDetailsModal,
} from "./run-result-presentation";

const TERMINAL = new Set(["success", "failed", "cancelled"]);

async function loadRunAnyOwner(runId: string) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load run: ${error.message}`);
  return (data as ExternalAgentRunRow | null) ?? null;
}

async function loadOutput(run: ExternalAgentRunRow) {
  const { loadRunOutput } = await import("./run-controls-notify");
  return loadRunOutput(run).catch(() => null);
}

async function loadGuidance(run: ExternalAgentRunRow): Promise<RunGuidance[]> {
  if (run.metadata.slack_guidance_enabled !== true) return [];
  const { loadRunGuidanceReceipts } = await import("./run-guidance-store");
  return loadRunGuidanceReceipts(run);
}

const defaultDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  getBotToken: getSlackBotToken,
  openView: openSlackView,
  updateView: updateSlackView,
  loadRun: loadRunAnyOwner,
  loadOutput,
  loadEvidence: loadRunResultEvidence,
  loadGuidance,
};

export type RunDetailsOutcome =
  | "invalid"
  | "unknown_workspace"
  | "not_in_channel"
  | "not_finished"
  | "shown"
  | "failed";

async function clickedByOwner(
  deps: typeof defaultDeps,
  payload: SlackBlockActionsPayload,
  run: ExternalAgentRunRow
) {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!teamId || !slackUserId) return false;
  const installation = await deps.getInstallation(teamId);
  if (!installation) return false;
  const mapping = await deps.getUserMapping({
    installationId: installation.id,
    slackUserId,
  });
  return (
    resolveSlackCommandUserId(installation, mapping, slackUserId) ===
    run.user_id
  );
}

/**
 * The run card's Details button: the full result that used to fill the
 * card. The card is visible to the channel, so the details are too, but only
 * for the card in that channel: a run id clicked from anywhere else (or
 * forged into another message) loads nothing. The run's owner can open them
 * from anywhere, such as a run link preview shared in another channel.
 */
export async function handleRunDetailsAction(
  payload: SlackBlockActionsPayload,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<RunDetailsOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  const runId = payload.actions
    ?.find((action) => action.action_id === SLACK_RUN_DETAILS_ACTION_ID)
    ?.value?.trim();
  const teamId = payload.team?.id;
  const channelId = payload.channel?.id ?? payload.container?.channel_id;
  if (!runId || !isUuid(runId) || !teamId || !channelId || !payload.trigger_id)
    return "invalid";
  const botToken = await deps.getBotToken(teamId);
  if (!botToken) return "unknown_workspace";
  // Trigger IDs expire within seconds: open first, fill in after.
  const opened = await deps.openView(botToken, {
    trigger_id: payload.trigger_id,
    view: buildRunResultDetailsModal({ runId, state: "loading" }),
  });
  const viewId = opened.view?.id;
  if (!viewId) return "failed";
  const message = async (text: string, outcome: RunDetailsOutcome) => {
    await deps.updateView(botToken, {
      view_id: viewId,
      view: buildRunResultDetailsModal({ runId, state: "message", text }),
    });
    return outcome;
  };
  try {
    const run = await deps.loadRun(runId);
    const slack = run ? readSlackRunControlsMetadata(run.metadata) : null;
    const inCardChannel =
      slack?.teamId === teamId && slack.channelId === channelId;
    // Outside the card's channel, only the run's owner gets through.
    if (!run || (!inCardChannel && !(await clickedByOwner(deps, payload, run))))
      return await message(
        "These details belong to a run card in another conversation.",
        "not_in_channel"
      );
    if (!TERMINAL.has(run.status))
      return await message(
        "This run is still going. The run card shows its progress.",
        "not_finished"
      );
    const [output, evidence, guidance] = await Promise.all([
      deps.loadOutput(run),
      deps.loadEvidence(run).catch(() => emptyRunResultEvidence()),
      deps.loadGuidance(run).catch(() => []),
    ]);
    await deps.updateView(botToken, {
      view_id: viewId,
      view: buildRunResultDetailsModal({
        runId,
        state: "ready",
        details: buildRunResultDetails({
          run,
          status: run.status,
          output,
          evidence,
          guidance,
        }),
      }),
    });
    return "shown";
  } catch (error) {
    console.error("[slack-run-details] view failed", {
      runId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return message(
      "Mogplex could not load this run’s details right now. Try again shortly.",
      "failed"
    ).catch(() => "failed" as const);
  }
}
