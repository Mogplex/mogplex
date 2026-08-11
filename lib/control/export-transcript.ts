import type { UIMessage } from "ai";
import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart } from "ai";

/**
 * Render a control chat session as a markdown transcript for client-side
 * download. Text parts become prose; tool calls become a mono summary line
 * with their final state.
 */
export function buildTranscriptMarkdown(
  title: string,
  messages: UIMessage[]
): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const message of messages) {
    lines.push(message.role === "user" ? "## You" : "## Mogplex", "");
    for (const part of message.parts ?? []) {
      if (part.type === "text" && "text" in part) {
        const text = String(part.text).trim();
        if (text) lines.push(text, "");
      } else if (part.type === "file") {
        const filename =
          "filename" in part && part.filename ? part.filename : "attachment";
        lines.push(`_Attachment: ${filename}_`, "");
      } else if (isToolOrDynamicToolUIPart(part)) {
        const name = getToolOrDynamicToolName(part);
        const state = "state" in part ? String(part.state) : "";
        lines.push(`- \`${name}\` — ${state || "called"}`, "");
      }
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
