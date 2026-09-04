import { buildAppUrl } from "@/lib/app-url";
import {
  buildCancelRunActionsBlock,
  buildTextSectionBlocks,
  readSlackRunControlsMetadata,
} from "@/lib/slack/run-controls";
import type { HarnessProgressUpdate } from "@/lib/mogplex-api/harness-progress";
import type { SlackBlock, UpdateSlackMessageInput } from "@/lib/slack/client";

type SlackNotifiableRun = { id: string; metadata: unknown };

type SlackRunProgressImpl = {
  getSlackBotToken: (teamId: string) => Promise<string | null>;
  updateSlackMessage: (
    botToken: string,
    input: UpdateSlackMessageInput
  ) => Promise<unknown>;
};

export type SlackRunProgressDeps = Partial<SlackRunProgressImpl> & {
  now?: () => number;
  /**
   * Minimum gap between Slack message edits. This paces `chat.update` under
   * Slack's per-channel rate limit; it is not a run timeout — the run's own
   * checkpoints decide when work stops.
   */
  minUpdateIntervalMs?: number;
};

export type SlackRunProgressReporter = {
  report: (update: HarnessProgressUpdate) => Promise<void>;
  flush: () => Promise<void>;
};

const MAX_FEED_LINES = 8;
const MAX_CURRENT_TEXT = 180;
const DEFAULT_MIN_UPDATE_INTERVAL_MS = 2_500;

// Claude Code tool names mapped to short, user-facing action lines.
const TOOL_LABELS: Readonly<Record<string, string>> = {
  bash: "Running a command",
  read: "Reading a file",
  edit: "Editing a file",
  multiedit: "Editing files",
  write: "Writing a file",
  grep: "Searching the code",
  glob: "Finding files",
  ls: "Listing files",
  todowrite: "Planning the work",
  task: "Running a sub-task",
  webfetch: "Reading a page",
  websearch: "Searching the web",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name.toLowerCase()] ?? `Using ${name}`;
}

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > MAX_CURRENT_TEXT
    ? `${line.slice(0, MAX_CURRENT_TEXT)}…`
    : line;
}

const NOOP_REPORTER: SlackRunProgressReporter = {
  report: async () => {},
  flush: async () => {},
};

async function loadDefaultImpl(): Promise<SlackRunProgressImpl> {
  const { getSlackBotToken, updateSlackMessage } =
    await import("@/lib/slack/client");
  return { getSlackBotToken, updateSlackMessage };
}

/**
 * Builds a reporter that streams a run's live actions into the Slack thread it
 * was started from, so the user can watch the agent work (and steer). Updates
 * edit the run's originating message, keeping the "Cancel run" button. A run
 * with no Slack coordinates gets an inert no-op reporter. All Slack calls are
 * best-effort: a failure is logged and never interrupts the run.
 */
export function createSlackRunProgressReporter(
  run: SlackNotifiableRun,
  deps: SlackRunProgressDeps = {}
): SlackRunProgressReporter {
  const slack = readSlackRunControlsMetadata(run.metadata);
  if (!slack) return NOOP_REPORTER;
  const { teamId, channelId, messageTs } = slack;

  const now = deps.now ?? Date.now;
  const minInterval =
    deps.minUpdateIntervalMs ?? DEFAULT_MIN_UPDATE_INTERVAL_MS;
  const runUrl = buildAppUrl(`/runs/${run.id}`).toString();

  const feed: string[] = [];
  let currentText: string | null = null;
  let dirty = false;
  let lastUpdateAt = -Infinity;
  let impl: SlackRunProgressImpl | null =
    deps.getSlackBotToken && deps.updateSlackMessage
      ? {
          getSlackBotToken: deps.getSlackBotToken,
          updateSlackMessage: deps.updateSlackMessage,
        }
      : null;
  let botToken: string | null | undefined;

  async function resolveImpl(): Promise<SlackRunProgressImpl> {
    if (!impl) impl = await loadDefaultImpl();
    return impl;
  }

  function composeText(): string {
    const header = `:hourglass_flowing_sand: Working on run \`${run.id}\` — <${runUrl}|view in Mogplex>`;
    const lines = feed.slice(-MAX_FEED_LINES).map((line) => `• ${line}`);
    const body = lines.length > 0 ? `\n${lines.join("\n")}` : "";
    const current = currentText ? `\n\n> ${currentText}` : "";
    return `${header}${body}${current}`;
  }

  async function flushToSlack(): Promise<void> {
    if (!dirty) return;
    dirty = false;
    try {
      const resolved = await resolveImpl();
      if (botToken === undefined) {
        botToken = await resolved.getSlackBotToken(teamId);
      }
      if (!botToken) return;
      const text = composeText();
      const blocks: SlackBlock[] = [
        ...(buildTextSectionBlocks(text) ?? []),
        buildCancelRunActionsBlock(run.id),
      ];
      lastUpdateAt = now();
      await resolved.updateSlackMessage(botToken, {
        channel: channelId,
        ts: messageTs,
        text,
        blocks,
      });
    } catch (error) {
      console.warn("[slack-run-progress] update failed", run.id, error);
    }
  }

  return {
    async report(update) {
      if (update.kind === "assistant_text") {
        const line = firstLine(update.text);
        if (!line) return;
        currentText = line;
      } else if (update.kind === "tool_started") {
        feed.push(toolLabel(update.toolName));
      } else if (update.state === "error" || update.state === "denied") {
        feed.push(`${toolLabel(update.toolName)} (failed)`);
      } else {
        return;
      }
      dirty = true;
      if (now() - lastUpdateAt >= minInterval) await flushToSlack();
    },
    async flush() {
      await flushToSlack();
    },
  };
}
