import type { UIMessage, DynamicToolUIPart } from "ai";
import type { RunWorkspaceEvent } from "./types";

/** Read-only projection of durable events into the existing workspace chat UI. */
export function projectRunTranscript(
  runId: string,
  prompt: string,
  events: RunWorkspaceEvent[],
  status: string
): UIMessage[] {
  const parts: UIMessage["parts"] = [];
  const tools = new Map<string, DynamicToolUIPart>();
  const seen = new Set<string>();
  let finalText = "";
  const text = (value: string) => {
    const last = parts.at(-1);
    if (last?.type === "text") last.text += value;
    else parts.push({ type: "text", text: value });
  };
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const kind = event.payload.kind;
    if (kind === "assistant_final") {
      finalText = event.message ?? "";
      continue;
    }
    if (kind === "assistant_delta") {
      text(event.message ?? "");
      continue;
    }
    if (event.type !== "tool_started" && event.type !== "tool_finished")
      continue;
    const id =
      typeof event.payload.toolCallId === "string"
        ? event.payload.toolCallId
        : event.id;
    let tool = tools.get(id);
    if (!tool) {
      tool = {
        type: "dynamic-tool",
        toolName: event.toolName ?? "tool",
        toolCallId: id,
        state: "input-available",
        input: event.payload.input ?? {},
      };
      tools.set(id, tool);
      parts.push(tool);
    }
    if (event.payload.input !== undefined) tool.input = event.payload.input;
    if (event.type === "tool_finished")
      Object.assign(
        tool,
        event.payload.state === "error" || event.payload.state === "denied"
          ? {
              state: "output-error",
              errorText:
                typeof event.payload.output === "string"
                  ? event.payload.output
                  : JSON.stringify(
                      event.payload.output ??
                        "Tool failed. See run details for diagnostics."
                    ),
            }
          : {
              state: "output-available",
              output:
                event.payload.output ??
                "Command finished. Detailed output was not recorded.",
            }
      );
  }
  const last = parts.at(-1);
  if (finalText && (last?.type !== "text" || !last.text.endsWith(finalText)))
    text(finalText);
  if (["success", "failed", "cancelled"].includes(status))
    for (const tool of tools.values()) {
      if (tool.state === "input-available")
        Object.assign(tool, {
          state: "output-error",
          errorText:
            "No completion result was received before the run stopped.",
        });
    }
  return [
    {
      id: `${runId}-prompt`,
      role: "user",
      parts: [{ type: "text", text: prompt }],
    },
    ...(parts.length > 0
      ? [{ id: `${runId}-response`, role: "assistant" as const, parts }]
      : []),
  ];
}
