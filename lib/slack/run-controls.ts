import type { SlackBlock } from "@/lib/slack/client";

/**
 * `action_id` for the "Cancel run" button attached to repo-agent messages the
 * bot posts in linked channels. The interactivity webhook routes `block_actions`
 * payloads carrying this id to the cancel handler.
 */
export const SLACK_CANCEL_RUN_ACTION_ID = "mogplex-cancel-run";

/** `block_id` for the run-controls actions block — kept stable for clarity. */
export const SLACK_RUN_CONTROLS_BLOCK_ID = "mogplex-run-controls";

/**
 * Key under a run's `metadata` JSONB holding the coordinates of the Slack
 * message that carries the run's "Cancel run" button. Present only on runs
 * started from Slack; used by the run-completion hook to strip the button.
 */
export const SLACK_RUN_CONTROLS_METADATA_KEY = "slackRunControls";

export type SlackRunControlsMetadata = {
  teamId: string;
  channelId: string;
  messageTs: string;
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Narrow an arbitrary run-metadata value to {@link SlackRunControlsMetadata}. */
export function readSlackRunControlsMetadata(
  metadata: unknown
): SlackRunControlsMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>)[
    SLACK_RUN_CONTROLS_METADATA_KEY
  ];
  if (!raw || typeof raw !== "object") return null;
  const { teamId, channelId, messageTs } = raw as Record<string, unknown>;
  if (
    !nonEmptyString(teamId) ||
    !nonEmptyString(channelId) ||
    !nonEmptyString(messageTs)
  ) {
    return null;
  }
  return { teamId, channelId, messageTs };
}

/**
 * Block Kit `actions` block with a single danger-styled "Cancel run" button.
 * Attach this below the status text of a repo-agent message so the user can
 * stop the run without leaving Slack.
 */
export function buildCancelRunActionsBlock(runId: string): SlackBlock {
  return {
    type: "actions",
    block_id: SLACK_RUN_CONTROLS_BLOCK_ID,
    elements: [
      {
        type: "button",
        action_id: SLACK_CANCEL_RUN_ACTION_ID,
        style: "danger",
        text: { type: "plain_text", text: "Cancel run" },
        value: runId,
        confirm: {
          title: { type: "plain_text", text: "Cancel this run?" },
          // Slack requires `plain_text` here — an `mrkdwn` object makes the
          // whole `chat.update` payload invalid and the message edit fails.
          text: {
            type: "plain_text",
            text: `Run ${runId} will be stopped. This can't be undone.`,
          },
          confirm: { type: "plain_text", text: "Cancel run" },
          deny: { type: "plain_text", text: "Keep running" },
        },
      },
    ],
  };
}

export function isRunControlsBlock(block: SlackBlock): boolean {
  // `SlackBlock` is `Record<string, unknown>`, so `block_id` is `unknown` —
  // a plain `===` against the string id is enough, no cast needed.
  return block.block_id === SLACK_RUN_CONTROLS_BLOCK_ID;
}

/**
 * Build a single `section` block from Slack message text. Returns `null` when
 * nothing meaningful would survive, so callers can skip the update rather than
 * blank the message.
 */
export function buildTextSectionBlocks(text: string): SlackBlock[] | null {
  if (!text) return null;
  return [{ type: "section", text: { type: "mrkdwn", text } }];
}

/** The `:rocket: Started run …` line posted when a repo-agent run kicks off. */
export function buildRepoAgentRunStartedText(
  runId: string,
  runUrl: string
): string {
  return `:rocket: Started run \`${runId}\` — <${runUrl}|view in Mogplex>`;
}

/**
 * The line a repo-agent message is rewritten to once the run reaches a terminal
 * state — mirrors {@link buildRepoAgentRunStartedText} so the message stays a
 * useful link to the run.
 */
export function buildRepoAgentRunFinishedText(
  runId: string,
  runUrl: string,
  // Keeps IDE completions for known terminal statuses while still accepting
  // future Slack-facing status strings without a type update.
  status: "success" | "failed" | "cancelled" | (string & {})
): string {
  const link = `<${runUrl}|view in Mogplex>`;
  switch (status) {
    case "success":
      return `:white_check_mark: Run \`${runId}\` finished — ${link}`;
    case "failed":
      return `:x: Run \`${runId}\` failed — ${link}`;
    case "cancelled":
      return `:black_square_for_stop: Run \`${runId}\` cancelled — ${link}`;
    default:
      return `Run \`${runId}\` ended (status: ${status}) — ${link}`;
  }
}
