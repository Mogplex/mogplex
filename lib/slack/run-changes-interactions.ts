import { isUuid } from "@/lib/uuid";
import {
  getSlackBotToken,
  openSlackView,
  updateSlackView,
} from "@/lib/slack/client";
import { SLACK_VIEW_CHANGES_ACTION_ID } from "@/lib/slack/command-actions";
import { resolveSlackCommandUserId } from "@/lib/slack/command-identity";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "@/lib/slack/installations";
import type { SlackBlockActionsPayload } from "@/lib/slack/interactivity";
import { loadRunChanges } from "./run-changes";
import { buildRunChangesModal } from "./run-changes-presentation";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";

async function loadRun(userId: string, runId: string) {
  const { loadRunById } = await import("@/lib/mogplex-api/runs-db");
  return (await loadRunById(userId, runId)) as ExternalAgentRunRow | null;
}

const defaultDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  getBotToken: getSlackBotToken,
  openView: openSlackView,
  updateView: updateSlackView,
  loadRun,
  loadChanges: loadRunChanges,
};

export type RunChangesActionOutcome =
  | "invalid"
  | "unknown_workspace"
  | "not_linked"
  | "not_owner"
  | "unavailable"
  | "shown"
  | "failed";

const NOT_OWNER_TEXT =
  "Only the person who started this run can view its changes in Slack. Review the pull request on GitHub instead.";
const NOT_LINKED_TEXT =
  "Link your Slack account to Mogplex to view this run’s changes.";
const UNAVAILABLE_TEXT =
  "No changes to show yet. The workspace is not running and no pushed branch was found.";
const FAILED_TEXT =
  "Mogplex could not read this run’s changes right now. Try again shortly.";

/**
 * "View changes" / "Changes so far": open a modal right away (Slack trigger
 * IDs expire in seconds), then fill in the diff. The diff is shown only to
 * the run's owner. Channel members can see the card, but repository access
 * is the owner's, so anyone else is pointed at the pull request, where
 * GitHub enforces access.
 */
export async function handleViewRunChangesAction(
  payload: SlackBlockActionsPayload,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<RunChangesActionOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  const runId = payload.actions
    ?.find((action) => action.action_id === SLACK_VIEW_CHANGES_ACTION_ID)
    ?.value?.trim();
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (
    !runId ||
    !isUuid(runId) ||
    !teamId ||
    !slackUserId ||
    !payload.trigger_id
  )
    return "invalid";

  const botToken = await deps.getBotToken(teamId);
  if (!botToken) return "unknown_workspace";
  const opened = await deps.openView(botToken, {
    trigger_id: payload.trigger_id,
    view: buildRunChangesModal({ runId, state: "loading" }),
  });
  const viewId = opened.view?.id;
  if (!viewId) return "failed";
  const show = (view: ReturnType<typeof buildRunChangesModal>) =>
    deps.updateView(botToken, { view_id: viewId, view });
  const message = async (text: string, outcome: RunChangesActionOutcome) => {
    await show(buildRunChangesModal({ runId, state: "message", text }));
    return outcome;
  };

  try {
    const installation = await deps.getInstallation(teamId);
    if (!installation) return await message(FAILED_TEXT, "unknown_workspace");
    const mapping = await deps.getUserMapping({
      installationId: installation.id,
      slackUserId,
    });
    const userId = resolveSlackCommandUserId(
      installation,
      mapping,
      slackUserId
    );
    if (!userId) return await message(NOT_LINKED_TEXT, "not_linked");
    // Owner-scoped: another user's run id loads nothing.
    const run = await deps.loadRun(userId, runId);
    if (!run) return await message(NOT_OWNER_TEXT, "not_owner");
    const result = await deps.loadChanges(run);
    if (!result.ok) return await message(UNAVAILABLE_TEXT, "unavailable");
    await show(
      buildRunChangesModal({ runId, state: "ready", changes: result.changes })
    );
    return "shown";
  } catch (error) {
    console.error("[slack-run-changes] view failed", {
      runId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return message(FAILED_TEXT, "failed").catch(() => "failed" as const);
  }
}
