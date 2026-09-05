import type { SlackBlock } from "@/lib/slack/client";
import {
  SLACK_COMMAND_SELECT_ACTION_ID,
  SLACK_CREATE_ISSUE_ACTION_ID,
  SLACK_MERGE_PR_ACTION_ID,
  SLACK_MODEL_SELECT_ACTION_ID,
  SLACK_REFRESH_PRS_ACTION_ID,
  SLACK_REPO_SELECT_ACTION_ID,
  SLACK_VIEW_RUN_ACTION_ID,
} from "@/lib/slack/command-actions";
import type { SlackCommandPayload } from "@/lib/slack/command";
import { postSlackResponse } from "@/lib/slack/response";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
  isExplicitSlackUserMapping,
  type SlackInstallationRow,
  type SlackUserMappingRow,
} from "@/lib/slack/installations";
import { listUsableModelIdsForScope } from "@/lib/models/default-model";
import { upsertSlackModelPreference } from "@/lib/slack/model-preferences";
import {
  cancelMogplexApiRun,
  MogplexApiRunControlError,
} from "@/lib/mogplex-api/run-control";
import {
  isRunControlsBlock,
  SLACK_CANCEL_RUN_ACTION_ID,
  buildTextSectionBlocks,
} from "@/lib/slack/run-controls";

export {
  buildCancelRunActionsBlock,
  SLACK_CANCEL_RUN_ACTION_ID,
  SLACK_RUN_CONTROLS_BLOCK_ID,
} from "@/lib/slack/run-controls";

export type SlackBlockAction = {
  action_id?: string;
  block_id?: string;
  value?: string;
  type?: string;
  selected_option?: { value?: string };
};

export type SlackBlockActionsPayload = {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  channel?: { id?: string };
  container?: { channel_id?: string };
  response_url?: string;
  trigger_id?: string;
  actions?: SlackBlockAction[];
  /**
   * The message the clicked block is attached to. Slack includes this on
   * `block_actions`; we use it to re-render the message without the
   * run-controls block once the run is no longer cancellable.
   */
  message?: { text?: string; blocks?: SlackBlock[] };
};

export type SlackInteractivityResult =
  | { outcome: "ignored"; reason: string }
  | { outcome: "not_linked" }
  | { outcome: "run_not_found"; runId: string }
  | { outcome: "run_cancelled"; runId: string; status: string }
  | { outcome: "model_updated"; modelId: string }
  | { outcome: "command_dispatched"; command: string }
  | { outcome: "pull_request_merged"; number: number }
  | { outcome: "pull_request_queued"; number: number };

export type SlackInteractivityDeps = {
  getInstallation: typeof getSlackInstallationByTeamId;
  getUserMapping: typeof getSlackUserMapping;
  listUsableModels: typeof listUsableModelIdsForScope;
  saveModelPreference: typeof upsertSlackModelPreference;
  cancelRun: typeof cancelMogplexApiRun;
  dispatchCommand: (payload: SlackCommandPayload) => Promise<void>;
  mergePullRequest: (
    payload: SlackBlockActionsPayload,
    rawValue: string
  ) => Promise<SlackInteractivityResult>;
  postResponse: (
    responseUrl: string,
    body: Record<string, unknown>
  ) => Promise<void>;
};

export { postSlackResponse } from "@/lib/slack/response";

const defaultDeps: SlackInteractivityDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  listUsableModels: listUsableModelIdsForScope,
  saveModelPreference: upsertSlackModelPreference,
  cancelRun: cancelMogplexApiRun,
  dispatchCommand: async (payload) => {
    const { handleSlackCommand } = await import("@/lib/slack/command");
    await handleSlackCommand(payload);
  },
  mergePullRequest: async (payload, rawValue) => {
    const { handleSlackPullRequestMergeAction } =
      await import("@/lib/slack/command-interactions");
    return handleSlackPullRequestMergeAction(payload, rawValue);
  },
  postResponse: postSlackResponse,
};

