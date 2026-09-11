import path from "node:path";

/**
 * Where Vercel Sandbox checks the repository out. The provider resolves a
 * relative `cwd` against `/`, not against this directory, and rejects one that
 * does not exist with a 400. Every `runCommand` call therefore needs an
 * absolute working directory, which this module derives.
 */
export const SANDBOX_WORKSPACE_ROOT = "/vercel/sandbox";

/**
 * Resolve the working directory for a sandbox command.
 *
 * - `rootDirectory` is the repository subdirectory a sandbox was launched for
 *   (`apps/web` in a monorepo), an absolute checkout such as a worktree under
 *   the workspace, or null/undefined for the repository root.
 * - `cwd` is the caller's request: absolute paths are used as-is, relative
 *   paths (including `.`) resolve from the launch directory, and an empty or
 *   missing value means the launch directory itself.
 */
export function resolveSandboxWorkingDirectory(
  cwd: string | null | undefined,
  rootDirectory?: string | null
): string {
  const root = rootDirectory?.trim();
  const base = root
    ? path.posix.isAbsolute(root)
      ? path.posix.normalize(root)
      : path.posix.join(SANDBOX_WORKSPACE_ROOT, root)
    : SANDBOX_WORKSPACE_ROOT;
  const requested = cwd?.trim();
  if (!requested) return base;
  const resolved = path.posix.isAbsolute(requested)
    ? path.posix.normalize(requested)
    : path.posix.join(base, requested);
  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}
