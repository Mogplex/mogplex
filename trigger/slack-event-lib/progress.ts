import type { RunChatAgentProgressEvent } from "@/lib/agents/run-chat-progress";
import { sanitizeAgentUserFacingText } from "@/lib/agents/user-facing-output";
import type { SlackUpdateText } from "./messaging";
import { fitSlackMessageText, formatSlackConversationalReply } from "./system";

export const SLACK_INITIAL_PROGRESS_TEXT = "_Preparing your request..._";

const TOOL_START_TEXT: Readonly<Record<string, string>> = {
  add_memory: "Saving the memory...",
  bash: "Running a command...",
  browse_skills: "Searching available skills...",
  browse_vercel_docs: "Reading the Vercel docs...",
  github_api: "Checking GitHub...",
  github_create_issue: "Opening the GitHub issue...",
  github_update_issue: "Updating the GitHub issue...",
  github_comment_issue: "Commenting on the GitHub issue...",
  github_create_pull_request: "Opening the pull request...",
  github_merge_pull_request: "Merging the pull request...",
  github_pull_request_status: "Checking pull request status...",
  github_update_pull_request: "Updating the pull request...",
  github_list_repos: "Checking repositories...",
  github_pr_search: "Searching pull requests...",
  start_repo_agent_run: "Starting a repo agent run...",
  list_files: "Checking repository files...",
  list_memories: "Checking saved memories...",
  read_file: "Reading a repository file...",
  search_memories: "Searching saved memories...",
  start_sandbox: "Starting the sandbox...",
  stop_sandbox: "Stopping the sandbox...",
  virtual_exec: "Running a quick check...",
  web_fetch: "Reading a source...",
  web_search: "Searching trusted sources...",
  write_file: "Updating a file...",
};

type SlackProgressSanitizationContext = {
  repoName?: string | null;
  userText?: string;
};

export function formatSlackAgentProgress(
  event: RunChatAgentProgressEvent,
  context: SlackProgressSanitizationContext = {}
): string | null {
  if (event.type === "model_working") {
    return "_Working through the details..._";
  }

  if (event.type === "text_delta") {
    const text = sanitizeAgentUserFacingText(event.accumulatedText, {
      repoName: context.repoName,
      userRequestText: context.userText,
    });
    if (!text.trim()) return null;
    return fitSlackMessageText(formatSlackConversationalReply(text));
  }

  if (event.type === "tool_finished") {
    return event.success
      ? "_Step complete. Checking the result..._"
      : "_That step failed. Trying another path..._";
  }

  const status = TOOL_START_TEXT[event.toolName] ?? "Using a connected tool...";
  return `_${status}_`;
}

export function createSlackAgentProgressHandler(
  update: (text: SlackUpdateText) => void | Promise<void>,
  context: SlackProgressSanitizationContext = {}
) {
  return async (event: RunChatAgentProgressEvent) => {
    if (event.type === "text_delta") {
      await update(() => formatSlackAgentProgress(event, context));
      return;
    }
    const progressText = formatSlackAgentProgress(event, context);
    if (progressText) await update(progressText);
  };
}
