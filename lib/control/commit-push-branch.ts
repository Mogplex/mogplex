/** A mission base is not a push target: only the sandbox knows its branch. */
export function resolveCommitPushBranch(
  sandbox: { working_branch?: string | null } | null | undefined
): string | null {
  return sandbox?.working_branch?.trim() || null;
}
