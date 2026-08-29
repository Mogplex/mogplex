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
const GITHUB_CLI_PATTERN = /\bgh\b/i;
const GITHUB_CLI_MUTATION_PATTERN =
  /\b(?:issue|pr)\s+(?:create|edit|close|reopen|delete)\b/i;
const GITHUB_CLI_API_PATTERN = /\bgh\s+api\b/i;
const GITHUB_CLI_PR_MERGE_PATTERN = /\bgh\s+pr\s+merge\b/i;
const GITHUB_CLI_AUTH_PATTERN = /\bgh\s+auth(?:\s|$)/i;
const GITHUB_WRITE_CAPABILITY_ERROR =
  "GitHub writes require a scoped integration with write access to the target repository. Select or connect the target repository with write access, then retry through a supported GitHub action; a sandbox cannot provide GitHub credentials or permissions.";

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

function isGitHubCliMutationCommand(command: string) {
  return (
    GITHUB_CLI_PATTERN.test(command) &&
    (GITHUB_CLI_MUTATION_PATTERN.test(command) ||
      (GITHUB_CLI_API_PATTERN.test(command) &&
        (HTTP_MUTATION_METHOD_PATTERN.test(command) ||
          HTTP_MUTATION_FLAG_PATTERN.test(command))))
  );
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
    GITHUB_CLI_PR_MERGE_PATTERN.test(command) ||
    GITHUB_CLI_AUTH_PATTERN.test(command)
  ) {
    return {
      error: GITHUB_WRITE_CAPABILITY_ERROR,
      reason: "github_write_capability_unavailable",
    };
  }
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
  if (isRawGitHubMutationCommand(command)) {
    return {
      error:
        "Raw GitHub API mutations are blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
      reason: "github_mutation_blocked",
    };
  }
  if (isGitHubCliMutationCommand(command)) {
    return {
      error:
        "GitHub CLI mutations are blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
      reason: "github_mutation_blocked",
    };
  }
  return undefined;
}
