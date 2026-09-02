import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import { fitSlackMessageText, formatSlackConversationalReply } from "./format";

const GITHUB_PULL_REQUEST_URL_PATTERN =
  /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
const MAX_LINKED_PULL_REQUESTS = 3;
export const SLACK_RUN_SUMMARY_MAX_CHARS = 1_500;

/** Unique GitHub pull request URLs in order of first appearance. */
export function extractPullRequestUrls(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(GITHUB_PULL_REQUEST_URL_PATTERN)) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function pullRequestLabel(url: string) {
  const match = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/.exec(url);
  return match ? `${match[1]}/${match[2]}#${match[3]}` : url;
}

function summaryTail(output: string) {
  const characters = Array.from(output.trim());
  if (characters.length <= SLACK_RUN_SUMMARY_MAX_CHARS) {
    return characters.join("");
  }
  return `…${characters.slice(-SLACK_RUN_SUMMARY_MAX_CHARS).join("")}`;
}

/**
 * The Slack text a repo-agent message is rewritten to when its run ends:
 * the status line, any pull requests the agent opened, and the tail of the
 * agent's own closing output so the user can read the outcome without leaving
 * Slack.
 */
export function buildRepoAgentRunResultText(input: {
  statusLine: string;
  output: string | null;
  repoName?: string | null;
}): string {
  const output = input.output?.trim()
    ? sanitizeAgentUserFacingText(input.output, { repoName: input.repoName })
    : "";
  const pullRequests = extractPullRequestUrls(output).slice(
    0,
    MAX_LINKED_PULL_REQUESTS
  );
  const sections = [input.statusLine];
  if (pullRequests.length > 0) {
    sections.push(
      pullRequests
        .map((url) => `*Pull request:* <${url}|${pullRequestLabel(url)}>`)
        .join("\n")
    );
  }
  if (output) {
    sections.push(formatSlackConversationalReply(summaryTail(output)));
  }
  return fitSlackMessageText(sections.join("\n\n"));
}
