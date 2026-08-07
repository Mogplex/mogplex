import { normalizeRootDirectory } from "@/lib/repo-settings";
import { isValidSandboxRootDirectory } from "@/lib/sandbox/launch-config";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { ResolvedSandboxLaunchRequest } from "@/lib/sandbox/launch-config";
import type { SandboxInstance, SandboxRepoRecord } from "./types";

export function sseEncode(event: SandboxEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function isTruthyEnvFlag(value: string | undefined) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

export function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Local twin of buildShellCommand in lib/sandbox/client.ts, used here
 * for the working-branch creation path inside createWorkingBranchInSandbox.
 *
 * INVARIANT: rootDirectory MUST have been validated upstream by
 * isValidSandboxRootDirectory (the launch flow does this before
 * effectiveRootDirectory is computed). The assertion here is the same
 * defensive guard as the client-side twin so a future caller that
 * skips the launch validator cannot smuggle a NUL byte / parent
 * traversal / absolute path into a single-quoted shell argument.
 *
 * Mirrors lib/sandbox/client.ts exactly: normalize first (so a
 * pre-normalized "./foo/" or trailing-slash variant emits the same
 * `cd 'foo' && ...` as the client twin), then emit.
 */
export function buildShellCommand(
  command: string,
  rootDirectory?: string | null
) {
  if (!isValidSandboxRootDirectory(rootDirectory)) {
    throw new TypeError(
      "buildShellCommand: rootDirectory must pass isValidSandboxRootDirectory"
    );
  }
  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  if (!normalizedRoot) return command;
  return `cd '${escapeShell(normalizedRoot)}' && ${command}`;
}

export async function createWorkingBranchInSandbox(
  sandbox: SandboxInstance,
  input: ResolvedSandboxLaunchRequest & { rootDirectory?: string | null }
) {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(
        `git switch -c '${escapeShell(input.workingBranch)}' && git push -u origin '${escapeShell(input.workingBranch)}'`,
        input.rootDirectory
      ),
    ],
  });

  if (result.exitCode === 0) return;

  const [stdout, stderr] = await Promise.all([
    result.stdout(),
    result.stderr(),
  ]);
  const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
  throw new Error(
    detail || `Failed to create working branch ${input.workingBranch}`
  );
}

export function resolveLaunchRootDirectory(input: {
  request: ResolvedSandboxLaunchRequest;
  repo: Pick<SandboxRepoRecord, "root_directory">;
}): string | null {
  // undefined -> field not in request body, use the repo default
  // null      -> caller explicitly chose repo root
  // string    -> caller chose this subdirectory
  if (input.request.rootDirectory === undefined) {
    return input.repo.root_directory ?? null;
  }
  return input.request.rootDirectory;
}
