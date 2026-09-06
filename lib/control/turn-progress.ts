import {
  getToolOrDynamicToolName,
  isToolOrDynamicToolUIPart,
  type UIMessage,
} from "ai";
import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import { controlToolOutcome } from "./tool-outcome";

export function currentTurnMessages(messages: UIMessage[]): UIMessage[] {
  const index = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(Math.max(index, 0));
}

const TOOL_LABELS: Record<string, string> = {
  run_command: "Running command",
  read_file: "Reading file",
  list_files: "Exploring files",
  search_repo: "Searching repository",
  write_file: "Editing file",
  edit_file: "Editing file",
  plan_mission: "Planning work",
  sandbox_start: "Starting sandbox",
  spawn_worktree: "Preparing worktree",
  spawn_subagent: "Starting worker",
  list_worktrees: "Checking workers",
  await_workers: "Checking worker handoff",
};

export function toolActivityLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replaceAll("_", " ");
}

export function toolActivityDetail(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const value =
    record.command ?? record.path ?? record.filePath ?? record.query;
  return typeof value === "string"
    ? sanitizeAgentUserFacingText(value).slice(0, 180)
    : null;
}

export function presentTurnProgress(messages: UIMessage[], status: string) {
  const parts = currentTurnMessages(messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts);
  const tools = parts.filter(isToolOrDynamicToolUIPart);
  const completed = tools.filter(
    (part) =>
      controlToolOutcome(
        part.state,
        "output" in part ? part.output : undefined
      ) !== "running"
  ).length;
  const failed = tools.filter(
    (part) =>
      controlToolOutcome(
        part.state,
        "output" in part ? part.output : undefined
      ) === "failed"
  ).length;
  const approval = tools.find((part) => part.state === "approval-requested");
  if (approval)
    return {
      label: "Waiting for your approval",
      detail: toolActivityLabel(getToolOrDynamicToolName(approval)),
      completed,
      failed,
      approval: true,
    };
  if (status !== "streaming" && status !== "submitted") return null;
  const running = tools.findLast(
    (part) =>
      controlToolOutcome(
        part.state,
        "output" in part ? part.output : undefined
      ) === "running"
  );
  const last = parts.at(-1);
  return {
    label: running
      ? toolActivityLabel(getToolOrDynamicToolName(running))
      : status === "submitted"
        ? "Starting your request"
        : last?.type === "text" && last.state === "streaming"
          ? "Writing response"
          : "Thinking",
    detail: running
      ? toolActivityDetail("input" in running ? running.input : undefined)
      : null,
    completed,
    failed,
    approval: false,
  };
}
