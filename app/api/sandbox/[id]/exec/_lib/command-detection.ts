import { HARNESSES } from "@/lib/harness/config";
import {
  installHarnessPackage,
  isHarnessInstalled,
} from "@/lib/harness/install";
import type { HarnessId } from "@/lib/harness/config";
import type { Sandbox } from "@vercel/sandbox";

/**
 * Git subcommands that require remote access.
 */
const REMOTE_GIT_COMMANDS = new Set([
  "clone",
  "fetch",
  "pull",
  "push",
  "ls-remote",
]);

/**
 * Checks if a command may require GitHub authentication.
 * Best-effort optimization for ordinary terminal commands.
 */
export function commandMayNeedGithubAuth(command: string) {
  // Agent delivery preparation starts with an explicit remote git operation,
  // while unusual wrappers such as `sh -c` may need the user to retry without
  // the wrapper if their cached credential has expired.
  const tokens = command
    .split(/\s+/)
    .map((token) => token.replace(/^[;&|()]+|[;&|()]+$/g, ""));

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "gh") return true;
    if (
      tokens[index] === "git" &&
      tokens.slice(index + 1).some((token) => REMOTE_GIT_COMMANDS.has(token))
    ) {
      return true;
    }
  }
  return false;
}

/** Map of CLI binary name to harness ID for auto-install detection. */
export const BINARY_TO_HARNESS: Record<string, HarnessId> = {
  claude: "claude-code",
  codex: "codex",
};

/**
 * If the command starts with a harness binary (claude, codex),
 * ensure it's installed in the sandbox before executing.
 *
 * @returns Error message if installation failed, null on success
 */
export async function ensureHarnessInstalled(
  sandbox: Sandbox,
  command: string
): Promise<string | null> {
  const firstWord = command.split(/\s/)[0];
  const harnessId = BINARY_TO_HARNESS[firstWord];
  if (!harnessId) return null;

  if (await isHarnessInstalled(sandbox, harnessId)) {
    return null;
  }

  try {
    await installHarnessPackage(sandbox, harnessId);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : `Failed to install ${HARNESSES[harnessId].package}`;
  }
}