async function respondEphemeral(
  deps: SlackInteractivityDeps,
  payload: SlackBlockActionsPayload,
  text: string
): Promise<void> {
  if (!payload.response_url) return;
  try {
    await deps.postResponse(payload.response_url, {
      response_type: "ephemeral",
      replace_original: false,
      text,
    });
  } catch (error) {
    // The interaction is already acked by the webhook — a failed follow-up
    // message shouldn't bubble up and trigger a Slack retry of the action.
    console.warn("[slack-interactivity] response_url post failed", error);
  }
}

/**
 * Re-render the button's message without the run-controls block — used once the
 * run can no longer be cancelled, so a stale "Cancel run" button doesn't linger.
 * Best-effort: a failed update just leaves the (now inert) button in place.
 */
async function removeCancelButton(
  deps: SlackInteractivityDeps,
  payload: SlackBlockActionsPayload
): Promise<void> {
  const responseUrl = payload.response_url;
  if (!responseUrl) return;

  const blocks = payload.message?.blocks ?? [];
  if (!blocks.some(isRunControlsBlock)) return;

  const text = payload.message?.text ?? "";
  const remaining = blocks.filter((block) => !isRunControlsBlock(block));
  const nextBlocks =
    remaining.length > 0 ? remaining : buildTextSectionBlocks(text);
  if (!nextBlocks) return;

  try {
    await deps.postResponse(responseUrl, {
      replace_original: true,
      text,
      blocks: nextBlocks,
    });
  } catch (error) {
    console.warn("[slack-interactivity] failed to strip cancel button", error);
  }
}

type ResolvedActor =
  | { outcome: "ignored"; reason: string }
  | { outcome: "not_linked" }
  | {
      outcome: "resolved";
      installationId: string;
      mogplexUserId: string;
      slackUserId: string;
    };

function resolveInteractiveMogplexUserId(input: {
  installation: SlackInstallationRow;
  mapping: SlackUserMappingRow | null;
  slackUserId: string;
  allowInstallerFallback: boolean;
}) {
  if (isExplicitSlackUserMapping(input.mapping)) {
    return input.mapping.mogplex_user_id;
  }
  if (
    input.allowInstallerFallback &&
    input.installation.authed_user_slack_id === input.slackUserId
  ) {
    return input.installation.installed_by_user_id;
  }
  return null;
}

async function resolveActorMogplexUserId(
  deps: SlackInteractivityDeps,
  payload: SlackBlockActionsPayload,
  allowInstallerFallback = false
): Promise<ResolvedActor> {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!teamId || !slackUserId) {
    return { outcome: "ignored", reason: "missing_actor" };
  }

  const installation = await deps.getInstallation(teamId);
  if (!installation) {
    return { outcome: "ignored", reason: "unknown_workspace" };
  }

  const mapping = await deps.getUserMapping({
    installationId: installation.id,
    slackUserId,
  });
  // Short-circuit here rather than returning a nullable `mogplexUserId`: that
  // null must never reach `cancelMogplexApiRun` (it'd run `.eq("user_id", null)`),
  // and encoding "no mapping" as its own outcome lets the type enforce that.
  const mogplexUserId = resolveInteractiveMogplexUserId({
    installation,
    mapping,
    slackUserId,
    allowInstallerFallback,
  });
  if (!mogplexUserId) return { outcome: "not_linked" };
  return {
    outcome: "resolved",
    installationId: installation.id,
    mogplexUserId,
    slackUserId,
  };
}

export { SLACK_MODEL_SELECT_ACTION_ID } from "@/lib/slack/command-actions";

function findModelSelection(payload: SlackBlockActionsPayload) {
  const action = (payload.actions ?? []).find(
    (candidate) => candidate.action_id === SLACK_MODEL_SELECT_ACTION_ID
  );
  if (!action) return undefined;
  return action.selected_option?.value?.trim() ?? "";
}

function modelSelectionChannelId(payload: SlackBlockActionsPayload) {
  return payload.channel?.id ?? payload.container?.channel_id;
}

const DISPATCHABLE_COMMANDS = new Set([
  "status",
  "repo",
  "prs",
  "issues",
  "usage",
  "model",
  "harness",
]);

