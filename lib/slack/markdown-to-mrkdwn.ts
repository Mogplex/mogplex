/**
 * Converts an agent's GitHub-flavored Markdown into Slack mrkdwn, which uses
 * single `*` for bold, `_` for italics, `~` for strikethrough and has no
 * headings, tables or `[label](url)` links.
 *
 * The text is untrusted. `&`, `<` and `>` are escaped and broadcast words are
 * defused, so it cannot mention a channel or forge a link, and a Markdown
 * link keeps its URL visible as "label (url)" instead of hiding it behind a
 * label. `formatSlackConversationalReply` in ./format.ts handles the bot's
 * own replies, which may link behind a label.
 */
export function markdownToMrkdwn(markdown: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(line)) {
      // Text after an opening fence is its info string (the language), not
      // code, and Slack has no use for it.
      inFence = !inFence;
      out.push("```");
      continue;
    }
    if (inFence) {
      out.push(escapeMrkdwn(line));
      continue;
    }
    const converted = convertLine(line);
    if (converted === null) continue;
    // Outside code, runs of blank lines become one; code keeps its spacing.
    if (converted.trim() === "" && out.at(-1)?.trim() === "") continue;
    out.push(converted);
  }
  if (inFence) out.push("```");
  return out.join("\n").trim();
}

const BROADCAST = /@(here|channel|everyone)\b/gi;

/**
 * Makes untrusted text inert in Slack mrkdwn: escapes the three characters
 * Slack reserves for mentions and links, and breaks bare `@here`,
 * `@channel` and `@everyone` with a zero-width space, because Slack turns
 * those into broadcast mentions in block text.
 */
export function escapeMrkdwn(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(BROADCAST, "@\u200B$1");
}

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

function convertLine(line: string): string | null {
  if (RULE.test(line) || TABLE_DIVIDER.test(line)) return null;
  const heading = HEADING.exec(line);
  if (heading) return `*${stripEmphasis(inline(heading[1]))}*`;
  const row = TABLE_ROW.exec(line);
  if (row) {
    return row[1]
      .split("|")
      .map((cell) => inline(cell.trim()))
      .join(" · ");
  }
  const bullet = BULLET.exec(line);
  if (bullet) return `${bullet[1]}• ${inline(bullet[2])}`;
  const quote = QUOTE.exec(line);
  if (quote) return `> ${inline(quote[1])}`;
  return inline(line);
}

const BOLD_MARK = "\u0001";

function stripEmphasis(text: string) {
  return text.replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|$)/g, "$1$2");
}

// Code spans keep their content literally; everything else is formatted.
function inline(text: string) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 1
        ? escapeMrkdwn(part)
        : formatText(part)
    )
    .join("");
}

function formatText(text: string) {
  return escapeMrkdwn(text.replace(/<(https?:\/\/[^\s>|]+)>/g, "$1"))
    .replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, label, url) =>
      label && label !== url ? `${label} (${url})` : url
    )
    .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, `${BOLD_MARK}$1${BOLD_MARK}`)
    .replace(/__(\S(?:[^_]*\S)?)__/g, `${BOLD_MARK}$1${BOLD_MARK}`)
    .replace(/(^|[^*\w])\*(\S(?:[^*]*\S)?)\*(?![*\w])/g, "$1_$2_")
    .replace(/~~(\S(?:[^~]*\S)?)~~/g, "~$1~")
    .replaceAll(BOLD_MARK, "*");
}
