import { buildAppUrl } from "@/lib/app-url";
import { buildCancelRunActionsBlock } from "./run-controls";
import type { SlackBlock } from "./client";
import { progressText, type RunProgressState } from "./run-progress-state";
import type { RunGuidance } from "./run-guidance-store";
import { guidanceReceiptText } from "./run-guidance-presentation";

export type ProgressRun = {
  id: string;
  metadata: unknown;
  prompt?: string;
  working_branch?: string;
  created_at?: string;
  user_id?: string;
  ai_call_id?: string;
  status?: string;
};
function escapeMrkdwn(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export function runProgressTitle(run: ProgressRun): string {
  const metadata =
    run.metadata && typeof run.metadata === "object"
      ? (run.metadata as Record<string, unknown>)
      : {};
  const title =
    typeof metadata.slack_task_title === "string"
      ? metadata.slack_task_title
      : run.prompt?.split("\n")[0];
  return progressText(title || "Repository task", 140) || "Repository task";
}
const richText = (text: string) => ({
  type: "rich_text",
  elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }],
});

/** Same semantic snapshot for native Slack blocks and notification/accessibility text. */
export function buildRunProgressMessage(
  run: ProgressRun,
  state: RunProgressState,
  guidance: readonly RunGuidance[] = []
) {
  const runUrl = buildAppUrl(`/runs/${run.id}`).toString();
  const allTasks = [...state.tasks.values()];
  // Keep current operations visible. Older work remains in the full run history.
  const active = allTasks.filter((task) => task.status === "in_progress");
  const recent = allTasks
    .filter((task) => task.status !== "in_progress")
    .slice(-3);
  const tasks = [...recent, ...active].slice(-50);
  const title = runProgressTitle(run);
  const lastActivity = new Date(state.lastActivityAt).toISOString();
  const timestamp = Math.floor(state.lastActivityAt / 1000);
  const status =
    active.length > 0
      ? `${active.length === 1 ? "Current step" : `${active.length} active steps`}: ${active
          .map((task) => task.title)
          .slice(0, 3)
          .join("; ")}`
      : recent.length > 0
        ? "Preparing the next step"
        : state.phase;
  const narrative = [state.summary, state.next ? `Next: ${state.next}` : ""]
    .filter(Boolean)
    .join("\n");
  const phaseAndStatus =
    state.phase === status ? state.phase : `${state.phase}\n${status}`;
  const receipts = guidanceReceiptText(guidance);
  const metadata =
    run.metadata && typeof run.metadata === "object"
      ? (run.metadata as Record<string, unknown>)
      : {};
  const canGuide =
    metadata.slack_guidance_enabled === true && run.status !== "awaiting_input";
  const guideHint = canGuide
    ? "Reply in this thread to guide the next step. The current command may need to finish first."
    : "";
  const text = [
    `*${escapeMrkdwn(title)}*`,
    escapeMrkdwn(phaseAndStatus),
    narrative ? escapeMrkdwn(narrative) : "",
    receipts ? escapeMrkdwn(`Your guidance\n${receipts}`) : "",
    guideHint,
    ...tasks.map(
      (task) =>
        `${task.status === "complete" ? "Completed" : task.status === "error" ? "Needs attention" : "In progress"}: ${escapeMrkdwn(task.title)}`
    ),
    `Last activity: ${lastActivity}`,
    `<${runUrl}|View run details>`,
  ]
    .filter(Boolean)
    .join("\n");
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `${phaseAndStatus}${narrative ? `\n\n${narrative}` : ""}`,
      },
    },
  ];
  if (tasks.length > 0)
    blocks.push({
      type: "plan",
      title: "Recent work",
      tasks: tasks.map((task) => ({
        task_id: task.id,
        title: task.title,
        status: task.status,
        ...(task.result ? { output: richText(task.result) } : {}),
      })),
    });
  if (receipts)
    blocks.push({
      type: "section",
      text: { type: "plain_text", text: `Your guidance\n${receipts}` },
    });
  if (guideHint)
    blocks.push({
      type: "context",
      elements: [{ type: "plain_text", text: guideHint }],
    });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Last activity <!date^${timestamp}^{time_secs}|${lastActivity}> · <${runUrl}|View run details>`,
      },
      ...(run.working_branch
        ? [
            {
              type: "plain_text",
              text: `Branch: ${progressText(run.working_branch, 180)}`,
            },
          ]
        : []),
    ],
  });
  const actions = buildCancelRunActionsBlock(run.id);
  blocks.push({
    ...actions,
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "View work" },
        url: runUrl,
        action_id: "mogplex-view-run",
      },
      ...(run.status === "awaiting_input"
        ? []
        : (actions.elements as Record<string, unknown>[])
      ).map(({ style: _style, ...button }) => button),
    ],
  });
  return { text, blocks };
}
