import { z } from "zod";
import { buildAppUrl } from "@/lib/app-url";
import { isUuid } from "@/lib/uuid";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import type { ResumeMode } from "@/lib/mogplex-api/run-resume";
import { getSlackBotToken, openSlackView } from "./client";
import { resolveSlackCommandUserId } from "./command-identity";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "./installations";
import type { SlackBlockActionsPayload } from "./interactivity";
import { escapeMrkdwn } from "./markdown-to-mrkdwn";
import { postSlackResponse } from "./response";
import {
  approvalSteer,
  buildAnsweredCheckpointBlocks,
  buildCheckpointReviseModal,
  buildRunCheckpointMessage,
  checkpointResumeKey,
  decodeCheckpointAction,
  SLACK_CHECKPOINT_APPROVE_ACTION_ID,
  SLACK_CHECKPOINT_FEEDBACK_ACTION_ID,
  SLACK_CHECKPOINT_FEEDBACK_BLOCK_ID,
  SLACK_CHECKPOINT_REVISE_ACTION_ID,
  SLACK_CHECKPOINT_REVISE_CALLBACK_ID,
  type CheckpointKind,
} from "./run-checkpoint-presentation";

async function loadRun(userId: string, runId: string) {
  const { loadRunById } = await import("@/lib/mogplex-api/runs-db");
  return (await loadRunById(userId, runId)) as ExternalAgentRunRow | null;
}

async function queueResume(input: {
  runId: string;
  userId: string;
  repoId: string;
  steer: string;
  mode: ResumeMode;
  idempotencyKey: string;
}) {
  const { queueResumeExternalAgentRun } =
    await import("@/lib/mogplex-api/run-resume");
  await queueResumeExternalAgentRun(input);
}

const defaultDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  getBotToken: getSlackBotToken,
  openView: openSlackView,
  postResponse: postSlackResponse,
  loadRun,
  queueResume,
};

type Deps = typeof defaultDeps;

export type CheckpointActionOutcome =
  | "invalid"
  | "unknown_workspace"
  | "not_linked"
  | "not_allowed"
  | "not_owner"
  | "not_paused"
  | "revise_opened"
  | "resumed";

/** Owner-only, like cancel: the run uses its owner's repository access. */
async function resolveRun(
  deps: Deps,
  input: { teamId: string; slackUserId: string; runId: string }
): Promise<
  | { ok: false; outcome: CheckpointActionOutcome; text?: string }
  | { ok: true; run: ExternalAgentRunRow; userId: string }
> {
  const installation = await deps.getInstallation(input.teamId);
  if (!installation) return { ok: false, outcome: "unknown_workspace" };
  const allowed = installation.allowed_slack_user_ids;
  if (Array.isArray(allowed) && !allowed.includes(input.slackUserId))
    return {
      ok: false,
      outcome: "not_allowed",
      text: "Your workspace does not currently allow you to direct repository runs.",
    };
  const mapping = await deps.getUserMapping({
    installationId: installation.id,
    slackUserId: input.slackUserId,
  });
  const userId = resolveSlackCommandUserId(
    installation,
    mapping,
    input.slackUserId
  );
  if (!userId)
    return {
      ok: false,
      outcome: "not_linked",
      text: "Link your Slack account to Mogplex to answer this run.",
    };
  const run = await deps.loadRun(userId, input.runId);
  if (!run)
    return {
      ok: false,
      outcome: "not_owner",
      text: "Only the person who started this run can approve or change it. Reply in the thread to suggest changes to them.",
    };
  if (run.status !== "awaiting_input")
    return {
      ok: false,
      outcome: "not_paused",
      text: "This run is no longer waiting for an answer. The run card shows where it is now.",
    };
  return { ok: true, run, userId };
}

function answeredText(input: {
  kind: CheckpointKind;
  slackUserId: string;
  feedback?: string;
}) {
  const who = `<@${input.slackUserId}>`;
  if (input.feedback !== undefined) {
    const chars = Array.from(input.feedback.replace(/\s+/g, " ").trim());
    const excerpt =
      chars.length > 200 ? `${chars.slice(0, 199).join("")}…` : chars.join("");
    return `✏️ ${who} asked for changes: “${escapeMrkdwn(excerpt)}”. The agent is working on them.`;
  }
  return input.kind === "plan"
    ? `✅ ${who} approved the plan. The agent is implementing it.`
    : `✅ ${who} approved. The agent is opening the pull request.`;
}

async function respond(
  deps: Deps,
  responseUrl: string | undefined,
  body: Record<string, unknown>
) {
  if (!responseUrl) return;
  try {
    await deps.postResponse(responseUrl, body);
  } catch (error) {
    // The action is already acked; a failed follow-up must not retry it.
    console.warn("[slack-checkpoint] response_url post failed", error);
  }
}

const reviseMetadataSchema = z.object({
  runId: z.string().refine(isUuid),
  kind: z.enum(["plan", "review"]),
  responseUrl: z.string().url().optional(),
});

