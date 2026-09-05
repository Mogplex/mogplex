import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import type { HarnessProgressUpdate } from "@/lib/mogplex-api/harness-progress";

export type ProgressTask = {
  id: string;
  name: string;
  title: string;
  status: "in_progress" | "complete" | "error";
  startedAt: number;
  finishedAt?: number;
  result?: string;
};
export type RunProgressState = {
  phase: string;
  summary: string;
  next: string;
  textBuffer: string;
  tasks: Map<string, ProgressTask>;
  lastActivityAt: number;
  sequence: number;
};

/** Presentation bounds, never execution or input limits. Sanitize before slicing. */
export function progressText(value: string, max = 320): string {
  const text = sanitizeAgentUserFacingText(value)
    .replace(/<[^>]*>/g, "")
    .replace(/`/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

export function createRunProgressState(now: number): RunProgressState {
  return {
    phase: "Getting started",
    summary: "",
    next: "",
    textBuffer: "",
    tasks: new Map(),
    lastActivityAt: now,
    sequence: 0,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Never show raw shell arguments, credentials, URLs, or environment values. */
export function progressToolTitle(name: string, input?: unknown): string {
  const args = record(input);
  const lower = name.toLowerCase();
  if (
    ["bash", "command", "command_execution", "terminal_exec"].includes(lower)
  ) {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    if (
      /^(?:pnpm|npm|yarn|bun)(?:\s+(?:run|exec))?\s+(?:test(?::[\w-]+)?|vitest|playwright)\b/.test(
        command
      )
    )
      return "Running tests";
    if (
      /^(?:pnpm|npm|yarn|bun)(?:\s+run)?\s+(?:lint|typecheck|build)\b/.test(
        command
      )
    )
      return "Checking the build and code quality";
    if (/^(?:rg|grep|find)\s/.test(command)) return "Searching the code";
    if (/^git\s+(?:diff|status|log|show)\b/.test(command))
      return "Reviewing changes";
    if (/^git\s+(?:commit|push)\b/.test(command))
      return "Saving changes to Git";
    if (/^gh\s+pr\s+create\b/.test(command)) return "Opening the pull request";
    return "Running a command";
  }
  const labels: Readonly<Record<string, string>> = {
    read: "Reading a file",
    read_file: "Reading a file",
    edit: "Editing a file",
    multiedit: "Editing files",
    file_change: "Editing files",
    patchapply: "Editing files",
    write: "Writing a file",
    write_file: "Writing a file",
    grep: "Searching the code",
    glob: "Finding files",
    ls: "Listing files",
    todowrite: "Planning the work",
    task: "Working on a subtask",
    webfetch: "Reading a page",
    websearch: "Searching the web",
  };
  return labels[lower] ?? "Working on the task";
}

/** A successful tool invocation can still contain a failed shell exit. */
export function progressToolResult(state: string, output?: unknown) {
  const value = record(output);
  if (
    ["error", "denied", "failed"].includes(state) ||
    value.error ||
    value.success === false ||
    value.ok === false
  )
    return {
      status: "error" as const,
      result:
        state === "denied"
          ? "Permission was not granted"
          : "This step did not succeed",
    };
  const exitCode = value.exitCode ?? value.exit_code;
  if (typeof exitCode === "number" && exitCode !== 0)
    return {
      status: "error" as const,
      result: `Command exited with code ${exitCode}`,
    };
  if (
    ("exitCode" in value || "exit_code" in value) &&
    typeof exitCode !== "number"
  )
    return {
      status: "error" as const,
      result: "Command completion could not be verified",
    };
  if (!["success", "done", "completed"].includes(state))
    return {
      status: "error" as const,
      result: "Step completion could not be verified",
    };
  return {
    status: "complete" as const,
    result:
      exitCode === 0 ? "Command completed with exit code 0" : "Step completed",
  };
}

/** Buffer complete prose segments so split tokens/secrets are never published. */
export function finishProgressText(state: RunProgressState): boolean {
  if (!state.textBuffer.trim()) return false;
  const text = progressText(state.textBuffer);
  state.textBuffer = "";
  if (!text) return false;
  state.summary = text;
  return true;
}

export function applyRunProgress(
  state: RunProgressState,
  update: HarnessProgressUpdate,
  now: number
): boolean {
  state.lastActivityAt = now;
  if (update.kind === "assistant_text") {
    state.textBuffer += update.text;
    return false;
  }
  const textChanged = finishProgressText(state);
  if (update.kind === "assistant_text_end") return textChanged;
  if (update.kind === "phase") {
    state.phase = progressText(update.phase, 80);
    state.summary = progressText(update.summary);
    state.next = progressText(update.next ?? "", 200);
    return true;
  }
  if (update.toolName === "report_progress") return textChanged;
  const existing = update.toolCallId
    ? state.tasks.get(update.toolCallId)
    : [...state.tasks.values()]
        .reverse()
        .find(
          (task) =>
            task.name === update.toolName && task.status === "in_progress"
        );
  if (update.kind === "tool_started") {
    if (existing && update.toolCallId) return textChanged;
    const id = update.toolCallId ?? `activity-${++state.sequence}`;
    state.tasks.set(id, {
      id,
      name: update.toolName,
      title: progressToolTitle(update.toolName, update.input),
      status: "in_progress",
      startedAt: now,
    });
    return true;
  }
  const id =
    existing?.id ?? update.toolCallId ?? `activity-${++state.sequence}`;
  state.tasks.set(id, {
    id,
    name: update.toolName,
    title: existing?.title ?? progressToolTitle(update.toolName),
    startedAt: existing?.startedAt ?? now,
    finishedAt: now,
    ...progressToolResult(update.state, update.output),
  });
  return true;
}