function findCommandDispatch(payload: SlackBlockActionsPayload) {
  for (const action of payload.actions ?? []) {
    if (action.action_id === SLACK_COMMAND_SELECT_ACTION_ID) {
      const command = action.selected_option?.value?.trim() ?? "";
      return DISPATCHABLE_COMMANDS.has(command) ? command : "";
    }
    if (action.action_id === SLACK_REPO_SELECT_ACTION_ID) {
      const repoId = action.selected_option?.value?.trim() ?? "";
      return repoId ? `repo ${repoId}` : "";
    }
    if (action.action_id === SLACK_CREATE_ISSUE_ACTION_ID) {
      return "issues create";
    }
    if (action.action_id === SLACK_REFRESH_PRS_ACTION_ID) return "prs";
  }
  return undefined;
}

async function dispatchSelectedCommand(
  deps: SlackInteractivityDeps,
  payload: SlackBlockActionsPayload,
  command: string
): Promise<SlackInteractivityResult> {
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const channelId = payload.channel?.id ?? payload.container?.channel_id;
  const responseUrl = payload.response_url;
  if (!teamId || !slackUserId || !channelId || !responseUrl) {
    return { outcome: "ignored", reason: "missing_command_context" };
  }
  await deps.dispatchCommand({
    command: "/mogplex",
    text: command,
    teamId,
    channelId,
    slackUserId,
    responseUrl,
    ...(payload.trigger_id ? { triggerId: payload.trigger_id } : {}),
  });
  return { outcome: "command_dispatched", command };
}

function findMergeActionValue(payload: SlackBlockActionsPayload) {
  const action = (payload.actions ?? []).find(
    (candidate) => candidate.action_id === SLACK_MERGE_PR_ACTION_ID
  );
  return action ? (action.value?.trim() ?? "") : undefined;
}

async function updateSelectedModel(
  deps: SlackInteractivityDeps,
  payload: SlackBlockActionsPayload,
  modelId: string
): Promise<SlackInteractivityResult> {
  const channelId = modelSelectionChannelId(payload);
  if (!channelId) return { outcome: "ignored", reason: "missing_channel" };

  const actor = await resolveActorMogplexUserId(deps, payload, true);
  if (actor.outcome === "ignored") return actor;
  if (actor.outcome === "not_linked") {
    await respondEphemeral(
      deps,
      payload,
      ":x: Link your Slack identity to your Mogplex account, then try again."
    );
    return actor;
  }

  const models = await deps.listUsableModels(actor.mogplexUserId);
  if (!models.includes(modelId)) {
    await respondEphemeral(
      deps,
      payload,
      ":warning: That model is no longer available to your account. Run `/mogplex model` to refresh the choices."
    );
    return { outcome: "ignored", reason: "model_unavailable" };
  }

  try {
    await deps.saveModelPreference({
      installationId: actor.installationId,
      channelId,
      slackUserId: actor.slackUserId,
      modelId,
    });
  } catch (error) {
    await respondEphemeral(
      deps,
      payload,
      "Mogplex could not update your model right now. Try again shortly."
    );
    throw error;
  }
  await respondEphemeral(
    deps,
    payload,
    `Model set to ${modelId} for you in this channel. It will apply to your next eligible Mogplex response.`
  );
  return { outcome: "model_updated", modelId };
}

function findCancelRunId(payload: SlackBlockActionsPayload): string | null {
  const action = (payload.actions ?? []).find(
    (candidate) => candidate.action_id === SLACK_CANCEL_RUN_ACTION_ID
  );
  if (!action) return null;
  const runId = typeof action.value === "string" ? action.value.trim() : "";
  return runId || null;
}

