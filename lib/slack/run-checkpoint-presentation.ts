import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import type { HarnessCheckpoint } from "@/lib/harness/checkpoint";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import type { SlackBlock } from "./client";
import { escapeMrkdwn, markdownToMrkdwn } from "./markdown-to-mrkdwn";
import { viewChangesButton } from "./run-changes-presentation";

export const SLACK_CHECKPOINT_APPROVE_ACTION_ID = "mogplex_checkpoint_approve";
export const SLACK_CHECKPOINT_REVISE_ACTION_ID = "mogplex_checkpoint_revise";
export const SLACK_CHECKPOINT_REVISE_CALLBACK_ID = "mogplex_checkpoint_revise";
export const SLACK_CHECKPOINT_FEEDBACK_BLOCK_ID = "mogplex_checkpoint_feedback";
export const SLACK_CHECKPOINT_FEEDBACK_ACTION_ID =
  "mogplex_checkpoint_feedback_value";

export type CheckpointKind = "plan" | "review";

// A section's text is capped at 3,000 characters; rendering can grow it.
const SUMMARY_CHARS = 2_400;

/**
 * One resume per pause, whichever answer arrives first: a button, the revise
 * modal, or a thread reply. Each pause runs on a fresh ai_call, so the key
 * never blocks the next checkpoint.
 */
export function checkpointResumeKey(
  run: Pick<ExternalAgentRunRow, "id" | "ai_call_id">
) {
  return `checkpoint-resume:${run.id}:${run.ai_call_id}`;
}

/** Button values carry the run and which checkpoint they answer. */
export function encodeCheckpointAction(runId: string, kind: CheckpointKind) {
  return `${runId}|${kind}`;
}

export function decodeCheckpointAction(value: string | undefined) {
  const [runId, kind] = (value ?? "").split("|");
  if (!runId || (kind !== "plan" && kind !== "review")) return null;
  return { runId, kind: kind as CheckpointKind };
}

function summaryMrkdwn(summary: string | null) {
  if (!summary) return null;
  const clean = sanitizeAgentUserFacingText(summary).trim();
  if (!clean) return null;
  const chars = Array.from(clean);
  const cut =
    chars.length > SUMMARY_CHARS
      ? `${chars.slice(0, SUMMARY_CHARS - 1).join("")}…`
      : clean;
  return markdownToMrkdwn(cut);
}

const COPY: Record<
  CheckpointKind,
  { title: string; approve: string; revise: string; hint: string }
> = {
  plan: {
    title: "📝 *Plan ready for your approval.* No files have changed yet.",
    approve: "Approve plan",
    revise: "Revise plan",
    hint: "Approve to start the work, or reply in this thread to change the plan.",
  },
  review: {
    title: "⏸️ *Ready for your review.*",
    approve: "Ship it",
    revise: "Request changes",
    hint: "Ship it to open the pull request, or reply in this thread with changes.",
  },
};

/** The checkpoint message: what the agent paused on and how to answer it. */
export function buildRunCheckpointMessage(input: {
  runId: string;
  runUrl: string;
  checkpoint: HarnessCheckpoint;
}) {
  const kind: CheckpointKind = input.checkpoint.kind ?? "review";
  const copy = COPY[kind];
  const summary = summaryMrkdwn(input.checkpoint.summary);
  const preview =
    input.checkpoint.previewUrl &&
    /^https:\/\/[^\s<>|]+$/.test(input.checkpoint.previewUrl)
      ? input.checkpoint.previewUrl
      : null;
  const sections = [
    copy.title,
    ...(summary ? [summary] : []),
    ...(preview
      ? [`*Agent-reported preview:* <${preview}|${escapeMrkdwn(preview)}>`]
      : []),
  ];
  const value = encodeCheckpointAction(input.runId, kind);
  const blocks: SlackBlock[] = [
    ...sections.map((text) => ({
      type: "section",
      text: { type: "mrkdwn", text },
    })),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: copy.approve },
          action_id: SLACK_CHECKPOINT_APPROVE_ACTION_ID,
          value,
        },
        {
          type: "button",
          text: { type: "plain_text", text: copy.revise },
          action_id: SLACK_CHECKPOINT_REVISE_ACTION_ID,
          value,
        },
        ...(kind === "review" ? [viewChangesButton(input.runId)] : []),
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${copy.hint} · <${input.runUrl}|View run>`,
        },
      ],
    },
  ];
  const text = [...sections, copy.hint, `<${input.runUrl}|View run>`].join(
    "\n\n"
  );
  return { text, blocks };
}

/** Replaces the buttons once someone answered, so nobody answers twice. */
export function buildAnsweredCheckpointBlocks(input: {
  blocks: readonly SlackBlock[] | undefined;
  answer: string;
}): SlackBlock[] {
  const kept = (input.blocks ?? []).filter(
    (block) => block.type !== "actions" && block.type !== "context"
  );
  return [
    ...kept,
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: input.answer }],
    },
  ];
}

/** Steering text sent to the agent for a button press. */
export function approvalSteer(kind: CheckpointKind) {
  return kind === "plan"
    ? "The user approved your plan. Implement it now."
    : "Approved. Ship it: open the pull request.";
}

/** The revise modal: a single feedback box. */
export function buildCheckpointReviseModal(input: {
  kind: CheckpointKind;
  privateMetadata: string;
}) {
  const plan = input.kind === "plan";
  return {
    type: "modal",
    callback_id: SLACK_CHECKPOINT_REVISE_CALLBACK_ID,
    private_metadata: input.privateMetadata,
    title: {
      type: "plain_text",
      text: plan ? "Revise plan" : "Request changes",
    },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: SLACK_CHECKPOINT_FEEDBACK_BLOCK_ID,
        label: {
          type: "plain_text",
          text: plan
            ? "What should change in the plan?"
            : "What should change?",
        },
        element: {
          type: "plain_text_input",
          action_id: SLACK_CHECKPOINT_FEEDBACK_ACTION_ID,
          multiline: true,
          max_length: 3000,
        },
      },
    ],
  };
}
