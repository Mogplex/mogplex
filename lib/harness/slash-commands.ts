import type { SlashCommand } from "@/lib/slash-command-types";
import type { HarnessId } from "@/lib/harness/config";

type HarnessSlashCommandDefinition = Pick<
  SlashCommand,
  "name" | "description" | "args"
>;

// Source docs:
// - Claude Code: https://code.claude.com/docs/en/commands
// - Codex CLI: https://developers.openai.com/codex/cli/slash-commands
// These lists intentionally model the documented slash popup surface rather than
// aliases that are accepted by the CLIs but hidden from their command menus.
const CLAUDE_CODE_SLASH_COMMANDS: HarnessSlashCommandDefinition[] = [
  { name: "add-dir", description: "Add a working directory", args: "<path>" },
  { name: "agents", description: "Manage agent configurations" },
  {
    name: "autofix-pr",
    description:
      "Watch the current PR and push fixes from Claude Code on the web",
    args: "[prompt]",
  },
  {
    name: "batch",
    description: "Orchestrate large-scale codebase changes in parallel",
    args: "<instruction>",
  },
  {
    name: "branch",
    description: "Create a branch of the current conversation",
    args: "[name]",
  },
  {
    name: "btw",
    description: "Ask a quick side question without adding to the conversation",
    args: "<question>",
  },
  { name: "chrome", description: "Configure Claude in Chrome settings" },
  {
    name: "claude-api",
    description: "Load Claude API reference material for your project",
  },
  { name: "clear", description: "Start a new conversation" },
  {
    name: "color",
    description: "Set the prompt bar color for the current session",
    args: "[color|default]",
  },
  {
    name: "compact",
    description: "Free context by summarizing the conversation",
    args: "[instructions]",
  },
  { name: "config", description: "Open Claude Code settings" },
  { name: "context", description: "Visualize current context usage" },
  {
    name: "copy",
    description: "Copy a recent assistant response",
    args: "[N]",
  },
  { name: "cost", description: "Show token usage statistics" },
  {
    name: "debug",
    description: "Debug the current session",
    args: "[description]",
  },
  { name: "desktop", description: "Continue this session in the desktop app" },
  { name: "diff", description: "Open an interactive diff viewer" },
  { name: "doctor", description: "Diagnose Claude Code installation" },
  {
    name: "effort",
    description: "Set the model effort level",
    args: "[level|auto]",
  },
  { name: "exit", description: "Exit the CLI" },
  {
    name: "export",
    description: "Export the current conversation as plain text",
    args: "[filename]",
  },
  {
    name: "extra-usage",
    description: "Configure extra usage when rate limits are hit",
  },
  {
    name: "fast",
    description: "Toggle fast mode on or off",
    args: "[on|off]",
  },
  { name: "feedback", description: "Submit feedback", args: "[report]" },
  {
    name: "fewer-permission-prompts",
    description: "Reduce permission prompts with an allowlist recommendation",
  },
  { name: "focus", description: "Toggle the focus view" },
  { name: "heapdump", description: "Write a JavaScript heap snapshot" },
  { name: "help", description: "Show help and available commands" },
  { name: "hooks", description: "View hook configurations" },
  { name: "ide", description: "Manage IDE integrations and show status" },
  { name: "init", description: "Initialize a project CLAUDE.md guide" },
  {
    name: "insights",
    description: "Generate a report on Claude Code session patterns",
  },
  {
    name: "install-github-app",
    description: "Set up the Claude GitHub Actions app for a repository",
  },
  {
    name: "install-slack-app",
    description: "Install the Claude Slack app",
  },
  {
    name: "keybindings",
    description: "Open the keybindings configuration file",
  },
  { name: "login", description: "Sign in to Anthropic" },
  { name: "logout", description: "Sign out from Anthropic" },
  {
    name: "loop",
    description: "Run a prompt repeatedly while the session stays open",
    args: "[interval] [prompt]",
  },
  { name: "mcp", description: "Manage MCP connections" },
  { name: "memory", description: "Edit CLAUDE.md memory files" },
  { name: "mobile", description: "Show a QR code for the mobile app" },
  {
    name: "model",
    description: "Select or change the AI model",
    args: "[model]",
  },
  { name: "passes", description: "Share a free week of Claude Code" },
  { name: "permissions", description: "Manage tool permissions" },
  {
    name: "plan",
    description: "Enter plan mode directly from the prompt",
    args: "[description]",
  },
  { name: "plugin", description: "Manage Claude Code plugins" },
  { name: "powerup", description: "Discover Claude Code features" },
  {
    name: "privacy-settings",
    description: "View and update privacy settings",
  },
  { name: "recap", description: "Generate a one-line session summary" },
  { name: "release-notes", description: "View the changelog" },
  { name: "reload-plugins", description: "Reload active plugins" },
  {
    name: "remote-control",
    description:
      "Make this session available for remote control from claude.ai",
  },
  {
    name: "remote-env",
    description: "Configure the default remote environment for web sessions",
  },
  {
    name: "rename",
    description: "Rename the current session",
    args: "[name]",
  },
  {
    name: "resume",
    description: "Resume a conversation by ID or name",
    args: "[session]",
  },
  {
    name: "review",
    description: "Review a pull request or working tree",
    args: "[PR]",
  },
  { name: "rewind", description: "Rewind the conversation or code" },
  { name: "sandbox", description: "Toggle sandbox mode" },
  {
    name: "schedule",
    description: "Create, update, list, or run routines",
    args: "[description]",
  },
  {
    name: "security-review",
    description: "Analyze pending changes for security vulnerabilities",
  },
  {
    name: "setup-bedrock",
    description: "Configure Amazon Bedrock authentication and model pins",
  },
  {
    name: "setup-vertex",
    description: "Configure Google Vertex AI authentication and model pins",
  },
  {
    name: "simplify",
    description:
      "Review recent changes for reuse, quality, and efficiency issues",
    args: "[focus]",
  },
  { name: "skills", description: "List available skills" },
  { name: "stats", description: "Visualize daily usage and session history" },
  { name: "status", description: "Show version, model, and connectivity" },
  { name: "statusline", description: "Configure the status line" },
  { name: "stickers", description: "Order Claude Code stickers" },
  { name: "tasks", description: "List and manage background tasks" },
  {
    name: "team-onboarding",
    description: "Generate a team onboarding guide from usage history",
  },
  {
    name: "teleport",
    description: "Pull a Claude Code web session into this terminal",
  },
  { name: "terminal-setup", description: "Configure terminal keybindings" },
  { name: "theme", description: "Change the color theme" },
  {
    name: "tui",
    description: "Set the terminal UI renderer",
    args: "[default|fullscreen]",
  },
  {
    name: "ultraplan",
    description: "Draft a plan in an ultraplan session",
    args: "<prompt>",
  },
  {
    name: "ultrareview",
    description: "Run a deep, multi-agent code review in a cloud sandbox",
    args: "[PR]",
  },
  { name: "upgrade", description: "Open the upgrade page" },
  { name: "usage", description: "Show usage limits and rate limit status" },
  { name: "voice", description: "Toggle push-to-talk voice dictation" },
  {
    name: "web-setup",
    description: "Connect GitHub to Claude Code on the web",
  },
];

