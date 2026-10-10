import type { UIMessage } from "ai";

/** First line of the latest user message, as a default commit message. */
export function lastUserMessageText(messages: UIMessage[]): string {
  const user = messages.findLast((message) => message.role === "user");
  const text =
    user?.parts
      ?.filter(
        (part): part is { type: "text"; text: string } => part.type === "text"
      )
      .map((part) => part.text)
      .join("\n")
      .trim() ?? "";
  const firstLine = text.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}
