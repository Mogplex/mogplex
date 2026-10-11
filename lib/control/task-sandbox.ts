import { getToolOrDynamicToolName, isToolUIPart, type UIMessage } from "ai";
import { isCurrentControlSandbox } from "./sandbox-presentation";
import { controlToolOutcome } from "./tool-outcome";

export type TaskSandboxBinding = { sandboxId: string; callId: string };

/** Execution results bind the task. A worker's environment belongs to that worker. */
export function latestTaskSandbox(
  messages: UIMessage[]
): TaskSandboxBinding | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    for (const part of [...message.parts].reverse()) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue;
      const name = getToolOrDynamicToolName(part);
      if (
        !["sandbox_start", "start_sandbox", "run_command", "bash"].includes(
          name
        )
      )
        continue;
      const output = part.output;
      if (
        !output ||
        typeof output !== "object" ||
        !("sandboxId" in output) ||
        typeof output.sandboxId !== "string" ||
        !output.sandboxId
      )
        continue;
      if (
        (name === "sandbox_start" || name === "start_sandbox") &&
        controlToolOutcome(part.state, output) !== "done"
      )
        continue;
      return { sandboxId: output.sandboxId, callId: part.toolCallId };
    }
  }
  return null;
}

export type TaskSandboxSelection = {
  sandboxId: string;
  observedCallId: string | null;
};

export function resolveTaskSandbox<
  T extends { id: string; runtime_summary: { status: string } },
>(
  sandboxes: T[],
  selected: TaskSandboxSelection | null,
  binding: TaskSandboxBinding | null
): T | null {
  const id =
    binding && binding.callId !== selected?.observedCallId
      ? binding.sandboxId
      : (selected?.sandboxId ?? binding?.sandboxId);
  // A missing saved environment must never silently resolve to a different VM.
  if (id) return sandboxes.find((sandbox) => sandbox.id === id) ?? null;
  const current = sandboxes.filter(isCurrentControlSandbox);
  return current.length === 1 ? current[0] : null;
}
