/**
 * Project association for control chat sessions: every session is tied to a
 * project — a connected repo when one is selected, otherwise a new project
 * group named explicitly or derived from the mission text.
 */

type ProjectRepo = {
  id: string;
  name?: string;
  full_name: string;
  is_favorite?: boolean;
};

/** Group/display name for a repo-backed project. */
export function repoProjectName(repo: {
  name?: string;
  full_name: string;
}): string {
  return repo.name?.trim() || repo.full_name;
}

/**
 * Default picker selection: the favorite repo when one exists, else the first
 * repo, else "new" (create a new project) when no repos are connected.
 */
export function defaultProjectChoice(repos: ProjectRepo[]): string {
  const preferred = repos.find((repo) => repo.is_favorite) ?? repos[0];
  return preferred?.id ?? "new";
}

/**
 * Fallback name for a new project when the user leaves the name input blank:
 * a short slug derived from the mission text.
 */
export function deriveProjectName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 48);
  return slug || "new-project";
}
