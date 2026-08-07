import type { TimelineEvent } from "@/lib/control/types";
import type { UIMessage } from "ai";

/**
 * Builds a combined timeline by merging seed timeline events with chat messages.
 * Chat messages from the assistant are transformed into timeline events.
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

      // Tool call parts
      if (String(part.type).startsWith("tool")) {
        const toolPart = part as {
          type: string;
          toolName?: string;
          args?: unknown;
        };
        if (toolPart.toolName) {
          result.push({
            kind: "tool",
            label: "TOOL",
            time: "now",
            body: `${toolPart.toolName}(${JSON.stringify(toolPart.args || {}).slice(0, 100)}...)`,
          });
        }
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
