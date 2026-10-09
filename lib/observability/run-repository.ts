type Repository = { full_name: string };

/** Validate and normalize a GitHub repository full name (owner/repo). */
export function normalizeRepoFullName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(name) ? name : null;
}

/**
 * Resolve the run target, never the currently selected workspace/conversation.
 * Snapshots survive repo removal/renames and take priority over the repo picker.
 *
 * `repo` is the legacy snapshot written by older external runs (including Slack).
 * It always held the run target, not the context repository, so using it as a
 * fallback is safe. `repo_full_name` is the current canonical field.
 */
export function resolveRunRepository(
  call: { repo_id: string | null; metadata?: Record<string, unknown> | null },
  reposById: ReadonlyMap<string, Repository> = new Map()
): string | null {
  return (
    normalizeRepoFullName(call.metadata?.repo_full_name) ??
    normalizeRepoFullName(call.metadata?.repo) ??
    (call.repo_id
      ? normalizeRepoFullName(reposById.get(call.repo_id)?.full_name)
      : null)
  );
}
