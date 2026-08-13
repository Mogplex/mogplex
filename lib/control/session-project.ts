/**
 * Project association for control chat sessions: every session is tied to a
 * project — a connected repo when one is selected, otherwise a new project
 * group named explicitly or derived from the mission text.
 */

import { isUuid } from "@/lib/uuid";

type ProjectRepo = {
  id: string;
  name?: string;
  full_name: string;
  is_favorite?: boolean;
};

/** Group/display name for a repo-backed project. Full names are unambiguous. */
export function repoProjectName(repo: { full_name: string }): string {
  return repo.full_name;
}

/**
 * Resolve a durable session's repository. Older sessions only stored a short
 * project name, so retain a safe fallback when that name maps to one repo.
 */
export function resolveControlSessionRepo<T extends ProjectRepo>(
  session: { repo_id?: string | null; project?: string | null } | null,
  repos: T[]
): T | null {
  if (!session) return null;

  if (session.repo_id) {
    return repos.find((repo) => repo.id === session.repo_id) ?? null;
  }

  const project = session.project?.trim().toLowerCase();
  if (!project) return null;

  const exact = repos.find((repo) => repo.full_name.toLowerCase() === project);
  if (exact) return exact;

  const legacyMatches = repos.filter((repo) => {
    const name = repo.name?.trim() || repo.full_name.split("/").at(-1) || "";
    return name.toLowerCase() === project;
  });
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

/** Display legacy repo-backed sessions under the repo's canonical full name. */
export function controlSessionProjectName<T extends ProjectRepo>(
  session: { repo_id?: string | null; project?: string | null },
  repos: T[]
): string | null {
  return (
    (resolveControlSessionRepo(session, repos)?.full_name ??
      session.project?.trim()) ||
    null
  );
}

export function canonicalizeControlSessionProjects<
  T extends { repo_id?: string | null; project?: string | null },
>(sessions: T[], repos: ProjectRepo[]): T[] {
  return sessions.map((session) => {
    const project = controlSessionProjectName(session, repos);
    return project === session.project ? session : { ...session, project };
  });
}

/** Validate and normalize the optional repository id accepted by the API. */
export function parseControlSessionRepoId(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  return isUuid(trimmed) ? { ok: true, value: trimmed } : { ok: false };
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