const CODEX_SLASH_COMMANDS: HarnessSlashCommandDefinition[] = [
  { name: "agent", description: "Switch the active agent thread" },
  { name: "apps", description: "Browse apps and insert them into your prompt" },
  { name: "clear", description: "Clear the terminal and start a fresh chat" },
  { name: "compact", description: "Summarize the visible conversation" },
  { name: "copy", description: "Copy the latest completed Codex output" },
  { name: "debug-config", description: "Print config layer diagnostics" },
  { name: "diff", description: "Show the git diff, including untracked files" },
  { name: "experimental", description: "Toggle experimental features" },
  { name: "exit", description: "Exit the CLI" },
  {
    name: "fast",
    description: "Toggle Fast mode for GPT-5.4",
    args: "[on|off|status]",
  },
  { name: "feedback", description: "Send logs to Codex maintainers" },
  {
    name: "fork",
    description: "Fork the current conversation into a new thread",
  },
  { name: "help", description: "Show available slash commands" },
  { name: "init", description: "Generate an AGENTS.md scaffold" },
  { name: "logout", description: "Sign out of Codex" },
  { name: "mcp", description: "List configured MCP tools" },
  {
    name: "mention",
    description: "Attach a file or folder to the conversation",
  },
  {
    name: "model",
    description: "Choose the active model and reasoning effort",
  },
  {
    name: "new",
    description: "Start a new conversation in the same CLI session",
  },
  { name: "permissions", description: "Update approval requirements" },
  { name: "personality", description: "Choose a communication style" },
  { name: "plan", description: "Switch to plan mode", args: "[prompt]" },
  { name: "plugins", description: "Browse installed and discoverable plugins" },
  { name: "ps", description: "Show background terminals and recent output" },
  { name: "quit", description: "Exit the CLI" },
  { name: "resume", description: "Resume a saved conversation" },
  { name: "review", description: "Ask Codex to review your working tree" },
  {
    name: "sandbox-add-read-dir",
    description: "Grant sandbox read access to an extra directory",
    args: "<absolute-directory-path>",
  },
  {
    name: "status",
    description: "Display session configuration and token usage",
  },
  { name: "statusline", description: "Configure TUI status-line fields" },
  { name: "stop", description: "Stop all background terminals" },
  { name: "title", description: "Configure terminal window title fields" },
];

function toPassthroughSlashCommands(
  commands: HarnessSlashCommandDefinition[]
): SlashCommand[] {
  return commands.map((command) => ({
    ...command,
    execute: () => ({ output: "", action: "passthrough" as const }),
  }));
}

export function buildHarnessSlashCommands(
  harnessId: HarnessId
): SlashCommand[] {
  return toPassthroughSlashCommands(
    harnessId === "claude-code"
      ? CLAUDE_CODE_SLASH_COMMANDS
      : CODEX_SLASH_COMMANDS
  );
}

export function getHarnessIdFromModelId(
  modelId?: string | null
): HarnessId | null {
  if (modelId === "harness:claude-code") return "claude-code";
  if (modelId === "harness:codex") return "codex";
  return null;
}
