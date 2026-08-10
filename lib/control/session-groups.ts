/**
 * Project grouping for the control session sidebar (pure, unit-tested).
 */

export type SessionGroupInput = {
  id: string;
  project?: string | null;
  updated_at: string;
};

export type SessionGroup<T extends SessionGroupInput> = {
  /** Display name; "General" collects sessions without a project. */
  name: string;
  /** Project slug as stored, or null for the General group. */
  project: string | null;
  sessions: T[];
};

export const GENERAL_GROUP_NAME = "General";

const PROJECT_COLORS = [
  "bg-accent-blue",
  "bg-accent-green",
  "bg-accent-amber",
  "bg-accent-cyan",
  "bg-accent-fuchsia",
  "bg-primary",
] as const;

/** Deterministic accent color for a project name (Conductor-style icon dot). */
export function projectColorClass(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.codePointAt(0)!) % 997;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

/**
 * Group sessions by project. Sessions inside a group sort by latest
 * activity first; groups sort by their most recently active session, with
 * General last so named projects always lead.
 */
export function groupSessionsByProject<T extends SessionGroupInput>(
  sessions: T[]
): SessionGroup<T>[] {
  const byProject = new Map<string | null, T[]>();
  for (const session of sessions) {
    const key = session.project?.trim() || null;
    const list = byProject.get(key) ?? [];
    list.push(session);
    byProject.set(key, list);
  }

  const latestActivity = (list: T[]) =>
    list.reduce(
      (latest, s) => Math.max(latest, Date.parse(s.updated_at) || 0),
      0
    );

  const groups: SessionGroup<T>[] = [...byProject.entries()].map(
    ([project, list]) => ({
      name: project ?? GENERAL_GROUP_NAME,
      project,
      sessions: [...list].sort(
        (a, b) =>
          (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0)
      ),
    })
  );

  return groups.sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return latestActivity(b.sessions) - latestActivity(a.sessions);
  });
}
