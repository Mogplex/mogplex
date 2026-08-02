import type { SlackBlock } from "@/lib/slack/client";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
  isExplicitSlackUserMapping,
} from "@/lib/slack/installations";
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
};

export type SlackBlockActionsPayload = {
  type: string;
  team?: { id?: string };
  user?: { id?: string };
  response_url?: string;
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
  | { outcome: "run_cancelled"; runId: string; status: string };

export type SlackInteractivityDeps = {
  getInstallation: typeof getSlackInstallationByTeamId;
  getUserMapping: typeof getSlackUserMapping;
  cancelRun: typeof cancelMogplexApiRun;
  postResponse: (
    responseUrl: string,
    body: Record<string, unknown>
  ) => Promise<void>;
};

/**
 * Hosts we'll POST a Slack `response_url` to. Slack always uses
 * `hooks.slack.com`; `*.slack.test` covers local/CI fixtures. Anything else is
 * rejected — defense-in-depth against an SSRF via a tampered interactivity
 * payload (the inbound HMAC check already makes that hard, but this is cheap).
 */
const ALLOWED_RESPONSE_URL_HOSTS = new Set([
  "hooks.slack.com",
  "hooks.slack.test",
]);

function assertAllowedResponseUrl(responseUrl: string): void {
  let host: string;
  try {
    host = new URL(responseUrl).hostname;
  } catch {
    throw new Error(`Invalid Slack response_url: ${responseUrl}`);
  }
  if (!ALLOWED_RESPONSE_URL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to POST Slack response_url to unexpected host: ${host}`
    );
  }
}

async function defaultPostResponse(
  responseUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  assertAllowedResponseUrl(responseUrl);
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Slack response_url POST failed: HTTP ${response.status}`);
  }
}

const defaultDeps: SlackInteractivityDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  cancelRun: cancelMogplexApiRun,
  postResponse: defaultPostResponse,
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
  | { outcome: "resolved"; mogplexUserId: string };

async function resolveActorMogplexUserId(
  deps: SlackInteractivityDeps,
  payload: SlackBlockActionsPayload
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
  const mogplexUserId = isExplicitSlackUserMapping(mapping)
    ? mapping.mogplex_user_id
    : null;
  if (!mogplexUserId) return { outcome: "not_linked" };
  return { outcome: "resolved", mogplexUserId };
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
 * Currently only the "Cancel run" button is wired; unknown actions are a no-op
 * (the webhook has already acked, so Slack just hides the spinner). New buttons
 * should be added here rather than spreading interactivity logic across modules.
 */
export async function handleSlackBlockActions(
  payload: SlackBlockActionsPayload,
  overrides: Partial<SlackInteractivityDeps> = {}
): Promise<SlackInteractivityResult> {
  const deps: SlackInteractivityDeps = { ...defaultDeps, ...overrides };

  if (payload.type !== "block_actions") {
    return { outcome: "ignored", reason: "unsupported_interactivity_type" };
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
