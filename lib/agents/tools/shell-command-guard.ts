const CREDENTIAL_FILE_PATTERN =
  /(?:\.git-credentials|\.mogplex\/github-token|\.netrc|\.config\/gh\/hosts\.yml|\.gitconfig|\.ssh\/(?:id_[^/\s]+|config)|\.aws\/credentials|\.npmrc|\.pypirc)/i;
const CREDENTIAL_COMMAND_PATTERN =
  /\b(?:(?:GH|GITHUB)_TOKEN|git\s+credential)\b/i;
const PROCESS_ENV_PATTERN = /\/proc\/\S+\/environ/i;
const ENV_COMMAND_PATTERN = /(?:^|[;&|]\s*)env\b/i;
const PRINTENV_COMMAND_PATTERN = /(?:^|[;&|]\s*)printenv\b/i;
const HTTP_CLIENT_PATTERN =
  /\b(?:curl|wget|http|python(?:3)?|node|deno|ruby)\b/i;
const GITHUB_API_PATTERN = /api\.github\.com/i;
const HTTP_MUTATION_METHOD_PATTERN = /\b(?:POST|PUT|PATCH|DELETE)\b/i;
const HTTP_MUTATION_FLAG_PATTERN =
  /(?:-X|--request)\s+(?:POST|PUT|PATCH|DELETE)\b/i;
const HTTP_DATA_FLAG_PATTERN = /(?:-d|--data(?:-[\w-]+)?)\b/i;
const GITHUB_CLI_PATTERN = /(?:^|[;&|()]|\s)gh(?:\s|$)/i;
const GITHUB_CLI_MUTATION_PATTERN =
  /\b(?:issue|pr)\s+(?:create|edit|close|reopen|delete)\b/i;
const GITHUB_CLI_API_PATTERN = /\bgh\s+api\b/i;
const GITHUB_CLI_API_FIELD_PATTERN =
  /(?:^|\s)(?:-f|-F|--raw-field|--field|--input)(?:\s|=|$)/i;
const GITHUB_CLI_API_GET_PATTERN =
  /(?:^|\s)(?:(?:-X|--method)\s*=?\s*GET)(?:\s|$)/i;
const GITHUB_GRAPHQL_MUTATION_PATTERN = /\bmutation\b/i;
const GITHUB_CLI_INVOCATION_PATTERN =
  /\bgh\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/gi;
const GITHUB_WRITE_CAPABILITY_ERROR =
  "GitHub writes require a scoped integration with write access to the target repository. Select or connect the target repository with write access, then retry through a supported GitHub action; a sandbox cannot provide GitHub credentials or permissions.";

const READ_ONLY_GITHUB_CLI_COMMANDS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  help: new Set(),
  status: new Set(),
  version: new Set(),
  issue: new Set(["list", "status", "view"]),
  pr: new Set(["checks", "diff", "list", "status", "view"]),
  release: new Set(["download", "list", "view"]),
  repo: new Set(["list", "view"]),
  run: new Set(["list", "view", "watch"]),
  search: new Set(["code", "commits", "issues", "prs", "repos"]),
  workflow: new Set(["list", "view"]),
};

/*
 * This prevents common accidental credential reads and mutation bypasses, but
 * is not an authorization boundary: shell syntax is too expressive to parse
 * safely here. Sandbox credential provisioning and native, server-scoped
 * GitHub tools remain the security boundary.
 */

function isRawGitHubMutationCommand(command: string) {
  return (
    HTTP_CLIENT_PATTERN.test(command) &&
    GITHUB_API_PATTERN.test(command) &&
    (HTTP_MUTATION_METHOD_PATTERN.test(command) ||
      HTTP_MUTATION_FLAG_PATTERN.test(command) ||
      HTTP_DATA_FLAG_PATTERN.test(command))
  );
}

function isReadOnlyGitHubApiCommand(command: string) {
  if (!GITHUB_CLI_API_PATTERN.test(command)) return false;
  if (
    GITHUB_GRAPHQL_MUTATION_PATTERN.test(command) ||
    HTTP_MUTATION_METHOD_PATTERN.test(command) ||
    HTTP_MUTATION_FLAG_PATTERN.test(command)
  ) {
    return false;
  }
  return (
    !GITHUB_CLI_API_FIELD_PATTERN.test(command) ||
    GITHUB_CLI_API_GET_PATTERN.test(command)
  );
}

function isKnownGitHubCliMutation(command: string) {
  return (
    GITHUB_CLI_PATTERN.test(command) &&
    (GITHUB_CLI_MUTATION_PATTERN.test(command) ||
      (GITHUB_CLI_API_PATTERN.test(command) &&
        (HTTP_MUTATION_METHOD_PATTERN.test(command) ||
          HTTP_MUTATION_FLAG_PATTERN.test(command))))
  );
}

function isReadOnlyGitHubCliInvocation(
  root: string | undefined,
  subcommand: string | undefined,
  command: string
) {
  if (root === "api") return isReadOnlyGitHubApiCommand(command);
  const allowedSubcommands = root
    ? READ_ONLY_GITHUB_CLI_COMMANDS[root]
    : undefined;
  if (!allowedSubcommands) return false;
  if (allowedSubcommands.size > 0) {
    return Boolean(subcommand && allowedSubcommands.has(subcommand));
  }
  if (subcommand?.startsWith("-")) return true;
  return root === "help" || !subcommand;
}

function isReadOnlyGitHubCliCommand(command: string) {
  if (!GITHUB_CLI_PATTERN.test(command)) return true;

  let invocationCount = 0;
  for (const match of command.matchAll(GITHUB_CLI_INVOCATION_PATTERN)) {
    invocationCount += 1;
    const root = match[1]?.toLowerCase();
    const subcommand = match[2]?.toLowerCase();
    if (!isReadOnlyGitHubCliInvocation(root, subcommand, command)) return false;
  }

  // A command containing `gh` that the structured matcher could not classify
  // (for example global flags before a subcommand) fails closed.
  return invocationCount > 0;
}

export function getBlockedAgentShellCommand(command: string):
  | {
      error: string;
      reason:
        | "credential_access_blocked"
        | "github_mutation_blocked"
        | "github_write_capability_unavailable";
    }
  | undefined {
  if (
    CREDENTIAL_FILE_PATTERN.test(command) ||
    CREDENTIAL_COMMAND_PATTERN.test(command) ||
    PROCESS_ENV_PATTERN.test(command) ||
    ENV_COMMAND_PATTERN.test(command) ||
    PRINTENV_COMMAND_PATTERN.test(command)
  ) {
    return {
      error:
        "Credential access is blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
      reason: "credential_access_blocked",
    };
  }
  if (isKnownGitHubCliMutation(command)) {
    return {
      error:
        "GitHub CLI mutations are blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
      reason: "github_mutation_blocked",
    };
  }
  if (!isReadOnlyGitHubCliCommand(command)) {
    return {
      error: GITHUB_WRITE_CAPABILITY_ERROR,
      reason: "github_write_capability_unavailable",
    };
  }
  if (isRawGitHubMutationCommand(command)) {
    return {
      error:
        "Raw GitHub API mutations are blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
      reason: "github_mutation_blocked",
    };
  }
  return undefined;
}
