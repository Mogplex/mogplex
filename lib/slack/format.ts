export const SLACK_MESSAGE_TEXT_MAX_CHARS = 4_000;

const SLACK_SHORTENED_SUFFIX =
  "\n\n_(Response shortened to fit Slack. Ask a narrower follow-up for more detail.)_";

function sanitizeSlackLinkLabel(label: string) {
  const sanitized = label.replace(/[<>|]/g, "").trim();
  return sanitized || "link";
}

/** Convert the Markdown links and bold the model emits into Slack mrkdwn. */
export function formatSlackConversationalReply(text: string) {
  return text
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label: string, url: string) =>
        `<${url}|${sanitizeSlackLinkLabel(label)}>`
    )
    .replace(/\*\*([^\n*][^\n]*?)\*\*/g, "*$1*");
}

/** Truncate to Slack's message limit, flagging the cut so the user can ask on. */
export function fitSlackMessageText(text: string) {
  const characters = Array.from(text);
  if (characters.length <= SLACK_MESSAGE_TEXT_MAX_CHARS) return text;

  const prefixLength =
    SLACK_MESSAGE_TEXT_MAX_CHARS - Array.from(SLACK_SHORTENED_SUFFIX).length;
  return `${characters.slice(0, prefixLength).join("")}${SLACK_SHORTENED_SUFFIX}`;
}
