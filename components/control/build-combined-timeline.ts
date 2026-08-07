import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart } from "ai";
import type { TimelineEvent } from "@/lib/control/types";
import type { UIMessage } from "ai";

/**
 * Builds a combined timeline by merging mission timeline events with chat
 * messages. Assistant text becomes MOGPLEX events; tool invocations become
 * TOOL events with their input (and the error, when the call failed).
 */
export function buildCombinedTimeline(
  timeline: TimelineEvent[] | undefined,
  messages: UIMessage[]
): TimelineEvent[] {
  const result: TimelineEvent[] = [...(timeline || [])];

  // Append chat messages as timeline events
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (!msg.parts || !Array.isArray(msg.parts)) continue;

    for (const part of msg.parts) {
      if (typeof part !== "object" || part == null || !("type" in part)) {
        continue;
      }

      if (isToolOrDynamicToolUIPart(part)) {
        const toolName = getToolOrDynamicToolName(part);
        if (part.state === "output-error") {
          result.push({
            kind: "fail",
            label: "TOOL",
            time: "now",
            body: `${toolName} failed`,
            log: part.errorText ?? "unknown error",
          });
        } else {
          const input =
            part.input === undefined
              ? "…"
              : JSON.stringify(part.input).slice(0, 100);
          result.push({
            kind: "tool",
            label: "TOOL",
            time: "now",
            body: `${toolName}(${input})`,
          });
        }
        continue;
      }

      // Text parts
      if (part.type === "text" && "text" in part) {
        result.push({
          kind: "tool",
          label: "MOGPLEX",
          time: "now",
          body: String(part.text),
        });
      }
    }
  }

  return result;
}
