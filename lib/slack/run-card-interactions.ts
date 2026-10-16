import {
  SLACK_RUN_DETAILS_ACTION_ID,
  SLACK_VIEW_CHANGES_ACTION_ID,
} from "./command-actions";
import type {
  SlackBlockActionsPayload,
  SlackInteractivityResult,
} from "./interactivity";

/**
 * Buttons on run cards and checkpoint messages: view changes, details,
 * approve or revise. Handlers load lazily so other interactions skip their imports.
 */
export async function routeRunCardAction(
  payload: SlackBlockActionsPayload
): Promise<SlackInteractivityResult | null> {
  const ids = (payload.actions ?? []).map((action) => action.action_id ?? "");
  if (ids.includes(SLACK_VIEW_CHANGES_ACTION_ID)) {
    const { handleViewRunChangesAction } =
      await import("./run-changes-interactions");
    return {
      outcome: "run_changes",
      result: await handleViewRunChangesAction(payload),
    };
  }
  if (ids.includes(SLACK_RUN_DETAILS_ACTION_ID)) {
    const { handleRunDetailsAction } =
      await import("./run-details-interactions");
    return {
      outcome: "run_details",
      result: await handleRunDetailsAction(payload),
    };
  }
  if (ids.some((id) => id.startsWith("mogplex_checkpoint_"))) {
    const { handleCheckpointAction } =
      await import("./run-checkpoint-interactions");
    return {
      outcome: "checkpoint",
      result: await handleCheckpointAction(payload),
    };
  }
  return null;
}