async function cancelRunAndRespond(
  deps: SlackInteractivityDeps,
  payload: SlackBlockActionsPayload,
  mogplexUserId: string,
  runId: string
): Promise<SlackInteractivityResult> {
  let result: Awaited<ReturnType<typeof cancelMogplexApiRun>>;
  try {
    // `cancelMogplexApiRun` enforces ownership: it loads the run with
    // `.eq("user_id", userId)`, so if `mogplexUserId` (the *clicking* Slack
    // user) doesn't own `runId`, it returns `null` → mapped to `run_not_found`
    // below. This is the load-bearing authz check — keep it if this call ever
    // gets swapped out.
    result = await deps.cancelRun({ userId: mogplexUserId, runId });
  } catch (error) {
    const message =
      error instanceof MogplexApiRunControlError
        ? error.message
        : "an unexpected error";
    await respondEphemeral(
      deps,
      payload,
      `:warning: Couldn't cancel run \`${runId}\`: ${message}.`
    );
    throw error;
  }

  if (!result) {
    await respondEphemeral(
      deps,
      payload,
      `:grey_question: Run \`${runId}\` not found — it may have already finished.`
    );
    return { outcome: "run_not_found", runId };
  }

  // `cancelMogplexApiRun` returns a non-null result with `alreadyTerminal: true`
  // when the run had already reached a terminal state (success / failed / or even
  // cancelled) before this click — nothing was cancelled here, so don't pretend
  // otherwise.
  if (result.alreadyTerminal) {
    // User-visible feedback first; the button strip is best-effort. (Slack
    // caps `response_url` reuse at ~5 calls — keep the ephemeral ahead of the
    // optional follow-up so a strip failure can never starve it.)
    await respondEphemeral(
      deps,
      payload,
      `:grey_question: Run \`${runId}\` has already finished (status: ${result.status}).`
    );
    // The run is done — drop the now-useless button so nobody else clicks it.
    await removeCancelButton(deps, payload);
    return { outcome: "run_not_found", runId };
  }

  // Cancellation is in flight — the run won't accept another cancel, so remove
  // the button rather than leave it for a redundant second click. Same ordering
  // rationale as the terminal branch above: ephemeral first, strip best-effort.
  await respondEphemeral(
    deps,
    payload,
    `:octagonal_sign: Cancellation requested for run \`${runId}\` (status: ${result.status}).`
  );
  await removeCancelButton(deps, payload);
  return { outcome: "run_cancelled", runId, status: result.status };
}

/**
 * Handle a Slack `block_actions` interactivity payload.
 *
 * Unknown actions are a no-op (the webhook has already acked, so Slack just
 * hides the spinner). New buttons should be added here rather than spreading
 * interactivity routing across modules.
 */
export async function handleSlackBlockActions(
  payload: SlackBlockActionsPayload,
  overrides: Partial<SlackInteractivityDeps> = {}
): Promise<SlackInteractivityResult> {
  const deps: SlackInteractivityDeps = { ...defaultDeps, ...overrides };

  if (payload.type !== "block_actions") {
    return { outcome: "ignored", reason: "unsupported_interactivity_type" };
  }

  const selectedModel = findModelSelection(payload);
  if (selectedModel !== undefined) {
    return selectedModel
      ? updateSelectedModel(deps, payload, selectedModel)
      : { outcome: "ignored", reason: "missing_model_id" };
  }

  const command = findCommandDispatch(payload);
  if (command !== undefined) {
    return command
      ? dispatchSelectedCommand(deps, payload, command)
      : { outcome: "ignored", reason: "invalid_command_selection" };
  }

  const mergeValue = findMergeActionValue(payload);
  if (mergeValue !== undefined) {
    return mergeValue
      ? deps.mergePullRequest(payload, mergeValue)
      : { outcome: "ignored", reason: "invalid_merge_action" };
  }

  if (
    (payload.actions ?? []).some(
      (candidate) => candidate.action_id === SLACK_VIEW_RUN_ACTION_ID
    )
  ) {
    return { outcome: "ignored", reason: "link_action" };
  }

  const runId = findCancelRunId(payload);
  if (!runId) {
    const hasAction = (payload.actions ?? []).some(
      (candidate) => candidate.action_id === SLACK_CANCEL_RUN_ACTION_ID
    );
    return hasAction
      ? { outcome: "ignored", reason: "missing_run_id" }
      : { outcome: "ignored", reason: "no_known_action" };
  }

  const actor = await resolveActorMogplexUserId(deps, payload);
  if (actor.outcome === "ignored") return actor;
  if (actor.outcome === "not_linked") {
    await respondEphemeral(
      deps,
      payload,
      ":x: Your Slack account isn't linked to a Mogplex user, so I can't cancel runs on your behalf."
    );
    return { outcome: "not_linked" };
  }

  return cancelRunAndRespond(deps, payload, actor.mogplexUserId, runId);
}