/** "Approve plan" / "Ship it" resume the run; "Revise" opens a feedback modal. */
export async function handleCheckpointAction(
  payload: SlackBlockActionsPayload,
  overrides: Partial<Deps> = {}
): Promise<CheckpointActionOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  const action = payload.actions?.find(
    (candidate) =>
      candidate.action_id === SLACK_CHECKPOINT_APPROVE_ACTION_ID ||
      candidate.action_id === SLACK_CHECKPOINT_REVISE_ACTION_ID
  );
  const decoded = decodeCheckpointAction(action?.value);
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!action || !decoded || !isUuid(decoded.runId) || !teamId || !slackUserId)
    return "invalid";
  const revise = action.action_id === SLACK_CHECKPOINT_REVISE_ACTION_ID;
  if (revise && !payload.trigger_id) return "invalid";

  const resolved = await resolveRun(deps, {
    teamId,
    slackUserId,
    runId: decoded.runId,
  });
  if (!resolved.ok) {
    if (resolved.text)
      await respond(deps, payload.response_url, {
        response_type: "ephemeral",
        replace_original: false,
        text: resolved.text,
      });
    return resolved.outcome;
  }

  if (revise) {
    const botToken = await deps.getBotToken(teamId);
    if (!botToken) return "unknown_workspace";
    await deps.openView(botToken, {
      trigger_id: payload.trigger_id ?? "",
      view: buildCheckpointReviseModal({
        kind: decoded.kind,
        privateMetadata: JSON.stringify({
          runId: decoded.runId,
          kind: decoded.kind,
          ...(payload.response_url
            ? { responseUrl: payload.response_url }
            : {}),
        }),
      }),
    });
    return "revise_opened";
  }

  await deps.queueResume({
    runId: resolved.run.id,
    userId: resolved.userId,
    repoId: resolved.run.repo_id,
    steer: approvalSteer(decoded.kind),
    mode: "review",
    idempotencyKey: checkpointResumeKey(resolved.run),
  });
  const answer = answeredText({ kind: decoded.kind, slackUserId });
  await respond(deps, payload.response_url, {
    replace_original: true,
    text: answer,
    blocks: buildAnsweredCheckpointBlocks({
      blocks: payload.message?.blocks,
      answer,
    }),
  });
  return "resumed";
}

type ViewSubmissionPayload = SlackBlockActionsPayload & {
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string | null } | undefined>
      >;
    };
  };
};

/** The revise modal's Send: resume with the feedback, plan stays a plan. */
export async function handleCheckpointReviseSubmission(
  payload: ViewSubmissionPayload,
  overrides: Partial<Deps> = {}
): Promise<CheckpointActionOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  if (payload.view?.callback_id !== SLACK_CHECKPOINT_REVISE_CALLBACK_ID)
    return "invalid";
  let metadata: z.infer<typeof reviseMetadataSchema>;
  try {
    metadata = reviseMetadataSchema.parse(
      JSON.parse(payload.view.private_metadata ?? "")
    );
  } catch {
    return "invalid";
  }
  const feedback =
    payload.view.state?.values?.[SLACK_CHECKPOINT_FEEDBACK_BLOCK_ID]?.[
      SLACK_CHECKPOINT_FEEDBACK_ACTION_ID
    ]?.value?.trim() ?? "";
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!feedback || !teamId || !slackUserId) return "invalid";

  const resolved = await resolveRun(deps, {
    teamId,
    slackUserId,
    runId: metadata.runId,
  });
  if (!resolved.ok) {
    if (resolved.text)
      await respond(deps, metadata.responseUrl, {
        response_type: "ephemeral",
        replace_original: false,
        text: resolved.text,
      });
    return resolved.outcome;
  }

  await deps.queueResume({
    runId: resolved.run.id,
    userId: resolved.userId,
    repoId: resolved.run.repo_id,
    steer: feedback,
    mode: metadata.kind === "plan" ? "plan" : "review",
    idempotencyKey: checkpointResumeKey(resolved.run),
  });
  const answer = answeredText({ kind: metadata.kind, slackUserId, feedback });
  // The modal has no copy of the message: rebuild it from the recorded
  // checkpoint so the plan stays readable, then swap the buttons.
  const summary = resolved.run.metadata.checkpoint_summary;
  const original = buildRunCheckpointMessage({
    runId: resolved.run.id,
    runUrl: buildAppUrl(`/runs/${resolved.run.id}`).toString(),
    checkpoint: {
      previewUrl: null,
      summary: typeof summary === "string" ? summary : null,
      ...(metadata.kind === "plan" ? { kind: "plan" as const } : {}),
    },
  });
  await respond(deps, metadata.responseUrl, {
    replace_original: true,
    text: answer,
    blocks: buildAnsweredCheckpointBlocks({ blocks: original.blocks, answer }),
  });
  return "resumed";
}
