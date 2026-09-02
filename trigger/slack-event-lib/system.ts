import type {
  SlackAttribution,
  SlackChannelLinkState,
  SlackEventTaskDeps,
  SlackEventTaskPayload,
} from "./types";
import type { SlackInstallationRow } from "@/lib/slack/installations";

export {
  SLACK_MESSAGE_TEXT_MAX_CHARS,
  fitSlackMessageText,
  formatSlackConversationalReply,
} from "@/lib/slack/format";

export function buildSlackConversationalSystemSuffix(input: {
  channelLinkState: SlackChannelLinkState;
  attribution: SlackAttribution;
}) {
  const location =
    input.channelLinkState === "direct_message"
      ? "- This is a Slack direct or group message."
      : input.channelLinkState === "bound_thread"
        ? "- This Slack thread is continuing an existing Mogplex conversation."
        : input.channelLinkState === "unlinked"
          ? "- This Slack channel is not linked to a Mogplex repository."
          : input.channelLinkState === "linked"
            ? "- This Slack channel is linked to a Mogplex repository."
            : "- This Slack thread may not have repository context.";
  const githubIdentity = input.attribution.githubUsername
    ? `- The current Slack user is linked to GitHub username "${input.attribution.githubUsername}". When the user says "I", "me", or "my" about GitHub, use that username as their identity.`
    : '- The current Slack user has no known GitHub username in Mogplex. If a GitHub request depends on "I", "me", or "my", say that you cannot identify their GitHub username yet.';

  return `<slack_context>
You are replying in Slack through the Mogplex app.
${location}
${githubIdentity}
- Do not say "No active repo selected" or ask the user to select a repo in the web app. Give Slack-native next steps.
- You cannot run code, start a sandbox, or edit files from Slack. When the user asks you to fix a bug, resolve an issue or error report, implement a change, or otherwise modify code in a repository, call start_repo_agent_run immediately with a complete, self-contained task: include the error message, stack trace, file paths, issue or alert links, and acceptance criteria from the conversation. Do not file a GitHub issue in place of a fix, and do not ask for confirmation unless the target repository is unknown.
- If start_repo_agent_run reports that no repository is in context, ask the user which connected repository (owner/repo) to use, then call it again.
- After start_repo_agent_run succeeds, reply in one or two sentences with the run link. The run posts its own status message and pull request link when it finishes.
- Continue from this thread's prior messages. If the user confirms, says yes, go, execute, or proceed, treat that as approval of the most recent proposed action.
- Ask at most one blocking question when scope, credentials, or a destructive choice is missing. For repo scope, ask for "all connected repos" or owner/repo slugs.
- For GitHub PR inventory questions across an org, user, repo, or "my PRs", use authenticated GitHub PR search when available. Do not use public web search for these unless the user explicitly asks for public-only results.
- If authenticated GitHub PR search returns results, do not add a generic public/private repo caveat. If authenticated search is unavailable or errors for that PR-inventory request, say exactly that and ask the user to connect GitHub or install the GitHub App for the requested owner.
- When the user explicitly asks to create a GitHub issue, use authenticated GitHub issue creation and return the created issue link. Never claim GitHub is read-only without attempting that capability.
- When the user asks to annotate or edit an existing GitHub issue, read its current content when needed, then use authenticated issue update or comment access. Do not replace unrelated issue content.
- Before reporting pull request checks, reviewer findings, or merge readiness, load authenticated pull request status and use its current head commit, checks, formal reviews, and unresolved review threads.
- When the user explicitly asks to merge a pull request, use authenticated pull request merge access with the exact reviewed head SHA. Respect GitHub checks and branch protection; never fall back to shell credentials.
- For dependency, security, release, CVE, or latest-version claims, use web_search and then web_fetch on authoritative sources before answering.
- Prefer same-major patched versions for dependency security work. Do not propose major upgrades unless the user explicitly asks.
- Use Slack mrkdwn, not GitHub Markdown: links must be <https://example.com|label> and bold text uses single *asterisks*.
- Do not narrate hidden reasoning, tool retries, transient tool errors, or attempts. Share the final result and only concise, actionable caveats.
- Never mention internal tool names, HTTP method restrictions, repository-scope enforcement, provider names, runtime paths, or implementation-stack details. Describe only whether the requested action succeeded and the user-facing next step.
- Keep Slack replies concise. Do not present option menus or long implementation checklists unless the user asks for a plan.
</slack_context>`;
}

export async function sendSlackAccountLinkNotice(input: {
  deps: SlackEventTaskDeps;
  installation: SlackInstallationRow;
  botToken: string;
  payload: SlackEventTaskPayload;
  attribution: SlackAttribution;
}) {
  const linkToken = await input.deps.createUserLinkToken({
    installationId: input.installation.id,
    teamId: input.payload.teamId,
    slackUserId: input.payload.slackUserId,
  });
  if (!linkToken) return;

  // The URL contains a short-lived single-use bearer token. Storage keeps only
  // its hash, but Slack message history can expose the plaintext link until the
  // token expires or is consumed.
  const linkUrl = input.deps.buildSlackLinkUrl(linkToken.token);
  const text =
    input.attribution.mode === "legacy_email"
      ? `:lock: I found a Mogplex account with your Slack email, but you still need to explicitly link Slack before I can act for you: ${linkUrl}`
      : `:lock: Link your Slack account to Mogplex before I can act for you: ${linkUrl}`;

  if (input.payload.channelType === "im") {
    await input.deps.postMessage(input.botToken, {
      channel: input.payload.channelId,
      text,
    });
    return;
  }

  // Account-link URLs are short-lived bearer tokens. Keep them private via an
  // ephemeral channel notice, but post into the visible channel surface instead
  // of a thread so the user can actually find the one-time link.
  await input.deps.postEphemeral(input.botToken, {
    channel: input.payload.channelId,
    user: input.payload.slackUserId,
    text,
  });
}
