import type { Tool } from "ai";

/**
 * Sandbox tools hidden from the Slack surface. Slack turns run under a short
 * budget and hand code changes to a full repo-agent run instead (see
 * `start_repo_agent_run` in the Slack event handler), so exposing an in-turn
 * sandbox there would only invite half-finished work.
 */
export const SLACK_EXCLUDED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "start_sandbox",
  "stop_sandbox",
  "bash",
  "write_file",
]);

export function selectChatTools(input: {
  tools: Record<string, Tool>;
  surface: "chat" | "slack";
  additionalTools?: Record<string, Tool>;
}): Record<string, Tool> {
  const selected: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(input.tools)) {
    if (input.surface === "slack" && SLACK_EXCLUDED_TOOL_NAMES.has(name)) {
      continue;
    }
    selected[name] = tool;
  }
  return { ...selected, ...input.additionalTools };
}
